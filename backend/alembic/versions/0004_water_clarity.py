"""Persist relative clarity and clean-water reference events."""
from alembic import op
import sqlalchemy as sa

revision = "0004_water_clarity"
down_revision = "0003_turbidity_voltage"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("clarity_baselines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.String(64), sa.ForeignKey("devices.id"), nullable=False),
        sa.Column("reference_mv", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("water_changed", sa.Boolean(), nullable=False))
    op.create_index("ix_clarity_baselines_device_id", "clarity_baselines", ["device_id"])
    for name, kind in [("clarity_mv", sa.Float()), ("clarity_pct", sa.Float()),
                       ("clarity_state", sa.String(16)), ("clarity_since", sa.DateTime(timezone=True)),
                       ("clarity_baseline_at", sa.DateTime(timezone=True))]:
        op.add_column("aquarium_telemetry", sa.Column(name, kind, nullable=True))

def downgrade():
    for name in ("clarity_mv", "clarity_pct", "clarity_state", "clarity_since", "clarity_baseline_at"):
        op.drop_column("aquarium_telemetry", name)
    op.drop_table("clarity_baselines")
