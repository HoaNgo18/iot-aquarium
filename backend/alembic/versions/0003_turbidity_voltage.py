"""Keep uncalibrated probe voltage separate from calibrated percentages."""
from alembic import op
import sqlalchemy as sa

revision = "0003_turbidity_voltage"
down_revision = "0002_aquarium_monitoring"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("aquarium_telemetry", sa.Column("turbidity_mv", sa.Float(), nullable=True))
    op.add_column("aquarium_telemetry", sa.Column("turbidity_reference_mv", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("aquarium_telemetry", "turbidity_reference_mv")
    op.drop_column("aquarium_telemetry", "turbidity_mv")
