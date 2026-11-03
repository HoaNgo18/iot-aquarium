import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("analyze_uart", Path(__file__).parents[1] / "analyze_uart.py")
uart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uart)


def sample(sequence, device="tank-test", timestamp="2026-10-23T00:00:00Z"):
    return '[DATA queued id=1] ' + json.dumps(dict(device_id=device, sequence=sequence, timestamp=timestamp))


class UartTests(unittest.TestCase):
    def test_corrupt_line_does_not_stop_processing(self):
        result = uart.analyze([sample(1), '[DATA queued id=2] {broken', sample(2)])
        self.assertEqual(result['counts']['parsed_payloads'], 2)
        self.assertEqual(result['issues'], [{'line': 2, 'kind': 'malformed_payload'}])

    def test_boot_resets_sequence_and_duplicate_detection(self):
        result = uart.analyze([sample(1), sample(1), '[BOOT] aquarium', sample(1)])
        self.assertEqual(result['counts']['repeated_identity'], 1)
        self.assertNotIn('sequence_non_increasing', result['counts'])

    def test_gaps_are_per_device(self):
        result = uart.analyze([sample(1), sample(100, 'other'), sample(4), sample(2)])
        self.assertEqual(result['counts']['sequence_numbers_not_observed'], 2)
        self.assertEqual(result['counts']['sequence_non_increasing'], 1)

    def test_invalid_identity_and_encoding(self):
        result = uart.analyze([sample(True), '[DATA queued id=1] []', '\ufffd', None])
        self.assertEqual(result['counts']['malformed_payload'], 2)
        self.assertEqual(result['counts']['decode_damage'], 1)
        self.assertEqual(result['counts']['invalid_log_entry'], 1)

    def test_puback_is_only_a_line_count(self):
        result = uart.analyze(['[MQTT] PUBACK id=1'] * 3)
        self.assertEqual(result['counts']['puback_lines'], 3)
        self.assertNotIn('parsed_payloads', result['counts'])

    def test_limits_issue_details(self):
        result = uart.analyze(['[DATA queued broken'] * 150)
        self.assertEqual(len(result['issues']), 100)
        self.assertTrue(result['issues_truncated'])
        self.assertEqual(result['counts']['malformed_payload'], 150)

    def test_load_text_and_existing_report(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'log.json'
            path.write_text(json.dumps({'serial': [sample(1)]}), encoding='utf-8-sig')
            self.assertEqual(uart.load_lines(path), [sample(1)])
            path.write_text('{}', encoding='utf-8')
            with self.assertRaises(ValueError):
                uart.load_lines(path)
            path = Path(directory) / 'log.txt'
            path.write_bytes(b'bad\xff\nnext')
            self.assertEqual(uart.load_lines(path), ['bad\ufffd', 'next'])


if __name__ == '__main__':
    unittest.main()
