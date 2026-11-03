"""Offline UART diagnostics. Never opens a COM port or writes to the backend."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re


def reject_constant(value):
    raise ValueError(f"Non-JSON constant: {value}")


def analyze(lines):
    counts = Counter()
    issues = []
    seen = set()
    last_sequence = {}
    boot = 0

    def issue(line, kind):
        counts[kind] += 1
        if len(issues) < 100:
            issues.append({"line": line, "kind": kind})

    for number, raw in enumerate(lines, 1):
        counts["lines"] += 1
        if not isinstance(raw, str):
            issue(number, "invalid_log_entry")
            continue
        line = raw.strip()
        if "\ufffd" in line:
            issue(number, "decode_damage")
        if "[BOOT]" in line:
            boot += 1
            counts["boots"] += 1
            last_sequence.clear()
            seen.clear()
        for marker, key in (("[MQTT] connected", "mqtt_connected"),
                            ("[MQTT] disconnected", "mqtt_disconnected"),
                            ("[MQTT] PUBACK", "puback_lines"),
                            ("[WiFi] retrying", "wifi_retries"),
                            ("[MQTT] outbox full", "outbox_full")):
            if marker in line:
                counts[key] += 1
        if "[DATA queued" not in line:
            continue
        counts["queued_lines"] += 1
        match = re.search(r"\[DATA queued id=\d+\]\s*(.*)$", line)
        try:
            if not match:
                raise ValueError("header")
            payload = json.loads(match[1], parse_constant=reject_constant)
            device = payload["device_id"]
            sequence = payload["sequence"]
            timestamp = payload["timestamp"]
            if (not isinstance(device, str) or not device
                    or type(sequence) is not int or sequence < 1
                    or not isinstance(timestamp, str) or not timestamp):
                raise ValueError("identity")
        except (ValueError, TypeError, KeyError):
            issue(number, "malformed_payload")
            continue
        counts["parsed_payloads"] += 1
        identity = (boot, device, timestamp, sequence)
        if identity in seen:
            issue(number, "repeated_identity")
            continue
        seen.add(identity)
        previous = last_sequence.get(device)
        if previous is not None:
            if sequence <= previous:
                issue(number, "sequence_non_increasing")
            elif sequence > previous + 1:
                issue(number, "sequence_gap")
                counts["sequence_numbers_not_observed"] += sequence - previous - 1
        last_sequence[device] = sequence
    return {"counts": dict(sorted(counts.items())), "issues": issues,
            "issues_truncated": sum(counts[k] for k in (
                "invalid_log_entry", "decode_damage", "malformed_payload",
                "repeated_identity", "sequence_non_increasing", "sequence_gap")) > len(issues),
            "scope": "UART observations only; not schema validation or proof of MQTT/database delivery"}


def load_lines(path):
    text = path.read_bytes().decode("utf-8-sig", errors="replace")
    if path.suffix.lower() == ".json":
        document = json.loads(text)
        if not isinstance(document, dict) or not isinstance(document.get("serial"), list):
            raise ValueError("JSON report must contain a serial array")
        return document["serial"]
    return text.splitlines()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path, help="UTF-8 UART text or existing JSON report with serial array")
    args = parser.parse_args()
    try:
        result = analyze(load_lines(args.log))
    except (OSError, ValueError) as exc:
        parser.exit(2, f"Cannot read log: {type(exc).__name__}\n")
    print(json.dumps(result, indent=2, ensure_ascii=True))
    # A report is not an acceptance test. Bad observations must not silently pass CI.
    return 1 if result["issues"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
