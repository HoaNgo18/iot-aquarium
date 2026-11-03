from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, or_

from app.database import get_db
from app.models import Telemetry
from app.repositories.telemetry import get_history, get_latest
from app.schemas import TelemetryResponse


router = APIRouter(prefix="/api/v1/devices", tags=["telemetry"])


@router.get("/{device_id}/telemetry/last-valid", response_model=dict[str, TelemetryResponse | None])
def last_valid_telemetry(device_id: str, db: Session = Depends(get_db)):
    # Independent of the selected chart range and of later invalid samples.
    conditions = {"temperature": Telemetry.temperature_c.is_not(None),
                  "ph": or_(Telemetry.ph.is_not(None), Telemetry.ph_mv.is_not(None)),
                  "clarity": Telemetry.clarity_pct.is_not(None)}
    return {key: db.scalar(select(Telemetry).where(Telemetry.device_id == device_id, condition)
                          .order_by(Telemetry.measured_at.desc(), Telemetry.id.desc()).limit(1))
            for key, condition in conditions.items()}


@router.get("/{device_id}/telemetry/latest", response_model=TelemetryResponse)
def latest_telemetry(device_id: str, db: Session = Depends(get_db)) -> Telemetry:
    row = get_latest(db, device_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Thiết bị chưa có telemetry")
    return row


@router.get("/{device_id}/telemetry", response_model=list[TelemetryResponse])
def telemetry_history(
    device_id: str,
    from_time: Annotated[datetime | None, Query(alias="from")] = None,
    to_time: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    db: Session = Depends(get_db),
) -> list[Telemetry]:
    return get_history(db, device_id, from_time, to_time, limit)
