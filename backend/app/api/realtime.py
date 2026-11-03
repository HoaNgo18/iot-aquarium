from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import owns_device, user_from_token
from app.database import SessionLocal
from app.security import SESSION_COOKIE


router = APIRouter()


def _authorized(websocket: WebSocket, device_id: str | None) -> bool:
    if not device_id:
        return False
    session_factory = getattr(websocket.app.state, "session_factory", SessionLocal)
    with session_factory() as db:
        user = user_from_token(db, websocket.cookies.get(SESSION_COOKIE))
        return user is not None and owns_device(db, user, device_id)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, device_id: str | None = None) -> None:
    if not _authorized(websocket, device_id):
        await websocket.close(code=4401)
        return
    hub = websocket.app.state.realtime_hub
    await hub.connect(websocket, device_id)
    try:
        while True:
            message = await websocket.receive_text()
            if message == 'ping':
                await websocket.send_json({'type': 'pong'})
    except WebSocketDisconnect:
        hub.disconnect(websocket)
