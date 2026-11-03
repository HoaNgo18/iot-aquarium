from unittest import mock
import asyncio
from datetime import datetime, timezone
import json
import unittest
from types import SimpleNamespace

from fastapi import WebSocketDisconnect

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.api.realtime import websocket_endpoint
from app.models import Alert, Device
from app.realtime import RealtimeHub, build_realtime_events


class FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.events: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, event: dict) -> None:
        self.events.append(event)


class RealtimeHubTests(unittest.IsolatedAsyncioTestCase):
    async def test_endpoint_answers_heartbeat_and_cleans_up_connection(self) -> None:
        hub = RealtimeHub()

        class HeartbeatSocket(FakeWebSocket):
            def __init__(self) -> None:
                super().__init__()
                self.app = SimpleNamespace(state=SimpleNamespace(realtime_hub=hub))
                self.received_ping = False

            async def receive_text(self) -> str:
                if self.received_ping:
                    raise WebSocketDisconnect(code=1000)
                self.received_ping = True
                return 'ping'

        websocket = HeartbeatSocket()
        with mock.patch('app.api.realtime._authorized', return_value=True):
            await websocket_endpoint(websocket, 'node-001')  # type: ignore[arg-type]
        self.assertEqual(websocket.events[-1], {'type': 'pong'})
        await hub.broadcast({'type': 'status', 'device_id': 'node-001', 'data': {}})
        self.assertEqual(len(websocket.events), 2)

    async def test_broadcast_respects_device_filter(self) -> None:
        hub = RealtimeHub()
        all_devices = FakeWebSocket()
        node_one = FakeWebSocket()
        node_two = FakeWebSocket()
        await hub.connect(all_devices)  # type: ignore[arg-type]
        await hub.connect(node_one, "node-001")  # type: ignore[arg-type]
        await hub.connect(node_two, "node-002")  # type: ignore[arg-type]

        await hub.broadcast({"type": "telemetry", "device_id": "node-001", "data": {}})

        self.assertEqual(len(all_devices.events), 2)
        self.assertEqual(len(node_one.events), 2)
        self.assertEqual(len(node_two.events), 1)

    async def test_publish_from_mqtt_thread_reaches_event_loop(self) -> None:
        hub = RealtimeHub()
        websocket = FakeWebSocket()
        hub.bind_running_loop()
        await hub.connect(websocket)  # type: ignore[arg-type]

        await asyncio.to_thread(
            hub.publish_from_thread,
            {"type": "status", "device_id": "node-001", "data": {}},
        )
        await asyncio.sleep(0.01)

        self.assertEqual(websocket.events[-1]["type"], "status")


class RealtimeEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_builds_payload_and_active_alert_snapshot(self) -> None:
        now = datetime.now(timezone.utc)
        with self.sessions() as session:
            session.add(Device(id="node-001"))
            session.add(
                Alert(
                    device_id="node-001",
                    alert_type="offline",
                    severity="warning",
                    message="Offline",
                    started_at=now,
                )
            )
            session.commit()

        payload = {
            "schema_version": 2,
            "device_id": "node-001",
            "timestamp": now.isoformat(),
            "connectivity": "offline",
        }
        events = build_realtime_events(
            "aquarium-monitoring/devices/node-001/status",
            json.dumps(payload).encode(),
            self.sessions,
        )

        self.assertEqual(events[0]["type"], "status")
        self.assertEqual(events[1]["type"], "alerts")
        self.assertEqual(events[1]["data"][0]["alert_type"], "offline")


if __name__ == "__main__":
    unittest.main()
