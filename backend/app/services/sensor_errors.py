"""Persist each probe's grace period, including when telemetry stops entirely."""
from datetime import datetime, timezone
from sqlalchemy import select
from app.models import SensorHealthState, Device, Alert
from app.domain.sensor_health import SENSOR_LABELS, health_for
from app.domain.alert_rules import AlertDecision
from app.repositories.alerts import apply_decision
from app.services.device_settings import effective_settings


OFFLINE_SENSOR_MESSAGE = "Không có số đo vì thiết bị mất kết nối."


def suspend_sensor_errors(session, device_id, now):
    for alert in session.scalars(select(Alert).where(Alert.device_id == device_id,
            Alert.alert_type.like("sensor_error%"), Alert.ended_at.is_(None))):
        alert.message = OFFLINE_SENSOR_MESSAGE
        alert.ended_at = now
    for state in session.scalars(select(SensorHealthState).where(SensorHealthState.device_id == device_id)):
        state.missing_since = None


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def apply_health_state(session, state, now, timeout):
    active = state.missing_since is not None and (now - utc(state.missing_since)).total_seconds() >= timeout
    apply_decision(session, state.device_id, AlertDecision(
        f"sensor_error_{state.sensor}", active, "critical",
        f"Không có số đo hợp lệ: {SENSOR_LABELS[state.sensor]}."), now)


def observe_sensor_health(session, row, observed_at):
    settings, _ = effective_settings(session, row.device_id)
    for sensor, healthy in health_for(row).items():
        state = session.get(SensorHealthState, (row.device_id, sensor))
        if state is None:
            state = SensorHealthState(device_id=row.device_id, sensor=sensor, last_sample_at=observed_at)
            session.add(state)
        state.last_sample_at = observed_at
        if healthy:
            state.missing_since = None
        elif state.missing_since is None:
            state.missing_since = observed_at
        apply_health_state(session, state, observed_at, settings.sensor_timeout_minutes * 60)


def check_sensor_timeouts(session_factory, now=None):
    now = now or datetime.now(timezone.utc)
    changed_devices = []
    with session_factory() as lookup:
        device_ids = list(lookup.scalars(select(SensorHealthState.device_id).distinct()))
    for device_id in device_ids:
        with session_factory() as session:
            # Use the same device lock as ingest/settings writes to prevent duplicate alerts.
            device = session.scalar(select(Device).where(Device.id == device_id).with_for_update())
            before = set(session.scalars(select(Alert.id).where(Alert.device_id == device_id, Alert.ended_at.is_(None))))
            settings, _ = effective_settings(session, device_id)
            states = list(session.scalars(select(SensorHealthState).where(SensorHealthState.device_id == device_id)))
            # Total loss of telemetry is a device connection issue, not three broken probes.
            last_contact = max([utc(state.last_sample_at) for state in states] +
                               ([utc(device.last_seen_at)] if device.last_seen_at else []))
            if device.connectivity == "offline" or (now - last_contact).total_seconds() >= max(60, settings.sensor_timeout_minutes * 60):
                device.connectivity = "offline"
                suspend_sensor_errors(session, device_id, now)
                apply_decision(session, device_id, AlertDecision("offline", True, "warning",
                    "Thiết bị mất kết nối. Không có số đo mới từ các cảm biến."), now)
                session.flush()
                after = set(session.scalars(select(Alert.id).where(Alert.device_id == device_id, Alert.ended_at.is_(None))))
                session.commit()
                if before != after:
                    changed_devices.append(device_id)
                continue
            for state in states:
                apply_health_state(session, state, now, settings.sensor_timeout_minutes * 60)
            session.flush()
            after = set(session.scalars(select(Alert.id).where(Alert.device_id == device_id, Alert.ended_at.is_(None))))
            session.commit()
            if before != after:
                changed_devices.append(device_id)
    return changed_devices
