"""Băm mật khẩu, ký cookie phiên và sinh mã ghép nối thiết bị (chỉ dùng thư viện chuẩn)."""
import base64
import hashlib
import hmac
import secrets
import time

from app.config import get_settings

_SCRYPT = {"n": 2**14, "r": 8, "p": 1}
SESSION_COOKIE = "aquasense_session"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return "scrypt${n}${r}${p}${salt}${digest}".format(
        **_SCRYPT, salt=base64.b64encode(salt).decode(), digest=base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), dklen=32, n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(actual, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _sign(message: str) -> str:
    key = get_settings().secret_key.encode()
    return base64.urlsafe_b64encode(hmac.new(key, message.encode(), hashlib.sha256).digest()).decode().rstrip("=")


def issue_session(user_id: int, session_version: int, now: float | None = None) -> str:
    expires = int((now or time.time()) + get_settings().session_days * 86400)
    payload = f"{user_id}.{session_version}.{expires}"
    return f"{payload}.{_sign(payload)}"


def read_session(token: str | None, now: float | None = None) -> tuple[int, int] | None:
    """Trả (user_id, session_version) nếu chữ ký hợp lệ và chưa hết hạn."""
    if not token:
        return None
    try:
        user_id, version, expires, signature = token.split(".")
        payload = f"{user_id}.{version}.{expires}"
        if not hmac.compare_digest(signature, _sign(payload)) or int(expires) < (now or time.time()):
            return None
        return int(user_id), int(version)
    except ValueError:
        return None


def pairing_code(device_id: str) -> str:
    """Mã 8 ký tự in trên nhãn thiết bị; suy ra từ device_id và secret của máy chủ."""
    raw = hmac.new(get_settings().secret_key.encode(), f"pair:{device_id}".encode(), hashlib.sha256).digest()
    code = base64.b32encode(raw).decode()[:8]
    return f"{code[:4]}-{code[4:]}"


def check_pairing_code(device_id: str, code: str) -> bool:
    normalized = code.strip().upper().replace(" ", "")
    if len(normalized) == 8:
        normalized = f"{normalized[:4]}-{normalized[4:]}"
    return hmac.compare_digest(normalized, pairing_code(device_id))
