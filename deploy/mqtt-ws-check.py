#!/usr/bin/env python3
"""Check authenticated MQTT over WebSockets and the production ACL."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt


def reason_value(reason_code) -> int:
    return int(getattr(reason_code, "value", reason_code))


class Probe:
    def __init__(self, args: argparse.Namespace, username: str | None, password: str | None):
        self.args = args
        self.connected = threading.Event()
        self.disconnected = threading.Event()
        self.published = threading.Event()
        self.connect_reason: int | None = None
        self.publish_reason: int | None = None
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            protocol=mqtt.MQTTv5,
            transport="websockets",
        )
        self.client.ws_set_options(path=args.path)
        if username is not None:
            self.client.username_pw_set(username, password)
        if args.tls:
            self.client.tls_set_context(ssl.create_default_context())
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_publish = self._on_publish

    def _on_connect(self, _client, _userdata, _flags, reason_code, _properties):
        self.connect_reason = reason_value(reason_code)
        self.connected.set()

    def _on_disconnect(self, _client, _userdata, _flags, reason_code, _properties):
        self.disconnected.set()
        if self.publish_reason is None and reason_value(reason_code) >= 128:
            self.publish_reason = reason_value(reason_code)

    def _on_publish(self, _client, _userdata, _mid, reason_code, _properties):
        self.publish_reason = reason_value(reason_code)
        self.published.set()

    def start(self) -> None:
        self.client.connect(self.args.host, self.args.port, keepalive=30)
        self.client.loop_start()

    def close(self) -> None:
        try:
            self.client.disconnect()
        finally:
            self.client.loop_stop()


def wait(event: threading.Event, seconds: float, label: str) -> None:
    if not event.wait(seconds):
        raise RuntimeError(f"timeout while waiting for {label}")


def expect_connect(args: argparse.Namespace, username: str | None, password: str | None, accepted: bool) -> Probe:
    probe = Probe(args, username, password)
    probe.start()
    wait(probe.connected, args.timeout, "CONNACK")
    actual = probe.connect_reason == 0
    if actual != accepted:
        probe.close()
        raise RuntimeError(f"connection accepted={actual}, expected={accepted}, reason={probe.connect_reason}")
    return probe


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="mqtt.dreamer02.id.vn")
    parser.add_argument("--port", type=int, default=443)
    parser.add_argument("--path", default="/")
    parser.add_argument("--tls", action="store_true", help="enable TLS (WSS); omit for local WS")
    parser.add_argument("--username", required=True, help="must equal the device ID")
    parser.add_argument("--password", required=True)
    parser.add_argument("--other-device", default="tank-not-owned")
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()

    topic = f"aquarium-monitoring/devices/{args.username}/telemetry"
    payload = json.dumps(
        {
            "schema_version": 2,
            "device_id": args.username,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sequence": int(time.time()) & 0x7FFFFFFF,
            "temperature_c": 25.0,
            "ph": 7.0,
            "turbidity_pct": 10.0,
            "signal_strength_dbm": -60,
            "sensor_status": "normal",
        },
        separators=(",", ":"),
    )

    good = expect_connect(args, args.username, args.password, accepted=True)
    good.client.publish(topic, payload, qos=1)
    wait(good.published, args.timeout, "authorized PUBACK")
    if good.publish_reason is None or good.publish_reason >= 128:
        good.close()
        raise RuntimeError(f"authorized publish rejected, reason={good.publish_reason}")
    good.close()
    print("PASS authorized device publish")

    anonymous = expect_connect(args, None, None, accepted=False)
    anonymous.close()
    print("PASS anonymous connection rejected")

    wrong = expect_connect(args, args.username, args.password + "-wrong", accepted=False)
    wrong.close()
    print("PASS wrong password rejected")

    cross = expect_connect(args, args.username, args.password, accepted=True)
    cross_topic = f"aquarium-monitoring/devices/{args.other_device}/status"
    cross.client.publish(cross_topic, '{"online":true}', qos=1)
    if not cross.published.wait(args.timeout) and not cross.disconnected.is_set():
        cross.close()
        raise RuntimeError("timeout while waiting for unauthorized publish rejection")
    rejected = cross.disconnected.is_set() or (cross.publish_reason is not None and cross.publish_reason >= 128)
    cross.close()
    if not rejected:
        raise RuntimeError(f"cross-device publish was not rejected, reason={cross.publish_reason}")
    print("PASS cross-device publish rejected")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        raise SystemExit(1)
