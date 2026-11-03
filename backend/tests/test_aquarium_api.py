from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.api.deps import authorize_device
from unittest import mock
from app.ingest import ingest_message
from app.main import create_app
from app.realtime import build_realtime_events

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "simulator"))
from telemetry import SCENARIOS, TelemetryGenerator


class AquariumApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.app = create_app(start_background_services=False)

        def db_override():
            with self.sessions() as session:
                yield session

        self.app.dependency_overrides[get_db] = db_override
        # Các test này kiểm tra pipeline dữ liệu; quyền truy cập có test riêng (test_auth_tanks.py).
        self.app.dependency_overrides[authorize_device] = lambda: None
        patcher = mock.patch("app.api.realtime._authorized", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()
        self.now = datetime(2026, 10, 19, tzinfo=timezone.utc)

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.engine.dispose()

    def send(self, scenario="normal", device="tank-api", seconds=0):
        generator = TelemetryGenerator(device, scenario, seed=42,
            clock=lambda: (self.now + timedelta(seconds=seconds)).isoformat())
        document = generator.next_payload()
        topic = f"aquarium-monitoring/devices/{device}/telemetry"
        raw = json.dumps(document).encode()
        ingest_message(topic, raw, self.sessions)
        return document, build_realtime_events(topic, raw, self.sessions)

    def test_all_simulator_scenarios_are_accepted_by_pipeline(self):
        for index, scenario in enumerate(SCENARIOS):
            if scenario == "offline":
                continue
            device = f"tank-{index}"
            expected, _ = self.send(scenario, device)
            actual = self.client.get(f"/api/v1/devices/{device}/telemetry/latest")
            self.assertEqual(actual.status_code, 200)
            for field in ("temperature_c", "ph", "turbidity_pct"):
                self.assertEqual(actual.json()[field], expected[field])
            self.assertNotIn("water_level_cm", actual.json())
            self.assertTrue(actual.json()["measured_at"].endswith("Z"))

    def test_history_uses_time_filters_and_device_isolation(self):
        self.send(seconds=0)
        self.send(seconds=60)
        self.send(device="tank-other", seconds=30)
        response = self.client.get("/api/v1/devices/tank-api/telemetry",
            params={"from": (self.now + timedelta(seconds=30)).isoformat(), "limit": 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(response.json()[0]["device_id"], "tank-api")
        self.assertEqual(self.client.get("/api/v1/devices/unknown/telemetry/latest").status_code, 404)

    def test_custom_thresholds_affect_next_telemetry_and_reject_invalid_limits(self):
        self.send()
        url = "/api/v1/devices/tank-api/thresholds"
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        settings = {k: v for k, v in response.json().items() if k not in ("device_id", "updated_at")}
        settings["ph_max"] = 6.7
        self.assertEqual(self.client.put(url, json=settings).status_code, 200)
        self.send(seconds=60)
        alerts = self.client.get("/api/v1/devices/tank-api/alerts?active_only=true").json()
        self.assertIn("ph", [a["alert_type"] for a in alerts])
        self.assertEqual(self.client.put(url, json={**settings, "ph_max": 5}).status_code, 422)
        self.assertEqual(self.client.get(url).json()["ph_max"], 6.7)

    def test_websocket_delivers_new_values_and_alerts(self):
        with self.client.websocket_connect("/ws?device_id=tank-api") as socket:
            self.assertEqual(socket.receive_json()["type"], "connected")
            document, events = self.send("turbidity-high")
            for event in events:
                self.app.state.realtime_hub.publish_from_thread(event)
            event = socket.receive_json()
            self.assertEqual(event["type"], "telemetry")
            self.assertEqual(event["data"]["ph"], document["ph"])
            self.assertEqual(event["data"]["schema_version"], 2)
            alerts = socket.receive_json()
            self.assertIn("turbidity", [a["alert_type"] for a in alerts["data"]])
            socket.send_text("ping")
            self.assertEqual(socket.receive_json(), {"type": "pong"})

    def test_acknowledgement_is_idempotent_and_does_not_resolve_alert(self):
        self.send("turbidity-high")
        path = "/api/v1/devices/tank-api/alerts"
        alert = self.client.get(path, params={"active_only": True}).json()[0]
        url = f"{path}/{alert['id']}/acknowledge"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        acknowledged = response.json()
        self.assertTrue(acknowledged["acknowledged_at"].endswith("Z"))
        self.assertIsNone(acknowledged["ended_at"])
        self.assertEqual(self.client.post(url).json()["acknowledged_at"], acknowledged["acknowledged_at"])
        self.assertEqual(len(self.client.get(path, params={"active_only": True}).json()), 1)

    def test_acknowledgement_rejects_unknown_and_other_device_alerts(self):
        self.send("turbidity-high")
        alert = self.client.get("/api/v1/devices/tank-api/alerts").json()[0]
        for device, alert_id in (("tank-other", alert["id"]), ("tank-api", 999999)):
            self.assertEqual(self.client.post(f"/api/v1/devices/{device}/alerts/{alert_id}/acknowledge").status_code, 404)
        self.assertIsNone(self.client.get("/api/v1/devices/tank-api/alerts").json()[0]["acknowledged_at"])

    def test_resolved_alert_can_be_acknowledged_without_reopening(self):
        self.send("turbidity-high")
        self.send(seconds=60)
        alert = self.client.get("/api/v1/devices/tank-api/alerts").json()[0]
        result = self.client.post(f"/api/v1/devices/tank-api/alerts/{alert['id']}/acknowledge").json()
        self.assertEqual(result["ended_at"], alert["ended_at"])
        self.assertIsNotNone(result["acknowledged_at"])


if __name__ == "__main__":
    unittest.main()
