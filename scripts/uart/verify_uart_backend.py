"""Read-only comparison of queued UART samples with REST history."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import urlencode, quote
from urllib.request import urlopen

from analyze_uart import analyze, load_lines, reject_constant

FIELDS = ('temperature_c', 'ph', 'turbidity_pct', 'signal_strength_dbm', 'sensor_status')


def utc(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('Timezone required')
    return date.astimezone(timezone.utc).isoformat()


def verify(lines, fetch):
    diagnostics = analyze(lines)
    results = []
    seen = set()
    for number, line in enumerate(lines, 1):
        if not isinstance(line, str) or '[DATA queued' not in line:
            continue
        try:
            match = re.search(r'\[DATA queued id=\d+\]\s*(.*)$', line)
            sample = json.loads(match[1], parse_constant=reject_constant) if match else None
            device = sample['device_id']
            sequence = sample['sequence']
            timestamp = utc(sample['timestamp'])
            if (not isinstance(device, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', device)
                    or type(sequence) is not int or sequence < 1
                    or any(field not in sample for field in FIELDS)):
                raise ValueError('Incomplete sample')
        except (ValueError, TypeError, KeyError, AttributeError):
            results.append({'line': number, 'status': 'invalid_sample'})
            continue
        # Include contents: conflicting repeats must not be silently dropped.
        identity = (device, timestamp, sequence, json.dumps(sample, sort_keys=True))
        if identity in seen:
            continue
        seen.add(identity)
        if len(seen) > 500:
            results.append({'line': number, 'status': 'sample_limit_exceeded'})
            break
        result = {'line': number, 'device_id': device, 'sequence': sequence}
        try:
            rows = fetch(device, timestamp)
            if not isinstance(rows, list) or len(rows) >= 1000:
                raise ValueError('Ambiguous or truncated history')
            matches = [row for row in rows if row['device_id'] == device
                       and row['sequence'] == sequence and utc(row['measured_at']) == timestamp]
            if len(matches) != 1:
                result['status'] = 'not_found' if not matches else 'ambiguous'
            else:
                different = [field for field in FIELDS
                             if field not in matches[0] or matches[0][field] != sample[field]]
                result.update(status='mismatch' if different else 'matched', different_fields=different)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            result['status'] = 'fetch_error'
        results.append(result)
    return {'verified': bool(results) and not diagnostics['issues']
            and all(row['status'] == 'matched' for row in results),
            'diagnostics': diagnostics, 'samples': results,
            'scope': 'Read-only historical comparison; not a hardware or reconnect acceptance test'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', type=Path)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    args = parser.parse_args()

    def fetch(device, timestamp):
        query = urlencode({'from': timestamp, 'to': timestamp, 'limit': 1000})
        url = f'{args.base_url.rstrip("/")}/api/v1/devices/{quote(device, safe="")}/telemetry?{query}'
        with urlopen(url, timeout=10) as response:
            return json.load(response)

    try:
        result = verify(load_lines(args.log), fetch)
    except (OSError, ValueError) as exc:
        parser.exit(2, f'Cannot read log: {type(exc).__name__}\n')
    print(json.dumps(result, indent=2))
    return 0 if result['verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
