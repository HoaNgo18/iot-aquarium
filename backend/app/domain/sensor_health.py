"""One validity definition for sensor alerts and dashboard health."""
import math

SENSOR_LABELS = {"temperature": "nhiệt độ", "ph": "pH", "clarity": "độ trong"}


def valid(value, low, high):
    return value is not None and math.isfinite(value) and low <= value <= high


def sensor_health(*, temperature_c, ph, ph_mv=None, turbidity_pct=None, turbidity_mv=None,
                  turbidity_reference_mv=None):
    raw_mode = turbidity_mv is not None or turbidity_reference_mv is not None
    return {
        "temperature": valid(temperature_c, -55, 125),
        # Signal received is distinct from a calibrated pH measurement.
        "ph": valid(ph, 0, 14) or valid(ph_mv, 150, 3000),
        "clarity": (valid(turbidity_mv, 150, 3000) and valid(turbidity_reference_mv, 150, 3000)
                    if raw_mode else valid(turbidity_pct, 0, 100)),
    }


def health_for(row):
    return sensor_health(**{key: getattr(row, key, None) for key in (
        "temperature_c", "ph", "ph_mv", "turbidity_pct", "turbidity_mv", "turbidity_reference_mv")})
