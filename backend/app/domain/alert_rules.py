from dataclasses import dataclass
from app.domain.sensor_health import sensor_health, SENSOR_LABELS


@dataclass(frozen=True)
class ThresholdValues:
    temperature_min_c: float
    temperature_max_c: float
    ph_min: float
    ph_max: float
    turbidity_warning_pct: float
    turbidity_critical_pct: float


@dataclass(frozen=True)
class AlertDecision:
    alert_type: str
    active: bool
    severity: str
    message: str


def evaluate_connectivity(connectivity: str) -> list[AlertDecision]:
    return [AlertDecision("offline", connectivity == "offline", "warning", "Thiết bị đã mất kết nối.")]


def evaluate_telemetry(
    *,
    temperature_c: float | None,
    ph: float | None,
    turbidity_pct: float | None,
    sensor_status: str,
    thresholds: ThresholdValues,
    turbidity_mv: float | None = None,
    turbidity_reference_mv: float | None = None,
) -> list[AlertDecision]:
    health = sensor_health(temperature_c=temperature_c, ph=ph, turbidity_pct=turbidity_pct,
                           turbidity_mv=turbidity_mv, turbidity_reference_mv=turbidity_reference_mv)
    decisions = [
        *[AlertDecision(f"sensor_error_{key}", not healthy, "critical",
                        f"Không có số đo hợp lệ: {SENSOR_LABELS[key]}." if not healthy
                        else f"Cảm biến {SENSOR_LABELS[key]} hoạt động bình thường.")
          for key, healthy in health.items()],
        *evaluate_connectivity("online"),
    ]
    # Unknown measurements must not close an existing value-based alert.
    if temperature_c is not None:
        decisions.append(AlertDecision(
            "temperature",
            temperature_c < thresholds.temperature_min_c or temperature_c > thresholds.temperature_max_c,
            "warning",
            f"Nhiệt độ nước {temperature_c:.2f} °C; khoảng cấu hình "
            f"{thresholds.temperature_min_c:g}–{thresholds.temperature_max_c:g} °C.",
        ))
    if ph is not None:
        decisions.append(AlertDecision(
            "ph", ph < thresholds.ph_min or ph > thresholds.ph_max, "warning",
            f"pH {ph:.2f}; khoảng cấu hình {thresholds.ph_min:g}–{thresholds.ph_max:g}.",
        ))
    if turbidity_pct is not None:
        decisions.append(AlertDecision(
            "turbidity", turbidity_pct >= thresholds.turbidity_warning_pct,
            "critical" if turbidity_pct >= thresholds.turbidity_critical_pct else "warning",
            "Độ trong: chỉ số cũ vượt ngưỡng. Cần kiểm tra cảm biến.",
        ))
    return decisions
