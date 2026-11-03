"""Xuất toàn bộ mẫu telemetry thô ra CSV (không rút gọn như biểu đồ) để phân tích thực nghiệm."""
import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Telemetry
from app.repositories.devices import get_device


router = APIRouter(prefix="/api/v1/devices", tags=["export"])

VN = timezone(timedelta(hours=7), "UTC+07:00")
MAX_RANGE = timedelta(days=31)
COLUMNS = (
    "measured_at_utc", "measured_at_vn", "received_at_utc", "sequence",
    "temperature_c", "ph", "ph_mv", "clarity_pct", "clarity_state", "clarity_mv",
    "turbidity_mv", "turbidity_reference_mv", "signal_strength_dbm", "sensor_status",
)


def _aware(value: datetime | None) -> datetime | None:
    # SQLite trả datetime naive; dữ liệu luôn được lưu theo UTC.
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None, tz=timezone.utc) -> str:
    value = _aware(value)
    return "" if value is None else value.astimezone(tz).isoformat(timespec="milliseconds")


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def build_csv(rows: list[Telemetry]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow((
            _iso(row.measured_at), _iso(row.measured_at, VN), _iso(row.received_at), row.sequence,
            _cell(row.temperature_c), _cell(row.ph), _cell(row.ph_mv), _cell(row.clarity_pct),
            _cell(row.clarity_state), _cell(row.clarity_mv), _cell(row.turbidity_mv),
            _cell(row.turbidity_reference_mv), _cell(row.signal_strength_dbm), _cell(row.sensor_status),
        ))
    return buffer.getvalue()


@router.get("/{device_id}/telemetry/export.csv")
def export_csv(
    device_id: str,
    from_time: Annotated[datetime, Query(alias="from")],
    to_time: Annotated[datetime, Query(alias="to")],
    db: Session = Depends(get_db),
) -> Response:
    if from_time.tzinfo is None or to_time.tzinfo is None:
        raise HTTPException(status_code=422, detail="Thời gian phải kèm múi giờ (ví dụ 2026-11-03T08:00:00+07:00)")
    if from_time >= to_time:
        raise HTTPException(status_code=422, detail="Thời điểm bắt đầu phải trước thời điểm kết thúc")
    if to_time - from_time > MAX_RANGE:
        raise HTTPException(status_code=422, detail="Chỉ xuất tối đa 31 ngày mỗi lần")
    if get_device(db, device_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")

    rows = list(db.scalars(
        select(Telemetry)
        .where(Telemetry.device_id == device_id,
               Telemetry.measured_at >= from_time, Telemetry.measured_at <= to_time)
        .order_by(Telemetry.measured_at, Telemetry.id)
    ))
    stamp = lambda value: value.astimezone(VN).strftime("%Y%m%d-%H%M")
    filename = f"{device_id}_{stamp(from_time)}_{stamp(to_time)}.csv"
    # BOM để Excel nhận đúng UTF-8.
    return Response(
        content="﻿" + build_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                 "X-Row-Count": str(len(rows))},
    )
