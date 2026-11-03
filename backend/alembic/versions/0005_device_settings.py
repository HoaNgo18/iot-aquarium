"""Per-device settings, audit history and delayed sensor errors."""
from alembic import op
import sqlalchemy as sa

revision = "0005_device_settings"
down_revision = "0004_water_clarity"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("device_settings",
        sa.Column("device_id", sa.String(64), sa.ForeignKey("devices.id"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("settings_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.String(64), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("before", sa.JSON(), nullable=False), sa.Column("after", sa.JSON(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("baseline_id", sa.Integer(), sa.ForeignKey("clarity_baselines.id"), unique=True))
    op.create_index("ix_settings_changes_device_id", "settings_changes", ["device_id"])
    op.create_table("sensor_health_states",
        sa.Column("device_id", sa.String(64), sa.ForeignKey("devices.id"), primary_key=True),
        sa.Column("sensor", sa.String(16), primary_key=True),
        sa.Column("last_sample_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("missing_since", sa.DateTime(timezone=True)))
    op.add_column("aquarium_telemetry", sa.Column("settings_revision", sa.Integer(), server_default="0", nullable=False))


def downgrade():
    op.drop_column("aquarium_telemetry", "settings_revision")
    op.drop_table("sensor_health_states")
    op.drop_table("settings_changes")
    op.drop_table("device_settings")
