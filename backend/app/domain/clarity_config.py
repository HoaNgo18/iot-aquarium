"""Single source for backend classification and dashboard annotations (clarity %)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ClarityConfig:
    clear_min_pct: float = 90
    cloudy_below_pct: float = 70
    clear_recovery_above_pct: float = 93
    cloudy_recovery_above_pct: float = 75
    alert_after_seconds: int = 1800

    def __post_init__(self):
        if not (0 <= self.cloudy_below_pct < self.cloudy_recovery_above_pct
                < self.clear_min_pct < self.clear_recovery_above_pct <= 100):
            raise ValueError("Ngưỡng độ trong và ngưỡng phục hồi phải tăng dần trong khoảng 0–100%")
        if self.alert_after_seconds <= 0:
            raise ValueError("Thời gian cảnh báo phải lớn hơn 0")


CLARITY_CONFIG = ClarityConfig()
