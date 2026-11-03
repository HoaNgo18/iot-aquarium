from datetime import datetime, timedelta, timezone
import json
import math
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.models import Device, Threshold, Telemetry, Alert
from app.main import create_app
from app.ingest import ingest_message
from app.services.sensor_errors import check_sensor_timeouts


class DeviceSettingsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as session:
            session.add_all([Device(id='a'), Device(id='b')]); session.commit()
        app = create_app(start_background_services=False)
        def db():
            with self.sessions() as session:
                yield session
        app.dependency_overrides[get_db] = db
        self.client = TestClient(app); self.client.__enter__()
        self.now = datetime.now(timezone.utc); self.sequence = 0

    def tearDown(self):
        self.client.__exit__(None, None, None); self.engine.dispose()

    def settings(self, device='a'):
        return self.client.get(f'/api/v1/devices/{device}/settings').json()

    def save(self, changes, device='a', revision=None):
        current = self.settings(device)
        return self.client.put(f'/api/v1/devices/{device}/settings', json={
            'revision': current['revision'] if revision is None else revision,
            'values': {**current['values'], **changes}})

    def send(self, seconds=0, device='a', **changes):
        self.sequence += 1
        at = self.now + timedelta(seconds=seconds)
        values = dict(schema_version=2, device_id=device, timestamp=at.isoformat(), sequence=self.sequence,
                      temperature_c=27, ph=7, turbidity_pct=None, turbidity_mv=294,
                      turbidity_reference_mv=294, sensor_status='normal', signal_strength_dbm=-60)
        values.update(changes)
        with patch('app.ingest.datetime') as clock:
            clock.now.return_value = at
            ingest_message(f'aquarium-monitoring/devices/{device}/telemetry', json.dumps(values).encode(), self.sessions)
        return self.client.get(f'/api/v1/devices/{device}/telemetry/latest').json()

    def active(self, device='a'):
        return self.client.get(f'/api/v1/devices/{device}/alerts?active_only=true').json()

    def test_persists_per_device_and_inherits_existing_temperature_ph(self):
        with self.sessions() as session:
            session.add(Threshold(device_id='a', temperature_min_c=23, ph_min=6.8)); session.commit()
        self.assertEqual(self.settings()['values']['temperature_min_c'], 23)
        response = self.save({'temperature_min_c': 24, 'temperature_max_c': 26, 'temperature_preset': 'tropical'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.settings()['values']['temperature_min_c'], 24)
        self.assertEqual(self.settings('b')['values']['temperature_min_c'], 22)
        self.assertEqual(self.client.get('/api/v1/devices/a/thresholds').json()['temperature_min_c'], 24)
        history = self.client.get('/api/v1/devices/a/settings/history').json()
        self.assertEqual(history[0]['before']['temperature_min_c'], 23)
        self.assertEqual(history[0]['after']['temperature_min_c'], 24)
        self.assertEqual(self.client.get('/api/v1/devices/b/settings/history').json(), [])

    def test_uncalibrated_ph_voltage_round_trip_without_ph_alert(self):
        row = self.send(ph=None, ph_mv=1275)
        self.assertEqual(row['ph_mv'], 1275)
        self.assertIsNone(row['ph'])
        self.assertTrue(row['sensor_health']['ph'])
        self.send(5, ph=None, ph_mv=1274)
        self.assertFalse(any(a['alert_type'] in ('ph', 'sensor_error_ph') for a in self.active()))
        latest = self.client.get('/api/v1/devices/a/telemetry/last-valid').json()['ph']
        self.assertEqual(latest['ph_mv'], 1274)
        series = self.client.get('/api/v1/devices/a/telemetry/series?minutes=15').json()
        self.assertTrue(any(r['ph_mv'] == 1275 and r['ph'] is None for r in series))
        self.send(10, ph=None, ph_mv=None)
        self.assertEqual(self.client.get('/api/v1/devices/a/telemetry/last-valid').json()['ph']['ph_mv'], 1274)

    def test_rejects_invalid_values_without_writing_and_detects_conflicts(self):
        for changes in ({'temperature_min_c': 40}, {'ph_min': 9}, {'cloudy_below_pct': 95},
                        {'cloudy_recovery_above_pct': 95}, {'clear_recovery_above_pct': 80},
                        {'median_window': 14}, {'ema_seconds': 0}, {'sensor_timeout_minutes': -1}, {'surprise': 1}):
            with self.subTest(changes=changes):
                self.assertEqual(self.save(changes).status_code, 422)
        self.assertEqual(self.settings()['revision'], 0)
        self.assertEqual(self.save({'ph_min': 6.8}).status_code, 200)
        self.assertEqual(self.save({'ph_min': 7}, revision=0).status_code, 409)
        self.assertEqual(self.settings()['values']['ph_min'], 6.8)
        self.assertEqual(self.save({'ph_min': 6.8}).status_code, 200)
        self.assertEqual(len(self.client.get('/api/v1/devices/a/settings/history').json()), 1)

    def test_clarity_thresholds_and_filter_apply_only_to_selected_device(self):
        self.save({'clear_min_pct': 80, 'cloudy_below_pct': 60, 'clear_recovery_above_pct': 83,
                   'cloudy_recovery_above_pct': 65, 'median_window': 1, 'ema_seconds': 1, 'sensitivity': 'custom'})
        for device in ('a', 'b'):
            self.send(device=device)
        a = self.send(5, turbidity_mv=250)
        b = self.send(5, device='b', turbidity_mv=250)
        self.assertEqual(a['clarity_state'], 'clear')
        self.assertAlmostEqual(a['clarity_mv'], (1-math.exp(-5)) * 250 + math.exp(-5) * 294)
        self.assertNotEqual(a['clarity_mv'], b['clarity_mv'])
        self.assertEqual(self.client.get('/api/v1/devices/a/clarity/config').json()['clear_min_pct'], 80)
        self.assertEqual(self.client.get('/api/v1/devices/b/clarity/config').json()['clear_min_pct'], 90)

    def test_settings_revision_starts_fresh_filter_without_rewriting_history(self):
        self.send()
        self.save({'ema_seconds': 10, 'sensitivity': 'custom'})
        new = self.send(5, turbidity_mv=200)
        self.assertEqual(new['clarity_mv'], 200)
        with self.sessions() as session:
            first = session.scalar(select(Telemetry).order_by(Telemetry.id))
            self.assertEqual(first.clarity_mv, 294)
            self.assertEqual(first.settings_revision, 0)

    def test_temperature_change_keeps_clarity_filter_continuous(self):
        self.send()
        self.save({'temperature_min_c': 23})
        new = self.send(5, turbidity_mv=200)
        # Existing median (294 + 200)/2 and EMA are preserved for unrelated edits.
        self.assertAlmostEqual(new['clarity_mv'], (1-math.exp(-5/20)) * 247 + math.exp(-5/20) * 294)

    def test_delayed_errors_fire_even_without_more_messages_and_recover_individually(self):
        self.save({'sensor_timeout_minutes': 1})
        self.send(ph=None, sensor_status='error')
        self.assertEqual(self.active(), [])
        check_sensor_timeouts(self.sessions, self.now + timedelta(seconds=59))
        self.assertEqual(self.active(), [])
        check_sensor_timeouts(self.sessions, self.now + timedelta(seconds=61))
        self.assertEqual({row['alert_type'] for row in self.active()}, {'offline'})
        self.send(65, temperature_c=None, turbidity_mv=None, sensor_status='error')
        self.assertNotIn('sensor_error_ph', {row['alert_type'] for row in self.active()})
        self.send(70)
        self.assertEqual(self.active(), [])

    def test_sensor_error_only_when_device_is_still_sending_samples(self):
        self.save({'sensor_timeout_minutes': 1})
        self.send(ph=None, sensor_status='error')
        self.send(40, ph=None, sensor_status='error')
        check_sensor_timeouts(self.sessions, self.now + timedelta(seconds=61))
        self.assertEqual({row['alert_type'] for row in self.active()}, {'sensor_error_ph'})
        payload = dict(schema_version=2, device_id='a', timestamp=(self.now + timedelta(seconds=65)).isoformat(), connectivity='offline')
        with patch('app.ingest.datetime') as clock:
            clock.now.return_value = self.now + timedelta(seconds=65)
            ingest_message('aquarium-monitoring/devices/a/status', json.dumps(payload).encode(), self.sessions)
        self.assertEqual({row['alert_type'] for row in self.active()}, {'offline'})
        history = self.client.get('/api/v1/devices/a/alerts').json()
        suspended = next(row for row in history if row['alert_type'] == 'sensor_error_ph')
        self.assertIsNotNone(suspended['ended_at'])
        self.assertIn('thiết bị mất kết nối', suspended['message'])

    def test_last_valid_readings_survive_invalid_samples_and_chart_window(self):
        self.send(-3 * 86400)
        self.send(0, temperature_c=None, ph=None, turbidity_mv=None, sensor_status='error')
        latest = self.client.get('/api/v1/devices/a/telemetry/latest').json()
        self.assertIsNone(latest['clarity_pct'])
        readings = self.client.get('/api/v1/devices/a/telemetry/last-valid').json()
        self.assertEqual(readings['temperature']['temperature_c'], 27)
        self.assertEqual(readings['ph']['ph'], 7)
        self.assertEqual(readings['clarity']['clarity_pct'], 100)
        self.assertTrue(all(row['measured_at'].startswith((self.now - timedelta(days=3)).date().isoformat()) for row in readings.values()))
        self.assertEqual(self.client.get('/api/v1/devices/b/telemetry/last-valid').json(), {'temperature': None, 'ph': None, 'clarity': None})

    def test_baseline_audit_is_atomic_and_has_old_new_mv(self):
        for seconds in range(-70, 1, 5):
            self.send(seconds, turbidity_mv=280)
        result = self.client.post('/api/v1/devices/a/clarity/baselines', json={'water_changed': True})
        self.assertEqual(result.status_code, 201, result.text)
        history = self.client.get('/api/v1/devices/a/settings/history').json()
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['action'], 'baseline')
        self.assertEqual(history[0]['before']['reference_mv'], 294)
        self.assertEqual(history[0]['after']['reference_mv'], 280)
        self.assertTrue(history[0]['after']['water_changed'])
        self.assertEqual(self.client.get('/api/v1/devices/b/settings/history').json(), [])
        # A second save before the next sensor sample must use the already-saved reference.
        result = self.client.post('/api/v1/devices/a/clarity/baselines', json={'water_changed': True})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(self.client.get('/api/v1/devices/a/settings/history').json()[0]['before']['reference_mv'], 280)
