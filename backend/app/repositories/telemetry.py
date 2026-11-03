from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Telemetry
from app.schemas import TelemetryPayload


def is_duplicate(session: Session, payload: TelemetryPayload) -> bool:
    return session.scalar(
        select(Telemetry.id).where(
            Telemetry.device_id == payload.device_id,
            Telemetry.sequence == payload.sequence,
            Telemetry.measured_at == payload.timestamp,
        )
    ) is not None


def add_telemetry(session: Session, payload: TelemetryPayload) -> Telemetry:
    row = Telemetry(
        device_id=payload.device_id,
        sequence=payload.sequence,
        measured_at=payload.timestamp,
        temperature_c=payload.temperature_c,
        ph=payload.ph,
        ph_mv=payload.ph_mv,
        turbidity_pct=payload.turbidity_pct,
        turbidity_mv=payload.turbidity_mv,
        turbidity_reference_mv=payload.turbidity_reference_mv,
        signal_strength_dbm=payload.signal_strength_dbm,
        sensor_status=payload.sensor_status,
    )
    from app.services.clarity import process
    process(session, row)
    session.add(row)
    return row


def get_latest(session: Session, device_id: str) -> Telemetry | None:
    return session.scalar(
        select(Telemetry)
        .where(Telemetry.device_id == device_id)
        .order_by(Telemetry.measured_at.desc(), Telemetry.id.desc())
        .limit(1)
    )


def get_history(
    session: Session,
    device_id: str,
    from_time: datetime | None,
    to_time: datetime | None,
    limit: int,
) -> list[Telemetry]:
    statement = select(Telemetry).where(Telemetry.device_id == device_id)
    if from_time is not None:
        statement = statement.where(Telemetry.measured_at >= from_time)
    if to_time is not None:
        statement = statement.where(Telemetry.measured_at <= to_time)
    statement = statement.order_by(Telemetry.measured_at.desc()).limit(limit)
    return list(session.scalars(statement))
