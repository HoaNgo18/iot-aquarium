"""Keep the clarity filter continuous when unrelated settings change."""
from alembic import op
import sqlalchemy as sa

revision = "0006_clarity_settings_revision"
down_revision = "0005_device_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("device_settings", sa.Column("clarity_revision", sa.Integer(), server_default="0", nullable=False))


def downgrade():
    op.drop_column("device_settings", "clarity_revision")
