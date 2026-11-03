from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from capture_uart import LineBuffer, capture


class CaptureTests(unittest.TestCase):
    def test_timeout_fragment_waits_for_newline(self):
        buffer = LineBuffer()
        self.assertEqual(buffer.feed(b'{"seq'), [])
        self.assertEqual(buffer.feed(b''), [])
        self.assertEqual(buffer.feed(b'uence":1}\r\nnext\npart'), [b'{"sequence":1}', b'next'])
        self.assertEqual(buffer.pending, b'part')

    def test_utf8_split_preserves_bytes(self):
        buffer = LineBuffer()
        encoded = 'nhiệt\n'.encode()
        lines = []
        for byte in encoded:
            lines.extend(buffer.feed(bytes([byte])))
        self.assertEqual(lines[0].decode(), 'nhiệt')

    def test_raw_evidence_survives_disconnect(self):
        class Port:
            calls = 0
            def read(self, size):
                self.calls += 1
                if self.calls == 1:
                    return b'complete\npartial'
                raise OSError('Disconnected')
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            report = capture(Port(), path, 10)
            self.assertEqual(report['status'], 'error')
            self.assertEqual(report['serial'], ['complete'])
            self.assertEqual((path / 'raw.bin').read_bytes(), b'complete\npartial')
            self.assertEqual((path / 'partial.bin').read_bytes(), b'partial')

    def test_no_duplicate_emission(self):
        buffer = LineBuffer()
        self.assertEqual(buffer.feed(b'PUBACK\n'), [b'PUBACK'])
        self.assertEqual(buffer.feed(b''), [])
        self.assertEqual(buffer.feed(b'other\n'), [b'other'])


if __name__ == '__main__':
    unittest.main()
