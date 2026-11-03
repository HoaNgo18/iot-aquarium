from datetime import datetime, timezone
from sqlalchemy import select
from fastapi import HTTPException
from app.models import Device, DeviceSettings, SettingsChange, Threshold
from app.settings_schema import SettingsValues


def effective_settings(session, device_id):
    stored = session.get(DeviceSettings, device_id)
    if stored:
        return SettingsValues.model_validate(stored.values), stored.revision
    values = SettingsValues()
    threshold = session.get(Threshold, device_id)
    if threshold:
        values = SettingsValues(**{**values.model_dump(), **{key: getattr(threshold, key) for key in (
            "temperature_min_c", "temperature_max_c", "ph_min", "ph_max")}})
    return values, 0


def settings_document(session, device_id):
    values, revision = effective_settings(session, device_id)
    return {"device_id": device_id, "revision": revision, "values": values.model_dump(),
            "defaults": SettingsValues().model_dump()}


def clarity_revision(session, device_id):
    stored = session.get(DeviceSettings, device_id)
    return stored.clarity_revision if stored else 0


def save_settings(session, device_id, values, expected_revision=None):
    device = session.scalar(select(Device).where(Device.id == device_id).with_for_update())
    if device is None:
        raise HTTPException(404, "Không tìm thấy thiết bị.")
    before, revision = effective_settings(session, device_id)
    if expected_revision is not None and expected_revision != revision:
        raise HTTPException(409, "Cài đặt đã thay đổi ở nơi khác. Hủy thay đổi để tải bản mới rồi thử lại.")
    if before.model_dump() == values.model_dump():
        return settings_document(session, device_id)
    now = datetime.now(timezone.utc)
    stored = session.get(DeviceSettings, device_id)
    if stored is None:
        stored = DeviceSettings(device_id=device_id, clarity_revision=0)
        session.add(stored)
    if any(getattr(before, key) != getattr(values, key) for key in (
            "median_window", "ema_seconds", "clear_min_pct", "cloudy_below_pct",
            "clear_recovery_above_pct", "cloudy_recovery_above_pct", "alert_after_seconds")):
        stored.clarity_revision += 1
    stored.values, stored.revision, stored.updated_at = values.model_dump(), revision + 1, now
    threshold = session.get(Threshold, device_id)
    if threshold is None:
        threshold = Threshold(device_id=device_id)
        session.add(threshold)
    for key in ("temperature_min_c", "temperature_max_c", "ph_min", "ph_max"):
        setattr(threshold, key, getattr(values, key))
    session.add(SettingsChange(device_id=device_id, action="settings", before=before.model_dump(),
                               after=values.model_dump(), changed_at=now))
    session.flush()
    return settings_document(session, device_id)
