import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.config import get_settings
from app.database import get_db
from app.models import User
from app.security import SESSION_COOKIE, hash_password, issue_session, verify_password


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,31}$"
_FAILURES: dict[str, deque[float]] = defaultdict(deque)
MAX_FAILURES, WINDOW_SECONDS = 5, 300


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize(cls, value: str) -> str:
        return value.strip().lower()


class Registration(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    display_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize(cls, value: str) -> str:
        return str(value).strip().lower()

    @field_validator("display_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên hiển thị không được trống")
        return value


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str

    model_config = {"from_attributes": True}


def _set_session(response: Response, user: User) -> None:
    settings = get_settings()
    response.set_cookie(SESSION_COOKIE, issue_session(user.id, user.session_version),
                        max_age=settings.session_days * 86400, httponly=True, samesite="lax",
                        secure=settings.cookie_secure, path="/")


def _too_many(key: str) -> bool:
    now = time.monotonic()
    attempts = _FAILURES[key]
    while attempts and now - attempts[0] > WINDOW_SECONDS:
        attempts.popleft()
    return len(attempts) >= MAX_FAILURES


@router.post("/register", response_model=UserResponse, status_code=201)
def register(body: Registration, response: Response, db: Session = Depends(get_db)) -> User:
    if db.scalar(select(User.id).where(func.lower(User.username) == body.username)) is not None:
        raise HTTPException(status_code=409, detail="Tên đăng nhập đã được dùng")
    user = User(username=body.username, display_name=body.display_name, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session(response, user)
    return user


@router.post("/login", response_model=UserResponse)
def login(body: Credentials, response: Response, db: Session = Depends(get_db)) -> User:
    if _too_many(body.username):
        raise HTTPException(status_code=429, detail="Đăng nhập sai quá nhiều lần. Thử lại sau 5 phút.")
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        _FAILURES[body.username].append(time.monotonic())
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    _FAILURES.pop(body.username, None)
    _set_session(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response) -> Response:
    response.status_code = 204
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> User:
    return user


@router.patch("/me", response_model=UserResponse)
def update_me(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tên hiển thị không được trống")
    user.display_name = name
    db.commit()
    return user


@router.post("/password", response_model=UserResponse)
def change_password(body: PasswordChange, response: Response, user: User = Depends(current_user),
                    db: Session = Depends(get_db)) -> User:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng")
    user.password_hash = hash_password(body.new_password)
    user.session_version += 1  # Đăng xuất mọi phiên cũ trên thiết bị khác.
    db.commit()
    _set_session(response, user)
    return user
