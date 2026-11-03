from typing import Annotated
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import update as sql_update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, Threshold
from app.repositories.alerts import get_or_create_threshold, list_alerts
from app.repositories.devices import get_device
from app.schemas import AlertResponse, ThresholdResponse, ThresholdUpdate
from app.services.device_settings import effective_settings, save_settings
from app.settings_schema import SettingsValues


router = APIRouter(prefix="/api/v1/devices", tags=["alerts"])


@router.post("/{device_id}/alerts/{alert_id}/acknowledge", response_model=AlertResponse)
def acknowledge_alert(device_id: str, alert_id: int, db: Session = Depends(get_db)) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None or alert.device_id != device_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo của thiết bị")
    # Acknowledgement records operator awareness; it does not resolve the condition.
    if alert.acknowledged_at is None:
        db.execute(sql_update(Alert).where(Alert.id == alert_id, Alert.device_id == device_id,
            Alert.acknowledged_at.is_(None)).values(acknowledged_at=datetime.now(timezone.utc)))
        db.commit()
        db.refresh(alert)
    return alert


@router.get("/{device_id}/alerts", response_model=list[AlertResponse])
def alert_history(
    device_id: str,
    active_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    db: Session = Depends(get_db),
) -> list[Alert]:
    return list_alerts(db, device_id, active_only, limit)


@router.get("/{device_id}/thresholds", response_model=ThresholdResponse)
def get_thresholds(device_id: str, db: Session = Depends(get_db)) -> Threshold:
    if get_device(db, device_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    threshold = get_or_create_threshold(db, device_id)
    db.commit()
    db.refresh(threshold)
    return threshold


@router.put("/{device_id}/thresholds", response_model=ThresholdResponse)
def update_thresholds(
    device_id: str,
    update: ThresholdUpdate,
    db: Session = Depends(get_db),
) -> Threshold:
    if get_device(db, device_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    settings, _ = effective_settings(db, device_id)
    save_settings(db, device_id, SettingsValues(**{**settings.model_dump(), **{
        key: getattr(update, key) for key in ("temperature_min_c", "temperature_max_c", "ph_min", "ph_max")},
        "temperature_preset": "custom"}))
    threshold = get_or_create_threshold(db, device_id)
    for field, value in update.model_dump().items():
        setattr(threshold, field, value)
    db.commit()
    db.refresh(threshold)
    return threshold
