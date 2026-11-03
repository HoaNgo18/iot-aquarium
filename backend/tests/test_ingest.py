from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.ingest import IngestResult, ingest_message
from app.models import Alert, Device, Telemetry


class IngestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

    def tearDown(self) -> None:
        self.engine.dispose()

    def telemetry(self) -> bytes:
        return json.dumps(
            {
                "schema_version": 2,
                "device_id": "node-test",
                "timestamp": "2026-10-13T01:00:00Z",
                "sequence": 1,
                "temperature_c": 27.0,
                "ph": 7.0,
                "turbidity_pct": 20.0,
                "signal_strength_dbm": -55,
                "sensor_status": "normal",
            }
        ).encode()

    def test_stores_telemetry_and_updates_device(self) -> None:
        result = ingest_message(
            "aquarium-monitoring/devices/node-test/telemetry", self.telemetry(), self.sessions
        )
        with self.sessions() as session:
            device = session.get(Device, "node-test")
            count = session.scalar(select(func.count()).select_from(Telemetry))

        self.assertEqual(result, IngestResult.STORED)
        self.assertEqual(count, 1)
        self.assertEqual(device.connectivity, "online")

    def test_duplicate_is_not_stored_twice(self) -> None:
        topic = "aquarium-monitoring/devices/node-test/telemetry"
        ingest_message(topic, self.telemetry(), self.sessions)
        result = ingest_message(topic, self.telemetry(), self.sessions)
        with self.sessions() as session:
            count = session.scalar(select(func.count()).select_from(Telemetry))

        self.assertEqual(result, IngestResult.DUPLICATE)
        self.assertEqual(count, 1)

    def test_stores_uncalibrated_voltage_without_turbidity_alarm(self):
        from app.schemas import TelemetryResponse
        payload = json.loads(self.telemetry())
        payload.update(turbidity_pct=None, turbidity_mv=291,
                       turbidity_reference_mv=294, sensor_status="error")
        result = ingest_message("aquarium-monitoring/devices/node-test/telemetry",
                                json.dumps(payload).encode(), self.sessions)
        self.assertEqual(result, IngestResult.STORED)
        with self.sessions() as session:
            row = session.scalar(select(Telemetry))
            response = TelemetryResponse.model_validate(row)
            self.assertEqual(response.turbidity_mv, 291)
            self.assertEqual(response.turbidity_reference_mv, 294)
            self.assertIsNone(response.turbidity_pct)
            alerts = list(session.scalars(select(Alert)))
            self.assertNotIn("turbidity", [a.alert_type for a in alerts])

    def test_rejects_device_id_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            ingest_message(
                "aquarium-monitoring/devices/another-node/telemetry",
                self.telemetry(),
                self.sessions,
            )

    def test_updates_offline_status(self) -> None:
        status = json.dumps(
            {
                "schema_version": 2,
                "device_id": "node-test",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "connectivity": "offline",
            }
        ).encode()
        ingest_message("aquarium-monitoring/devices/node-test/status", status, self.sessions)
        with self.sessions() as session:
            device = session.get(Device, "node-test")
        self.assertEqual(device.connectivity, "offline")

    def test_old_last_will_preserves_last_seen_and_uses_observation_time(self) -> None:
        topic = "aquarium-monitoring/devices/node-test/"
        ingest_message(topic + "telemetry", self.telemetry(), self.sessions)
        observed = datetime(2026, 10, 13, 2, 0, tzinfo=timezone.utc)
        will = json.dumps({
            "schema_version": 2, "device_id": "node-test",
            "timestamp": "2026-10-12T00:00:00Z", "connectivity": "offline",
        }).encode()
        with patch("app.ingest.datetime") as clock:
            clock.now.return_value = observed
            ingest_message(topic + "status", will, self.sessions)
        with self.sessions() as session:
            device = session.get(Device, "node-test")
            alert = session.scalar(select(Alert).where(Alert.alert_type == "offline"))
            self.assertEqual(device.last_seen_at.replace(tzinfo=timezone.utc), datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc))
            self.assertEqual(alert.started_at.replace(tzinfo=timezone.utc), observed)

        # A delayed recovery sample must not close an offline alert before it began.
        recovery = json.loads(self.telemetry())
        recovery["sequence"] = 2
        recovered_at = datetime(2026, 10, 13, 2, 1, tzinfo=timezone.utc)
        with patch("app.ingest.datetime") as clock:
            clock.now.return_value = recovered_at
            ingest_message(topic + "telemetry", json.dumps(recovery).encode(), self.sessions)
        with self.sessions() as session:
            alert = session.scalar(select(Alert).where(Alert.alert_type == "offline"))
            self.assertEqual(alert.ended_at.replace(tzinfo=timezone.utc), recovered_at)

    def test_old_online_status_does_not_move_last_seen_backwards(self) -> None:
        topic = "aquarium-monitoring/devices/node-test/"
        ingest_message(topic + "telemetry", self.telemetry(), self.sessions)
        status = json.dumps({
            "schema_version": 2, "device_id": "node-test",
            "timestamp": "2026-10-12T00:00:00Z", "connectivity": "online",
        }).encode()
        ingest_message(topic + "status", status, self.sessions)
        with self.sessions() as session:
            device = session.get(Device, "node-test")
            self.assertEqual(device.last_seen_at.replace(tzinfo=timezone.utc), datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
