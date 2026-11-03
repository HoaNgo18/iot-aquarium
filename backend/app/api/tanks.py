import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.database import get_db
from app.models import Alert, Reminder, Tank, User
from app.repositories.devices import get_device, get_or_create_device
from app.repositories.telemetry import get_latest
from app.schemas import TelemetryResponse, UTCResponse
from app.security import check_pairing_code


router = APIRouter(prefix="/api/v1/tanks", tags=["tanks"])
DEVICE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class TankFields(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    volume_l: float | None = Field(default=None, gt=0, le=100000)
    species: str | None = Field(default=None, max_length=64)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên bể không được trống")
        return value

    @field_validator("species")
    @classmethod
    def strip_species(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class TankCreate(TankFields):
    device_id: str = Field(pattern=DEVICE_ID.pattern)
    pairing_code: str = Field(min_length=8, max_length=12)


class TankUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    volume_l: float | None = Field(default=None, gt=0, le=100000)
    species: str | None = Field(default=None, max_length=64)


class TankResponse(UTCResponse):
    id: int
    name: str
    device_id: str
    volume_l: float | None
    species: str | None
    created_at: datetime | None
    connectivity: str
    last_seen_at: datetime | None
    open_alerts: int
    latest: TelemetryResponse | None


def _response(db: Session, tank: Tank) -> TankResponse:
    device = get_device(db, tank.device_id)
    latest = get_latest(db, tank.device_id)
    alerts = db.scalar(select(func.count(Alert.id)).where(Alert.device_id == tank.device_id, Alert.ended_at.is_(None))) or 0
    return TankResponse(
        id=tank.id, name=tank.name, device_id=tank.device_id, volume_l=tank.volume_l, species=tank.species,
        created_at=tank.created_at, connectivity=device.connectivity if device else "offline",
        last_seen_at=device.last_seen_at if device else None, open_alerts=alerts,
        latest=TelemetryResponse.model_validate(latest) if latest else None,
    )


def _owned(db: Session, user: User, tank_id: int) -> Tank:
    tank = db.get(Tank, tank_id)
    if tank is None or tank.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy bể")
    return tank


@router.get("", response_model=list[TankResponse])
def list_tanks(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[TankResponse]:
    tanks = db.scalars(select(Tank).where(Tank.owner_id == user.id).order_by(Tank.created_at, Tank.id))
    return [_response(db, tank) for tank in tanks]


@router.post("", response_model=TankResponse, status_code=201)
def create_tank(body: TankCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> TankResponse:
    if not check_pairing_code(body.device_id, body.pairing_code):
        raise HTTPException(status_code=400, detail="Mã thiết bị hoặc mã ghép nối không đúng")
    existing = db.scalar(select(Tank).where(Tank.device_id == body.device_id))
    if existing is not None:
        detail = "Thiết bị này đã có trong bể của bạn" if existing.owner_id == user.id else "Thiết bị đã được người khác ghép nối"
        raise HTTPException(status_code=409, detail=detail)
    get_or_create_device(db, body.device_id)
    tank = Tank(owner_id=user.id, device_id=body.device_id, name=body.name, volume_l=body.volume_l, species=body.species)
    db.add(tank)
    db.commit()
    db.refresh(tank)
    return _response(db, tank)


@router.get("/{tank_id}", response_model=TankResponse)
def read_tank(tank_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> TankResponse:
    return _response(db, _owned(db, user, tank_id))


@router.patch("/{tank_id}", response_model=TankResponse)
def update_tank(tank_id: int, body: TankUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> TankResponse:
    tank = _owned(db, user, tank_id)
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields:
        name = (fields["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="Tên bể không được trống")
        tank.name = name
    if "volume_l" in fields:
        tank.volume_l = fields["volume_l"]
    if "species" in fields:
        tank.species = (fields["species"] or "").strip() or None
    db.commit()
    return _response(db, tank)


@router.delete("/{tank_id}", status_code=204)
def delete_tank(tank_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    # Bỏ ghép nối; dữ liệu đo của thiết bị vẫn giữ để có thể ghép lại.
    tank = _owned(db, user, tank_id)
    db.execute(delete(Reminder).where(Reminder.tank_id == tank.id))
    db.delete(tank)
    db.commit()
    return Response(status_code=204)
