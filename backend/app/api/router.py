from fastapi import APIRouter, Depends

from app.api import alerts, auth, clarity, devices, export, health, realtime, reminders, settings, tanks, telemetry
from app.api.deps import authorize_device


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(tanks.router)
api_router.include_router(reminders.router)
api_router.include_router(realtime.router)
# Mọi API theo thiết bị chỉ dành cho chủ sở hữu bể đã ghép nối thiết bị đó.
for device_router in (devices.router, telemetry.router, alerts.router, clarity.router, settings.router, export.router):
    api_router.include_router(device_router, dependencies=[Depends(authorize_device)])
