from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app.api import auth as auth_api
from app.database import Base, get_db
from app.ingest import ingest_message
from app.main import create_app
from app.security import SESSION_COOKIE, check_pairing_code, hash_password, pairing_code, read_session, verify_password

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "simulator"))
from telemetry import TelemetryGenerator


class SecurityTests(unittest.TestCase):
    def test_password_hash_round_trip_and_salt(self):
        stored = hash_password("matkhau-123")
        self.assertTrue(verify_password("matkhau-123", stored))
        self.assertFalse(verify_password("sai", stored))
        self.assertNotEqual(stored, hash_password("matkhau-123"))
        self.assertFalse(verify_password("x", "rác"))

    def test_session_token_rejects_tampering_and_expiry(self):
        from app.security import issue_session
        token = issue_session(7, 0, now=1000)
        self.assertEqual(read_session(token, now=1001), (7, 0))
        self.assertIsNone(read_session(token.replace("7.", "8.", 1), now=1001))
        self.assertIsNone(read_session(token, now=1000 + 15 * 86400))
        self.assertIsNone(read_session("rác"))

    def test_pairing_code_format_and_check(self):
        code = pairing_code("tank-a")
        self.assertRegex(code, r"^[A-Z2-7]{4}-[A-Z2-7]{4}$")
        self.assertTrue(check_pairing_code("tank-a", code.lower().replace("-", "")))
        self.assertFalse(check_pairing_code("tank-b", code))


class AccountAndTankApiTests(unittest.TestCase):
    def setUp(self):
        auth_api._FAILURES.clear()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.app = create_app(start_background_services=False)
        self.app.state.session_factory = self.sessions

        def db_override():
            with self.sessions() as session:
                yield session

        self.app.dependency_overrides[get_db] = db_override
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.engine.dispose()

    def other_client(self):
        context = TestClient(self.app)
        self.addCleanup(context.__exit__, None, None, None)
        return context.__enter__()

    def register(self, client=None, username="hoa", password="matkhau-123"):
        client = client or self.client
        return client.post("/api/v1/auth/register", json={"username": username, "display_name": username.title(), "password": password})

    def send(self, device="tank-a", count=1):
        step = iter(range(count))
        start = datetime(2026, 11, 3, tzinfo=timezone.utc)
        generator = TelemetryGenerator(device, "normal", seed=1, clock=lambda: start.replace(second=next(step)).isoformat())
        for _ in range(count):
            ingest_message(f"aquarium-monitoring/devices/{device}/telemetry", json.dumps(generator.next_payload()).encode(), self.sessions)

    def add_tank(self, client=None, device="tank-a", code=None, name="Bể chính"):
        client = client or self.client
        return client.post("/api/v1/tanks", json={"name": name, "device_id": device, "pairing_code": code or pairing_code(device), "volume_l": 60})

    def test_register_login_logout_and_me(self):
        created = self.register()
        self.assertEqual(created.status_code, 201)
        self.assertIn(SESSION_COOKIE, created.cookies)
        cookie = created.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)
        self.assertNotIn("password_hash", created.json())
        self.assertEqual(self.client.get("/api/v1/auth/me").json()["username"], "hoa")
        self.assertEqual(self.client.post("/api/v1/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)
        login = self.client.post("/api/v1/auth/login", json={"username": "HOA", "password": "matkhau-123"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 200)

    def test_registration_validation_and_duplicates(self):
        self.register()
        self.assertEqual(self.register(self.other_client()).status_code, 409)
        bad = self.other_client().post("/api/v1/auth/register", json={"username": "a b", "display_name": "X", "password": "matkhau-123"})
        self.assertEqual(bad.status_code, 422)
        short = self.other_client().post("/api/v1/auth/register", json={"username": "lan", "display_name": "Lan", "password": "123"})
        self.assertEqual(short.status_code, 422)

    def test_wrong_password_and_rate_limit(self):
        self.register()
        anon = self.other_client()
        for _ in range(5):
            self.assertEqual(anon.post("/api/v1/auth/login", json={"username": "hoa", "password": "sai-mat-khau"}).status_code, 401)
        self.assertEqual(anon.post("/api/v1/auth/login", json={"username": "hoa", "password": "matkhau-123"}).status_code, 429)

    def test_password_change_revokes_other_sessions(self):
        self.register()
        second = self.other_client()
        self.assertEqual(second.post("/api/v1/auth/login", json={"username": "hoa", "password": "matkhau-123"}).status_code, 200)
        wrong = self.client.post("/api/v1/auth/password", json={"current_password": "x", "new_password": "matkhau-moi-1"})
        self.assertEqual(wrong.status_code, 400)
        ok = self.client.post("/api/v1/auth/password", json={"current_password": "matkhau-123", "new_password": "matkhau-moi-1"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 200)
        self.assertEqual(second.get("/api/v1/auth/me").status_code, 401)
        renamed = self.client.patch("/api/v1/auth/me", json={"display_name": "  Tuấn Hòa "})
        self.assertEqual(renamed.json()["display_name"], "Tuấn Hòa")

    def test_tank_crud_with_pairing_code(self):
        self.send(count=3)
        self.register()
        self.assertEqual(self.add_tank(code="AAAA-AAAA").status_code, 400)
        created = self.add_tank()
        self.assertEqual(created.status_code, 201)
        tank = created.json()
        self.assertEqual(tank["device_id"], "tank-a")
        self.assertIsNotNone(tank["latest"])
        self.assertEqual(self.add_tank().status_code, 409)
        listed = self.client.get("/api/v1/tanks").json()
        self.assertEqual([item["name"] for item in listed], ["Bể chính"])
        patched = self.client.patch(f"/api/v1/tanks/{tank['id']}", json={"name": "Bể phòng khách", "species": "Cá bảy màu"})
        self.assertEqual(patched.json()["name"], "Bể phòng khách")
        self.assertEqual(patched.json()["species"], "Cá bảy màu")
        self.assertEqual(self.client.patch(f"/api/v1/tanks/{tank['id']}", json={"name": "  "}).status_code, 422)
        self.assertEqual(self.client.delete(f"/api/v1/tanks/{tank['id']}").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/tanks").json(), [])
        self.assertEqual(self.add_tank().status_code, 201)  # dữ liệu cũ vẫn còn, ghép lại được

    def test_device_never_seen_can_be_paired(self):
        self.register()
        created = self.add_tank(device="tank-new")
        self.assertEqual(created.status_code, 201)
        self.assertIsNone(created.json()["latest"])
        self.assertEqual(created.json()["connectivity"], "offline")

    def test_device_apis_require_login_and_ownership(self):
        self.send()
        self.assertEqual(self.client.get("/api/v1/devices/tank-a/telemetry/latest").status_code, 401)
        self.register()
        self.assertEqual(self.client.get("/api/v1/devices/tank-a/telemetry/latest").status_code, 404)
        self.add_tank()
        self.assertEqual(self.client.get("/api/v1/devices/tank-a/telemetry/latest").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/devices/tank-a/settings").status_code, 200)

        intruder = self.other_client()
        self.register(intruder, "lan")
        self.assertEqual(self.add_tank(intruder).status_code, 409)
        for path in ("/api/v1/devices/tank-a", "/api/v1/devices/tank-a/telemetry/latest", "/api/v1/devices/tank-a/alerts",
                     "/api/v1/devices/tank-a/thresholds", "/api/v1/devices/tank-a/settings", "/api/v1/devices/tank-a/clarity/config",
                     "/api/v1/devices/tank-a/telemetry/export.csv?from=2026-11-01T00:00:00Z&to=2026-11-04T00:00:00Z"):
            self.assertEqual(intruder.get(path).status_code, 404, path)
        own_id = self.client.get("/api/v1/tanks").json()[0]["id"]
        self.assertEqual(intruder.patch(f"/api/v1/tanks/{own_id}", json={"name": "x"}).status_code, 404)
        self.assertEqual(intruder.delete(f"/api/v1/tanks/{own_id}").status_code, 404)

    def test_websocket_requires_owner_session(self):
        self.send()
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/ws?device_id=tank-a") as socket:
                socket.receive_json()
        self.register()
        self.add_tank()
        with self.client.websocket_connect("/ws?device_id=tank-a") as socket:
            self.assertEqual(socket.receive_json()["type"], "connected")
        intruder = self.other_client()
        self.register(intruder, "lan")
        with self.assertRaises(WebSocketDisconnect):
            with intruder.websocket_connect("/ws?device_id=tank-a") as socket:
                socket.receive_json()


if __name__ == "__main__":
    unittest.main()
