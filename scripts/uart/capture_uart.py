"""Bounded passive UART capture; no writes, buffer clearing, or deliberate reset."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time


class LineBuffer:
    def __init__(self):
        self.pending = bytearray()

    def feed(self, data):
        self.pending.extend(data)
        lines = []
        while True:
            end = self.pending.find(b'\n')
            if end < 0:
                break
            lines.append(bytes(self.pending[:end]).rstrip(b'\r'))
            del self.pending[:end + 1]
        return lines


def capture(port, directory, seconds, clock=time.monotonic):
    framer = LineBuffer()
    report = {'started_at': datetime.now(timezone.utc).isoformat(),
              'serial': [], 'bytes': 0, 'status': 'capturing',
              'note': 'Opening COM may toggle driver control lines despite DTR/RTS=False.'}
    deadline = clock() + seconds
    # Exclusive creation prevents accidental overwriting of evidence.
    with (directory / 'raw.bin').open('xb') as raw:
        try:
            while clock() < deadline:
                chunk = port.read(4096)
                if not chunk:
                    continue
                raw.write(chunk)
                raw.flush()
                report['bytes'] += len(chunk)
                for line in framer.feed(chunk):
                    report['serial'].append(line.decode('utf-8', errors='replace'))
                if len(framer.pending) > 65536 or report['bytes'] > 16 * 1024 * 1024:
                    raise ValueError('Capture size limit reached')
            report['status'] = 'complete' if report['bytes'] else 'no_data'
        except (Exception, KeyboardInterrupt) as exc:
            report['status'] = 'interrupted' if isinstance(exc, KeyboardInterrupt) else 'error'
            report['error_type'] = type(exc).__name__
        finally:
            # Do not parse a trailing fragment as a complete JSON record.
            (directory / 'partial.bin').write_bytes(framer.pending)
            report['partial_bytes'] = len(framer.pending)
            report['finished_at'] = datetime.now(timezone.utc).isoformat()
            (directory / 'capture.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    parser.add_argument('--seconds', type=int, default=45)
    parser.add_argument('--output', type=Path, default=Path('output/firmware'))
    args = parser.parse_args()
    if not 1 <= args.seconds <= 300:
        parser.error('--seconds must be 1..300')
    import serial
    port = serial.Serial(port=None, baudrate=115200, timeout=0.2)
    port.port = args.port
    port.dtr = False
    port.rts = False
    try:
        port.open()  # Fail rather than terminate another program holding the port.
        directory = args.output / datetime.now(timezone.utc).strftime('uart-%Y%m%dT%H%M%S%fZ')
        directory.mkdir(parents=True, exist_ok=False)
        report = capture(port, directory, args.seconds)
        print(json.dumps({'directory': str(directory.resolve()), 'status': report['status'],
                          'bytes': report['bytes'], 'partial_bytes': report['partial_bytes']}))
        return 0 if report['status'] == 'complete' else 1
    except (OSError, serial.SerialException) as exc:
        parser.exit(2, f'Capture unavailable: {type(exc).__name__}\n')
    finally:
        port.close()


if __name__ == '__main__':
    raise SystemExit(main())
