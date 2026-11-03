from datetime import datetime, timedelta, timezone
import json
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import create_app
from app.ingest import ingest_message
from app.models import Telemetry, Alert, ClarityBaseline
from app.services.clarity import classify

class ClarityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        app = create_app(start_background_services=False)
        def db():
            with self.sessions() as session:
                yield session
        app.dependency_overrides[get_db] = db
        self.client = TestClient(app)
        self.client.__enter__()
        self.now = datetime.now(timezone.utc)
        self.sequence = 0

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.engine.dispose()

    def send(self, mv, seconds=0, device='clarity-test'):
        self.sequence += 1
        payload = dict(schema_version=2, device_id=device, sequence=self.sequence,
            timestamp=(self.now + timedelta(seconds=seconds)).isoformat(), temperature_c=None,
            ph=None, turbidity_pct=None, turbidity_mv=mv, turbidity_reference_mv=294,
            signal_strength_dbm=-50, sensor_status='error')
        ingest_message(f'aquarium-monitoring/devices/{device}/telemetry', json.dumps(payload).encode(), self.sessions)
        with self.sessions() as session:
            return session.scalar(select(Telemetry).where(Telemetry.device_id == device).order_by(Telemetry.measured_at.desc()).limit(1))

    def test_thresholds_and_hysteresis(self):
        for value, previous, expected in (
            (90, None, 'clear'), (90.1, None, 'clear'), (89.99, None, 'slight'),
            (83.2, None, 'slight'), (70, None, 'slight'), (69.99, None, 'cloudy'),
            (73, 'cloudy', 'cloudy'), (75, 'cloudy', 'cloudy'), (75.01, 'cloudy', 'slight'),
            (90, 'slight', 'slight'), (93, 'slight', 'slight'), (93.01, 'slight', 'clear')):
            with self.subTest(value=value, previous=previous):
                self.assertEqual(classify(value, previous), expected)

    def test_config_api_is_the_classifier_source(self):
        from dataclasses import asdict
        from unittest.mock import patch
        from app.domain.clarity_config import CLARITY_CONFIG, ClarityConfig
        self.assertEqual(self.client.get('/api/v1/devices/clarity-test/clarity/config').json(), asdict(CLARITY_CONFIG))
        changed = ClarityConfig(clear_min_pct=85)
        with patch('app.services.clarity.CLARITY_CONFIG', changed):
            self.assertEqual(classify(87), 'clear')

    def test_api_reports_independent_health(self):
        self.send(244.9)
        row = self.client.get('/api/v1/devices/clarity-test/telemetry/latest').json()
        self.assertEqual(row['sensor_health'], {'temperature': False, 'ph': False, 'clarity': True})
        alerts = self.client.get('/api/v1/devices/clarity-test/alerts?active_only=true').json()
        self.assertEqual({a['alert_type'] for a in alerts}, {'sensor_error_temperature', 'sensor_error_ph'})

    def test_median_rejects_spike_ema_persisted_unknown_is_unknown(self):
        for second in range(0, 75, 5): self.send(294, second)
        row = self.send(180, 75)
        self.assertEqual(row.clarity_pct, 100)
        self.assertEqual(row.clarity_state, 'clear')
        row = self.send(None, 80)
        self.assertIsNone(row.clarity_pct)
        row = self.send(200, 85)
        self.assertEqual(row.clarity_state, 'cloudy')
        self.assertEqual(row.clarity_since.replace(tzinfo=timezone.utc), self.now + timedelta(seconds=85))

    def test_alert_requires_continuous_30_minutes_and_deduplicates(self):
        for seconds in range(0, 1821, 20): self.send(190, seconds)
        with self.sessions() as session:
            alerts = list(session.scalars(select(Alert).where(Alert.alert_type == 'clarity')))
            self.assertEqual(len(alerts), 1)
            self.assertIsNone(alerts[0].ended_at)
        # A gap resets timing; an invalid sample does not invent clear water.
        self.send(None, 1840)
        row = self.send(190, 1900)
        self.assertEqual(row.clarity_since.replace(tzinfo=timezone.utc), self.now + timedelta(seconds=1900))
        for seconds in range(1920, 2341, 20): self.send(294, seconds)
        with self.sessions() as session:
            alert = session.scalar(select(Alert).where(Alert.alert_type == 'clarity'))
            self.assertIsNotNone(alert.ended_at)

    def test_baseline_rejects_stale_and_unstable(self):
        self.send(294, -120)
        self.assertEqual(self.client.post('/api/v1/devices/clarity-test/clarity/baselines', json={}).status_code, 409)
        for i in range(15): self.send(200 if i % 2 else 294, -75 + i * 5)
        self.assertEqual(self.client.post('/api/v1/devices/clarity-test/clarity/baselines', json={}).status_code, 409)

    def test_baseline_persists_isolates_history_and_devices(self):
        for i in range(15): self.send(280, -75 + i * 5)
        response = self.client.post('/api/v1/devices/clarity-test/clarity/baselines', json={'water_changed': True})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['reference_mv'], 280)
        self.assertTrue(response.json()['water_changed'])
        row = self.send(280, 5)
        self.assertEqual(row.clarity_pct, 100)
        self.assertEqual(row.turbidity_reference_mv, 280)
        with self.sessions() as session:
            old = session.scalar(select(Telemetry).order_by(Telemetry.id))
            self.assertEqual(old.turbidity_reference_mv, 294)
        other = self.send(280, 5, 'other-device')
        self.assertEqual(other.turbidity_reference_mv, 294)
        self.assertEqual(self.client.get('/api/v1/devices/other-device/clarity/baselines').json(), [])

    def test_series_covers_full_window_and_does_not_change_legacy_endpoint(self):
        for seconds in (-6*86400, -3600, -5): self.send(280, seconds)
        response = self.client.get('/api/v1/devices/clarity-test/telemetry/series?minutes=10080')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()), 3)
        self.assertEqual(self.client.get('/api/v1/devices/clarity-test/telemetry/series?minutes=10081').status_code, 422)
        self.assertEqual(len(self.client.get('/api/v1/devices/clarity-test/telemetry?limit=1').json()), 1)

    def test_late_sample_does_not_rewind_state(self):
        self.send(190, 10)
        row = self.send(294, 0)
        self.assertEqual(row.clarity_state, 'cloudy')
        with self.sessions() as session:
            delayed = session.scalar(select(Telemetry).order_by(Telemetry.id.desc()))
            self.assertIsNone(delayed.clarity_state)
