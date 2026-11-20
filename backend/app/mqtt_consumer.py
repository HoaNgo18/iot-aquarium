import logging
import threading
from collections.abc import Callable
from typing import Any

from paho.mqtt import client as mqtt
from pydantic import ValidationError

from app.config import Settings
from app.database import SessionLocal
from app.ingest import ingest_message, log_invalid_message
from app.ingest import IngestResult
from app.realtime import build_realtime_events


logger = logging.getLogger(__name__)


class MqttConsumer:
    def __init__(
        self,
        settings: Settings,
        event_publisher: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.settings = settings
        self.event_publisher = event_publisher
        self.connected = threading.Event()
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=settings.mqtt_client_id,
            protocol=mqtt.MQTTv311,
        )
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def start(self) -> None:
        logger.info("Khởi động MQTT consumer tới %s:%s", self.settings.mqtt_host, self.settings.mqtt_port)
        self.client.connect_async(self.settings.mqtt_host, self.settings.mqtt_port, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.disconnect()
        self.client.loop_stop()

    def _on_connect(self, client, _userdata, _flags, reason_code, _properties) -> None:
        if reason_code == 0:
            client.subscribe("aquarium-monitoring/devices/+/telemetry", qos=1)
            client.subscribe("aquarium-monitoring/devices/+/status", qos=1)
            self.connected.set()
            logger.info("MQTT đã kết nối và subscribe telemetry/status")
        else:
            logger.error("MQTT từ chối kết nối: %s", reason_code)

    def _on_disconnect(self, _client, _userdata, _flags, reason_code, _properties) -> None:
        self.connected.clear()
        if reason_code != 0:
            logger.warning("MQTT mất kết nối: %s", reason_code)

    def _on_message(self, _client, _userdata, message) -> None:
        try:
            result = ingest_message(message.topic, message.payload, SessionLocal)
            logger.info("MQTT %s: %s", result, message.topic)
            if result == IngestResult.STORED and self.event_publisher is not None:
                for event in build_realtime_events(message.topic, message.payload, SessionLocal):
                    self.event_publisher(event)
        except (ValueError, ValidationError) as exc:
            log_invalid_message(message.topic, exc)
        except Exception:
            logger.exception("Không thể lưu bản tin MQTT trên %s", message.topic)
