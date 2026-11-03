from datetime import datetime, timedelta, timezone
import json
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.ingest import ingest_message
from app.models import Alert


class AlertRuleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.device_id = "tank-alert-test"
        self.base_time = datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.engine.dispose()

    def send_telemetry(self, sequence, seconds, **changes):
        payload = {
            "schema_version": 2, "device_id": self.device_id,
            "timestamp": (self.base_time + timedelta(seconds=seconds)).isoformat(),
            "sequence": sequence, "temperature_c": 27.0, "ph": 7.0, "turbidity_pct": 20.0,
            "signal_strength_dbm": -55, "sensor_status": "normal",
        }
        payload.update(changes)
        ingest_message(f"aquarium-monitoring/devices/{self.device_id}/telemetry",
                       json.dumps(payload).encode(), self.sessions)

    def send_status(self, connectivity, seconds):
        payload = {
            "schema_version": 2, "device_id": self.device_id,
            "timestamp": (self.base_time + timedelta(seconds=seconds)).isoformat(),
            "connectivity": connectivity,
        }
        ingest_message(f"aquarium-monitoring/devices/{self.device_id}/status",
                       json.dumps(payload).encode(), self.sessions)

    def active_alert(self, alert_type):
        with self.sessions() as session:
            return session.scalar(select(Alert).where(
                Alert.alert_type == alert_type, Alert.ended_at.is_(None)))

    def test_opens_parameter_alerts(self):
        self.send_telemetry(1, 0, temperature_c=34, ph=5, turbidity_pct=90)
        for kind in ("temperature", "ph", "turbidity"):
            self.assertIsNotNone(self.active_alert(kind))
        self.assertEqual(self.active_alert("turbidity").severity, "critical")

    def test_normal_sample_closes_parameter_alerts(self):
        self.send_telemetry(1, 0, temperature_c=34, ph=5, turbidity_pct=90)
        self.send_telemetry(2, 60)
        for kind in ("temperature", "ph", "turbidity"):
            self.assertIsNone(self.active_alert(kind))

    def test_failed_probe_preserves_existing_alert_until_recovery(self):
        self.send_telemetry(1, 0, ph=5)
        self.send_telemetry(2, 60, ph=None, sensor_status="error")
        self.assertIsNotNone(self.active_alert("ph"))
        self.assertIsNotNone(self.active_alert("sensor_error_ph"))
        self.send_telemetry(3, 120)
        self.assertIsNone(self.active_alert("ph"))
        self.assertIsNone(self.active_alert("sensor_error_ph"))

    def test_independent_probe_recovery_and_delayed_samples(self):
        self.send_telemetry(1, 0, temperature_c=None, ph=None, turbidity_pct=None, sensor_status="error")
        for key in ("temperature", "ph", "clarity"):
            self.assertIsNotNone(self.active_alert(f"sensor_error_{key}"))
        self.send_telemetry(2, 60, temperature_c=None, ph=None, turbidity_pct=None,
                            turbidity_mv=244.9, turbidity_reference_mv=294, sensor_status="error")
        self.assertIsNone(self.active_alert("sensor_error_clarity"))
        ph_error = self.active_alert("sensor_error_ph")
        self.send_telemetry(3, 120, ph=None, turbidity_pct=None,
                            turbidity_mv=244.9, turbidity_reference_mv=294, sensor_status="error")
        self.assertIsNone(self.active_alert("sensor_error_temperature"))
        self.assertEqual(self.active_alert("sensor_error_ph").id, ph_error.id)
        self.assertEqual(self.active_alert("sensor_error_ph").started_at, ph_error.started_at)
        self.send_telemetry(4, 180, turbidity_pct=None, turbidity_mv=244.9,
                            turbidity_reference_mv=294, sensor_status="error")
        self.assertIsNone(self.active_alert("sensor_error_ph"))
        self.send_telemetry(5, 150, ph=None, sensor_status="error")
        self.assertIsNone(self.active_alert("sensor_error_ph"))

    def test_old_aggregate_is_retired_not_left_counting(self):
        self.send_telemetry(1, 0)
        with self.sessions() as session:
            session.add(Alert(device_id=self.device_id, alert_type="sensor_error", severity="critical",
                              message="Không có số đo hợp lệ: nhiệt độ, pH, độ đục", started_at=self.base_time))
            session.commit()
        self.send_telemetry(2, 60, temperature_c=None, ph=None, turbidity_pct=None,
                            turbidity_mv=244.9, turbidity_reference_mv=294, sensor_status="error")
        self.assertIsNone(self.active_alert("sensor_error"))
        self.assertIsNotNone(self.active_alert("sensor_error_temperature"))
        self.assertIsNotNone(self.active_alert("sensor_error_ph"))
        self.assertIsNone(self.active_alert("sensor_error_clarity"))

    def test_prolonged_violation_does_not_duplicate_open_alert(self):
        self.send_telemetry(1, 0, turbidity_pct=65)
        initial = self.active_alert("turbidity")
        self.send_telemetry(2, 3600, turbidity_pct=90)
        self.assertEqual(self.active_alert("turbidity").id, initial.id)
        self.assertEqual(self.active_alert("turbidity").severity, "critical")
        with self.sessions() as session:
            self.assertEqual(len(list(session.scalars(select(Alert).where(Alert.alert_type == "turbidity")))), 1)

    def test_offline_is_closed_by_status_or_real_telemetry(self):
        self.send_status("offline", 0)
        self.assertIsNotNone(self.active_alert("offline"))
        self.send_status("online", 60)
        self.assertIsNone(self.active_alert("offline"))
        self.send_status("offline", 120)
        self.send_telemetry(1, 180)
        self.assertIsNone(self.active_alert("offline"))


if __name__ == "__main__":
    unittest.main()
