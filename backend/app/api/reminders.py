from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.database import get_db
from app.domain.recurrence import next_due
from app.models import Reminder, Tank, User
from app.schemas import UTCResponse


router = APIRouter(prefix="/api/v1/reminders", tags=["reminders"])
VN = timezone(timedelta(hours=7))
Repeat = Literal["none", "daily", "weekly", "biweekly", "monthly"]


def today_vn() -> date:
    return datetime.now(VN).date()


class ReminderCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    tank_id: int | None = None
    repeat: Repeat = "none"
    due_date: date

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên việc không được trống")
        return value


class ReminderUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    tank_id: int | None = None
    repeat: Repeat | None = None
    due_date: date | None = None


class ReminderResponse(UTCResponse):
    model_config = {"from_attributes": True}

    id: int
    title: str
    note: str | None
    tank_id: int | None
    tank_name: str | None = None
    repeat: str
    due_date: date
    done_at: datetime | None
    last_done_at: datetime | None


def _check_tank(db: Session, user: User, tank_id: int | None) -> Tank | None:
    if tank_id is None:
        return None
    tank = db.get(Tank, tank_id)
    if tank is None or tank.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy bể")
    return tank


def _response(db: Session, item: Reminder) -> ReminderResponse:
    result = ReminderResponse.model_validate(item)
    if item.tank_id is not None:
        tank = db.get(Tank, item.tank_id)
        result.tank_name = tank.name if tank else None
    return result


def _owned(db: Session, user: User, reminder_id: int) -> Reminder:
    item = db.get(Reminder, reminder_id)
    if item is None or item.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhắc việc")
    return item


@router.get("", response_model=list[ReminderResponse])
def list_reminders(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[ReminderResponse]:
    items = db.scalars(select(Reminder).where(Reminder.owner_id == user.id).order_by(Reminder.due_date, Reminder.id))
    return [_response(db, item) for item in items]


@router.post("", response_model=ReminderResponse, status_code=201)
def create_reminder(body: ReminderCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ReminderResponse:
    _check_tank(db, user, body.tank_id)
    item = Reminder(owner_id=user.id, tank_id=body.tank_id, title=body.title, note=(body.note or "").strip() or None,
                    repeat=body.repeat, due_date=body.due_date)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _response(db, item)


@router.patch("/{reminder_id}", response_model=ReminderResponse)
def update_reminder(reminder_id: int, body: ReminderUpdate, user: User = Depends(current_user),
                    db: Session = Depends(get_db)) -> ReminderResponse:
    item = _owned(db, user, reminder_id)
    fields = body.model_dump(exclude_unset=True)
    if "tank_id" in fields:
        _check_tank(db, user, fields["tank_id"])
        item.tank_id = fields["tank_id"]
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Tên việc không được trống")
        item.title = title
    if "note" in fields:
        item.note = (fields["note"] or "").strip() or None
    if fields.get("repeat"):
        item.repeat = fields["repeat"]
    if fields.get("due_date"):
        item.due_date = fields["due_date"]
        item.done_at = None
    db.commit()
    return _response(db, item)


@router.post("/{reminder_id}/complete", response_model=ReminderResponse)
def complete_reminder(reminder_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ReminderResponse:
    item = _owned(db, user, reminder_id)
    now = datetime.now(timezone.utc)
    item.last_done_at = now
    if item.repeat == "none":
        item.done_at = now
    else:
        item.due_date = next_due(item.due_date, item.repeat, today_vn())
        item.done_at = None
    db.commit()
    return _response(db, item)


@router.post("/{reminder_id}/reopen", response_model=ReminderResponse)
def reopen_reminder(reminder_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> ReminderResponse:
    item = _owned(db, user, reminder_id)
    item.done_at = None
    db.commit()
    return _response(db, item)


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    db.delete(_owned(db, user, reminder_id))
    db.commit()
    return Response(status_code=204)
