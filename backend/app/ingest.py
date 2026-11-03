import json
import logging
from datetime import datetime, timezone
from enum import StrEnum
from typing import Callable

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.repositories.devices import get_or_create_device
from app.repositories.telemetry import add_telemetry, is_duplicate, get_latest
from app.domain.sensor_health import health_for
from app.services.clarity import utc
from app.schemas import StatusPayload, TelemetryPayload
from app.services.alert_service import evaluate_status_alerts, evaluate_telemetry_alerts
from app.topics import TOPIC_PATTERN
from app.models import Device


logger = logging.getLogger(__name__)


class IngestResult(StrEnum):
    STORED = "stored"
    DUPLICATE = "duplicate"


def ingest_message(
    topic: str,
    raw_payload: bytes,
    session_factory: Callable[[], Session],
) -> IngestResult:
    match = TOPIC_PATTERN.fullmatch(topic)
    if match is None:
        raise ValueError(f"Topic không hợp lệ: {topic}")

    try:
        document = json.loads(raw_payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Payload không phải JSON UTF-8 hợp lệ") from exc

    kind = match.group("kind")
    payload = (
        TelemetryPayload.model_validate(document)
        if kind == "telemetry"
        else StatusPayload.model_validate(document)
    )
    if payload.device_id != match.group("device_id"):
        raise ValueError("device_id trong topic và payload không khớp")

    with session_factory() as session:
        device = get_or_create_device(session, payload.device_id)
        session.flush()
        device = session.scalar(select(Device).where(Device.id == payload.device_id).with_for_update())
        observed_at = datetime.now(timezone.utc)

        if isinstance(payload, StatusPayload):
            device.connectivity = payload.connectivity
            # The broker's Last Will carries a timestamp from CONNECT, potentially
            # hours old. Offline is observed now and is not a fresh device sighting.
            if payload.connectivity == "online":
                last_seen = device.last_seen_at
                if last_seen is None or payload.timestamp > last_seen.replace(tzinfo=timezone.utc):
                    device.last_seen_at = payload.timestamp
            evaluate_status_alerts(session, payload, observed_at=observed_at)
            session.commit()
            return IngestResult.STORED

        if is_duplicate(session, payload):
            return IngestResult.DUPLICATE

        device.connectivity = "online"
        last_seen = device.last_seen_at
        if last_seen is None or payload.timestamp > last_seen.replace(tzinfo=timezone.utc):
            device.last_seen_at = payload.timestamp
        previous = get_latest(session, payload.device_id)
        row = add_telemetry(session, payload)
        row.sensor_status = "normal" if all(health_for(row).values()) else "error"
        if previous is None or payload.timestamp > utc(previous.measured_at):
            device.sensor_status = row.sensor_status
            evaluate_telemetry_alerts(session, payload, observed_at=observed_at, row=row)
        else:
            # A late sample proves connectivity, not current sensor health.
            from app.domain.alert_rules import evaluate_connectivity
            from app.repositories.alerts import apply_decision
            for decision in evaluate_connectivity("online"):
                apply_decision(session, payload.device_id, decision, observed_at)
        session.commit()
        return IngestResult.STORED


def log_invalid_message(topic: str, exc: ValueError | ValidationError) -> None:
    logger.warning("Bỏ qua bản tin MQTT không hợp lệ trên %s: %s", topic, exc)
