from datetime import datetime

from sqlalchemy.orm import Session

from app.domain.alert_rules import ThresholdValues, evaluate_connectivity, evaluate_telemetry
from app.repositories.alerts import apply_decision, get_or_create_threshold
from app.schemas import StatusPayload, TelemetryPayload
from app.models import Telemetry
from app.domain.alert_rules import AlertDecision
from app.repositories.alerts import get_active_alert
from app.services.sensor_errors import observe_sensor_health, suspend_sensor_errors


def evaluate_status_alerts(session: Session, payload: StatusPayload, *, observed_at: datetime) -> None:
    if payload.connectivity == "offline":
        suspend_sensor_errors(session, payload.device_id, observed_at)
    for decision in evaluate_connectivity(payload.connectivity):
        apply_decision(session, payload.device_id, decision, observed_at)


def evaluate_telemetry_alerts(session: Session, payload: TelemetryPayload, *, observed_at: datetime, row: Telemetry | None = None) -> None:
    threshold = get_or_create_threshold(session, payload.device_id)
    thresholds = ThresholdValues(
        temperature_min_c=threshold.temperature_min_c,
        temperature_max_c=threshold.temperature_max_c,
        ph_min=threshold.ph_min,
        ph_max=threshold.ph_max,
        turbidity_warning_pct=threshold.turbidity_warning_pct,
        turbidity_critical_pct=threshold.turbidity_critical_pct,
    )
    for decision in evaluate_telemetry(
        temperature_c=payload.temperature_c,
        ph=payload.ph,
        turbidity_pct=payload.turbidity_pct,
        sensor_status=payload.sensor_status,
        thresholds=thresholds,
        turbidity_mv=row.turbidity_mv if row is not None else payload.turbidity_mv,
        turbidity_reference_mv=row.turbidity_reference_mv if row is not None else payload.turbidity_reference_mv,
    ):
        if decision.alert_type.startswith("sensor_error_"):
            continue
        occurred_at = observed_at if decision.alert_type == "offline" else payload.timestamp
        apply_decision(session, payload.device_id, decision, occurred_at)
    if row is not None:
        observe_sensor_health(session, row, observed_at)
    # Retire the old aggregate record, without pretending all probes recovered.
    legacy = get_active_alert(session, payload.device_id, "sensor_error")
    if legacy is not None:
        legacy.message = "Đã chuyển sang theo dõi lỗi riêng cho từng cảm biến."
        apply_decision(session, payload.device_id,
                       AlertDecision("sensor_error", False, "critical", legacy.message), observed_at)
