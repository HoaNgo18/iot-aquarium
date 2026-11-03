from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("connectivity IN ('online', 'offline')", name="ck_devices_connectivity"),
        CheckConstraint("sensor_status IN ('normal', 'error')", name="ck_devices_sensor_status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connectivity: Mapped[str] = mapped_column(String(16), default="offline", nullable=False)
    sensor_status: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    telemetry: Mapped[list[Telemetry]] = relationship(back_populates="device")
    threshold: Mapped[Threshold | None] = relationship(back_populates="device")


class Telemetry(Base):
    __tablename__ = "aquarium_telemetry"
    __table_args__ = (
        UniqueConstraint(
            "device_id", "sequence", "measured_at", name="uq_aquarium_telemetry_sample"
        ),
        Index("ix_aquarium_telemetry_device_measured", "device_id", "measured_at"),
        CheckConstraint("sensor_status IN ('normal', 'error')", name="ck_telemetry_sensor_status"),
        CheckConstraint("temperature_c IS NULL OR temperature_c BETWEEN -55 AND 125", name="ck_aquarium_temperature"),
        CheckConstraint("ph IS NULL OR ph BETWEEN 0 AND 14", name="ck_aquarium_ph"),
        CheckConstraint("turbidity_pct IS NULL OR turbidity_pct BETWEEN 0 AND 100", name="ck_aquarium_turbidity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    temperature_c: Mapped[float | None] = mapped_column(Float)
    ph: Mapped[float | None] = mapped_column(Float)
    ph_mv: Mapped[float | None] = mapped_column(Float)
    turbidity_pct: Mapped[float | None] = mapped_column(Float)
    turbidity_mv: Mapped[float | None] = mapped_column(Float)
    turbidity_reference_mv: Mapped[float | None] = mapped_column(Float)
    clarity_mv: Mapped[float | None] = mapped_column(Float)
    clarity_pct: Mapped[float | None] = mapped_column(Float)
    clarity_state: Mapped[str | None] = mapped_column(String(16))
    clarity_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clarity_baseline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signal_strength_dbm: Mapped[int] = mapped_column(Integer, nullable=False)
    sensor_status: Mapped[str] = mapped_column(String(16), nullable=False)
    settings_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    device: Mapped[Device] = relationship(back_populates="telemetry")


class ClarityBaseline(Base):
    __tablename__ = "clarity_baselines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    reference_mv: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    water_changed: Mapped[bool] = mapped_column(default=False)


class DeviceSettings(Base):
    __tablename__ = "device_settings"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clarity_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    values: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SettingsChange(Base):
    __tablename__ = "settings_changes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    before: Mapped[dict] = mapped_column(JSON, nullable=False)
    after: Mapped[dict] = mapped_column(JSON, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    baseline_id: Mapped[int | None] = mapped_column(ForeignKey("clarity_baselines.id"), unique=True)


class SensorHealthState(Base):
    __tablename__ = "sensor_health_states"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), primary_key=True)
    sensor: Mapped[str] = mapped_column(String(16), primary_key=True)
    last_sample_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    missing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Threshold(Base):
    __tablename__ = "aquarium_thresholds"
    __table_args__ = (
        CheckConstraint("-55 <= temperature_min_c AND temperature_min_c < temperature_max_c AND temperature_max_c <= 125", name="ck_aquarium_temp_range"),
        CheckConstraint("0 <= ph_min AND ph_min < ph_max AND ph_max <= 14", name="ck_aquarium_ph_range"),
        CheckConstraint("0 <= turbidity_warning_pct AND turbidity_warning_pct < turbidity_critical_pct AND turbidity_critical_pct <= 100", name="ck_aquarium_turbidity_range"),
    )

    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), primary_key=True)
    temperature_min_c: Mapped[float] = mapped_column(Float, default=22.0, nullable=False)
    temperature_max_c: Mapped[float] = mapped_column(Float, default=30.0, nullable=False)
    ph_min: Mapped[float] = mapped_column(Float, default=6.5, nullable=False)
    ph_max: Mapped[float] = mapped_column(Float, default=8.5, nullable=False)
    turbidity_warning_pct: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    turbidity_critical_pct: Mapped[float] = mapped_column(Float, default=80.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    device: Mapped[Device] = relationship(back_populates="threshold")


class Alert(Base):
    __tablename__ = "aquarium_alerts"
    __table_args__ = (
        CheckConstraint("severity IN ('warning', 'critical')", name="ck_alerts_severity"),
        Index("ix_aquarium_alerts_device_started", "device_id", "started_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
