"""Store pH probe ADC voltage independently of calibrated pH."""
from alembic import op
import sqlalchemy as sa

revision = "0007_ph_voltage"
down_revision = "0006_clarity_settings_revision"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("aquarium_telemetry", sa.Column("ph_mv", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("aquarium_telemetry", "ph_mv")
