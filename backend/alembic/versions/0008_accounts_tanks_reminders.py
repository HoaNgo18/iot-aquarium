"""Accounts, tank ownership and care reminders."""
from alembic import op
import sqlalchemy as sa

revision = "0008_accounts_tanks_reminders"
down_revision = "0007_ph_voltage"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tanks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", sa.String(64), sa.ForeignKey("devices.id"), nullable=False, unique=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("volume_l", sa.Float()),
        sa.Column("species", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("volume_l IS NULL OR volume_l > 0", name="ck_tanks_volume"),
    )
    op.create_index("ix_tanks_owner_id", "tanks", ["owner_id"])
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tank_id", sa.Integer(), sa.ForeignKey("tanks.id", ondelete="CASCADE")),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("note", sa.String(500)),
        sa.Column("repeat", sa.String(16), nullable=False, server_default="none"),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("last_done_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("repeat IN ('none', 'daily', 'weekly', 'biweekly', 'monthly')", name="ck_reminders_repeat"),
    )
    op.create_index("ix_reminders_owner_id", "reminders", ["owner_id"])


def downgrade():
    op.drop_index("ix_reminders_owner_id", table_name="reminders")
    op.drop_table("reminders")
    op.drop_index("ix_tanks_owner_id", table_name="tanks")
    op.drop_table("tanks")
    op.drop_table("users")
