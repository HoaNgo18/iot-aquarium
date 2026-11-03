from datetime import timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Device, SettingsChange, ClarityBaseline
from app.settings_schema import SettingsUpdate
from app.services.device_settings import settings_document, save_settings

router = APIRouter(prefix="/api/v1/devices", tags=["settings"])


@router.get("/{device_id}/settings")
def read_settings(device_id: str, db: Session = Depends(get_db)):
    if db.get(Device, device_id) is None:
        raise HTTPException(404, "Không tìm thấy thiết bị.")
    return settings_document(db, device_id)


@router.put("/{device_id}/settings")
def update_settings(device_id: str, body: SettingsUpdate, db: Session = Depends(get_db)):
    result = save_settings(db, device_id, body.values, body.revision)
    db.commit()
    return result


@router.get("/{device_id}/settings/history")
def settings_history(device_id: str, db: Session = Depends(get_db)):
    changes = list(db.scalars(select(SettingsChange).where(SettingsChange.device_id == device_id)
                             .order_by(SettingsChange.changed_at.desc(), SettingsChange.id.desc()).limit(100)))
    utc = lambda value: value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    result = [{"id": f"change-{row.id}", "action": row.action, "before": row.before,
               "after": row.after, "changed_at": utc(row.changed_at)} for row in changes]
    # Include reference events created before audit logging existed.
    recorded = select(SettingsChange.baseline_id).where(SettingsChange.baseline_id.is_not(None))
    legacy = list(db.scalars(select(ClarityBaseline).where(ClarityBaseline.device_id == device_id,
                  ClarityBaseline.id.not_in(recorded)).order_by(ClarityBaseline.created_at.desc()).limit(100)))
    for row in legacy:
        result.append({"id": f"baseline-{row.id}", "action": "baseline", "before": {},
                       "after": {"reference_mv": row.reference_mv, "water_changed": row.water_changed},
                       "changed_at": utc(row.created_at)})
    return sorted(result, key=lambda row: (row["changed_at"], row["id"]), reverse=True)[:100]
