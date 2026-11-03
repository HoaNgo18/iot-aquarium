from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, func, cast, Integer
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ClarityBaseline, Device, Telemetry, SettingsChange
from app.schemas import UTCResponse, TelemetryResponse
from app.services.clarity import utc
from dataclasses import asdict
from app.domain.clarity_config import CLARITY_CONFIG
from app.services.device_settings import effective_settings

router = APIRouter(prefix="/api/v1/devices", tags=["clarity"])

@router.get("/{device_id}/clarity/config")
def clarity_config(device_id: str, db: Session = Depends(get_db)):
    values, _ = effective_settings(db, device_id)
    return {key: getattr(values, key) for key in asdict(CLARITY_CONFIG)}

class BaselineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    water_changed: bool = False

class BaselineResponse(UTCResponse):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference_mv: float
    created_at: datetime
    water_changed: bool

@router.get("/{device_id}/clarity/baselines", response_model=list[BaselineResponse])
def baselines(device_id: str, db: Session = Depends(get_db)):
    return list(db.scalars(select(ClarityBaseline).where(ClarityBaseline.device_id == device_id)
        .order_by(ClarityBaseline.created_at.desc()).limit(100)))

@router.post("/{device_id}/clarity/baselines", response_model=BaselineResponse, status_code=201)
def set_baseline(device_id: str, body: BaselineRequest, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    device = db.scalar(select(Device).where(Device.id == device_id).with_for_update())
    if device is None:
        raise HTTPException(404, "Không tìm thấy thiết bị")
    samples = list(db.scalars(select(Telemetry).where(Telemetry.device_id == device_id,
        Telemetry.measured_at >= now - timedelta(seconds=90), Telemetry.measured_at <= now)
        .order_by(Telemetry.measured_at.desc()).limit(15)))
    if device.connectivity != "online" or len(samples) < 10 or (now - utc(samples[0].measured_at)).total_seconds() > 15:
        raise HTTPException(409, "Cần thiết bị online và ít nhất 10 mẫu mới. Giữ đầu dò trong nước sạch khoảng 1 phút.")
    values = [s.turbidity_mv for s in samples]
    if any(v is None or not 150 <= v <= 3000 for v in values):
        raise HTTPException(409, "Điện áp chưa hợp lệ; không thể đặt mốc.")
    value = median(values)
    if max(values) - min(values) > max(10, value * .1):
        raise HTTPException(409, "Tín hiệu chưa ổn định. Giữ đầu dò yên, kiểm tra bọt khí và ánh sáng rồi thử lại.")
    previous_baseline = db.scalar(select(ClarityBaseline).where(ClarityBaseline.device_id == device_id)
                                  .order_by(ClarityBaseline.created_at.desc(), ClarityBaseline.id.desc()).limit(1))
    previous_reference = previous_baseline.reference_mv if previous_baseline else samples[0].turbidity_reference_mv
    row = ClarityBaseline(device_id=device_id, reference_mv=value, created_at=now, water_changed=body.water_changed)
    db.add(row)
    db.flush()
    db.add(SettingsChange(device_id=device_id, action="baseline", baseline_id=row.id,
                         before={"reference_mv": previous_reference},
                         after={"reference_mv": value, "water_changed": body.water_changed}, changed_at=now))
    db.commit()
    db.refresh(row)
    return row

@router.get("/{device_id}/telemetry/series", response_model=list[TelemetryResponse])
def series(device_id: str, minutes: Annotated[int, Query(ge=15, le=10080)] = 1440,
           db: Session = Depends(get_db)):
    # Select the latest row per time bucket across the FULL window, not the last 500 raw samples.
    now = datetime.now(timezone.utc)
    seconds = max(1, int(minutes * 60 / 480))
    epoch = (cast(func.strftime('%s', Telemetry.measured_at), Integer)
             if db.bind.dialect.name == "sqlite" else func.extract('epoch', Telemetry.measured_at))
    bucket = func.floor(epoch / seconds)
    ranked = select(Telemetry.id.label('id'), func.row_number().over(
        partition_by=bucket, order_by=(Telemetry.measured_at.desc(), Telemetry.id.desc())).label('rank'))\
        .where(Telemetry.device_id == device_id, Telemetry.measured_at >= now - timedelta(minutes=minutes),
               Telemetry.measured_at <= now).subquery()
    return list(db.scalars(select(Telemetry).join(ranked, Telemetry.id == ranked.c.id)
        .where(ranked.c.rank == 1).order_by(Telemetry.measured_at)))
