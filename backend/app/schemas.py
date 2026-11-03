from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator
from app.domain.sensor_health import health_for


DeviceId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]


class TelemetryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    schema_version: Literal[2]
    device_id: DeviceId
    timestamp: AwareDatetime
    sequence: Annotated[int, Field(ge=1)]
    temperature_c: Annotated[float | None, Field(ge=-55, le=125)]
    ph: Annotated[float | None, Field(ge=0, le=14)]
    ph_mv: Annotated[float | None, Field(ge=150, le=3000)] = None
    turbidity_pct: Annotated[float | None, Field(ge=0, le=100)]
    turbidity_mv: Annotated[float | None, Field(ge=150, le=3000)] = None
    turbidity_reference_mv: Annotated[float | None, Field(ge=150, le=3000)] = None
    signal_strength_dbm: Annotated[int, Field(ge=-127, le=0)]
    sensor_status: Literal["normal", "error"]

    @model_validator(mode="after")
    def validate_sensor_values(self) -> "TelemetryPayload":
        if self.ph_mv is not None or self.turbidity_mv is not None or self.turbidity_reference_mv is not None:
            # Old firmware marks a raw-mV probe as error because its legacy % is null.
            self.sensor_status = "normal" if all(health_for(self).values()) else "error"
            return self
        missing = any(value is None for value in (self.temperature_c, self.ph, self.turbidity_pct))
        if (self.sensor_status == "error") != missing:
            raise ValueError("sensor_status=error khi và chỉ khi ít nhất một số đo là null")
        return self


class StatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[2]
    device_id: DeviceId
    timestamp: AwareDatetime
    connectivity: Literal["online", "offline"]


class UTCResponse(BaseModel):
    """SQLite tests may return naive datetimes; persisted timestamps are always UTC."""

    @field_validator("*", mode="after")
    @classmethod
    def normalize_timestamps(cls, value):
        if isinstance(value, datetime):
            return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return value


class TelemetryResponse(UTCResponse):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    sequence: int
    measured_at: datetime
    received_at: datetime
    temperature_c: float | None
    ph: float | None
    ph_mv: float | None = None
    turbidity_pct: float | None
    turbidity_mv: float | None = None
    turbidity_reference_mv: float | None = None
    clarity_mv: float | None = None
    clarity_pct: float | None = None
    clarity_state: str | None = None
    clarity_since: datetime | None = None
    clarity_baseline_at: datetime | None = None
    signal_strength_dbm: int
    sensor_status: str

    @computed_field
    @property
    def sensor_health(self) -> dict[str, bool]:
        return health_for(self)


class DeviceResponse(UTCResponse):
    model_config = ConfigDict(from_attributes=True)

    id: str
    connectivity: str
    sensor_status: str
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AlertResponse(UTCResponse):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    alert_type: str
    severity: str
    message: str
    started_at: datetime
    ended_at: datetime | None
    acknowledged_at: datetime | None

    @field_validator("message")
    @classmethod
    def use_clarity_term(cls, value):
        # Translate historical wording without rewriting the audit records.
        if "Chỉ số độ đục" in value:
            return "Độ trong: cảnh báo theo chỉ số cũ, chưa quy đổi theo mốc nước sạch."
        return value.replace("độ đục", "độ trong").replace("Độ đục", "Độ trong")


class ThresholdUpdate(BaseModel):
    # Development defaults only; configure for the selected species and calibrated probes.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    temperature_min_c: Annotated[float, Field(ge=-55, le=125)] = 22.0
    temperature_max_c: Annotated[float, Field(ge=-55, le=125)] = 30.0
    ph_min: Annotated[float, Field(ge=0, le=14)] = 6.5
    ph_max: Annotated[float, Field(ge=0, le=14)] = 8.5
    turbidity_warning_pct: Annotated[float, Field(ge=0, le=100)] = 60.0
    turbidity_critical_pct: Annotated[float, Field(ge=0, le=100)] = 80.0

    @model_validator(mode="after")
    def validate_thresholds(self) -> "ThresholdUpdate":
        if self.temperature_min_c >= self.temperature_max_c:
            raise ValueError("temperature_min_c phải nhỏ hơn temperature_max_c")
        if self.ph_min >= self.ph_max:
            raise ValueError("ph_min phải nhỏ hơn ph_max")
        if self.turbidity_warning_pct >= self.turbidity_critical_pct:
            raise ValueError("turbidity_warning_pct phải nhỏ hơn turbidity_critical_pct")
        return self


class ThresholdResponse(ThresholdUpdate, UTCResponse):
    model_config = ConfigDict(from_attributes=True)

    device_id: str
    updated_at: datetime


class HealthResponse(BaseModel):
    status: Literal["healthy", "degraded"]
    database: Literal["up", "down"]
    mqtt: Literal["connected", "disconnected"]
    version: str
