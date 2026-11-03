from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.domain.clarity_config import CLARITY_CONFIG


class SettingsValues(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    temperature_min_c: Annotated[float, Field(ge=-55, le=125)] = 22
    temperature_max_c: Annotated[float, Field(ge=-55, le=125)] = 30
    temperature_preset: Literal["custom", "tropical", "goldfish", "koi"] = "custom"
    ph_min: Annotated[float, Field(ge=0, le=14)] = 6.5
    ph_max: Annotated[float, Field(ge=0, le=14)] = 8.5
    clear_min_pct: Annotated[float, Field(ge=1, le=99)] = CLARITY_CONFIG.clear_min_pct
    cloudy_below_pct: Annotated[float, Field(ge=0, le=98)] = CLARITY_CONFIG.cloudy_below_pct
    clear_recovery_above_pct: Annotated[float, Field(ge=0, le=100)] = CLARITY_CONFIG.clear_recovery_above_pct
    cloudy_recovery_above_pct: Annotated[float, Field(ge=0, le=100)] = CLARITY_CONFIG.cloudy_recovery_above_pct
    auto_hysteresis: bool = True
    alert_after_seconds: Annotated[int, Field(ge=60, le=86400)] = CLARITY_CONFIG.alert_after_seconds
    sensor_timeout_minutes: Annotated[float, Field(ge=0, le=60)] = 0
    sensitivity: Literal["sensitive", "standard", "low", "custom"] = "standard"
    median_window: Annotated[int, Field(ge=1, le=61)] = 15
    ema_seconds: Annotated[float, Field(ge=1, le=300)] = 20

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.temperature_min_c >= self.temperature_max_c:
            raise ValueError("Nhiệt độ tối thiểu phải nhỏ hơn tối đa.")
        if self.ph_min >= self.ph_max:
            raise ValueError("pH tối thiểu phải nhỏ hơn tối đa.")
        if not (self.cloudy_below_pct < self.cloudy_recovery_above_pct < self.clear_min_pct < self.clear_recovery_above_pct):
            raise ValueError("Ngưỡng Đục < ngưỡng thoát Đục < ngưỡng Hơi đục < ngưỡng về Trong.")
        if self.median_window % 2 == 0:
            raise ValueError("Số mẫu trung vị phải là số lẻ.")
        return self


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: Annotated[int, Field(ge=0)]
    values: SettingsValues
