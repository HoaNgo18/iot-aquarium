from fastapi import APIRouter

from app.api import alerts, devices, health, realtime, telemetry, clarity, settings


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(devices.router)
api_router.include_router(telemetry.router)
api_router.include_router(alerts.router)
api_router.include_router(realtime.router)
api_router.include_router(clarity.router)
api_router.include_router(settings.router)
