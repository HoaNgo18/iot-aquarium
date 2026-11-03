"""Xác thực phiên và kiểm tra quyền sở hữu thiết bị cho mọi API theo thiết bị."""
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Tank, User
from app.security import SESSION_COOKIE, read_session


def user_from_token(db: Session, token: str | None) -> User | None:
    session = read_session(token)
    if session is None:
        return None
    user = db.get(User, session[0])
    return user if user is not None and user.session_version == session[1] else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_token(db, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="Bạn cần đăng nhập")
    return user


def owns_device(db: Session, user: User, device_id: str) -> bool:
    return db.scalar(select(Tank.id).where(Tank.device_id == device_id, Tank.owner_id == user.id)) is not None


def authorize_device(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    # 404 thay vì 403 để không lộ thiết bị nào đang tồn tại.
    if not owns_device(db, user, device_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy bể hoặc bạn không có quyền xem")
    return user
