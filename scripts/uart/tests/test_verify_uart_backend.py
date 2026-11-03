import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from verify_uart_backend import verify


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.sample = dict(device_id='tank-test', sequence=1, timestamp='2026-10-23T07:00:00+07:00',
                           temperature_c=27.5, ph=None, turbidity_pct=20,
                           signal_strength_dbm=-60, sensor_status='error')
        self.row = {**self.sample, 'measured_at': '2026-10-23T00:00:00Z'}

    def run_sample(self, rows):
        return verify(['[DATA queued id=1] ' + json.dumps(self.sample)], lambda *_: rows)

    def test_matches_normalized_time_and_null(self):
        self.assertTrue(self.run_sample([self.row])['verified'])

    def test_missing_is_not_delivery_failure_claim(self):
        result = self.run_sample([])
        self.assertFalse(result['verified'])
        self.assertEqual(result['samples'][0]['status'], 'not_found')

    def test_value_mismatch(self):
        self.row['ph'] = 0
        self.assertEqual(self.run_sample([self.row])['samples'][0]['different_fields'], ['ph'])

    def test_empty_or_corrupt_never_pass(self):
        self.assertFalse(verify([], lambda *_: [])['verified'])
        self.assertFalse(verify(['[DATA queued id=1] {bad'], lambda *_: [])['verified'])

    def test_truncated_and_ambiguous_response(self):
        self.assertEqual(self.run_sample([self.row] * 1000)['samples'][0]['status'], 'fetch_error')
        self.assertEqual(self.run_sample([self.row] * 2)['samples'][0]['status'], 'ambiguous')

    def test_network_failure(self):
        def fail(*_):
            raise OSError('offline')
        result = verify(['[DATA queued id=1] ' + json.dumps(self.sample)], fail)
        self.assertEqual(result['samples'][0]['status'], 'fetch_error')

    def test_missing_fields_not_null(self):
        del self.row['ph']
        self.assertFalse(self.run_sample([self.row])['verified'])


if __name__ == '__main__':
    unittest.main()
