from contextlib import asynccontextmanager
import logging
import asyncio
from contextlib import suppress

from fastapi import FastAPI

from app.api.router import api_router
from app.config import get_settings
from app.mqtt_consumer import MqttConsumer
from app.realtime import RealtimeHub
from app.database import SessionLocal
from app.services.sensor_errors import check_sensor_timeouts


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app(start_background_services: bool = True) -> FastAPI:
    settings = get_settings()
    realtime_hub = RealtimeHub()
    consumer = MqttConsumer(settings, realtime_hub.publish_from_thread)

    async def monitor_sensors():
        while True:
            await asyncio.sleep(5)
            try:
                devices = await asyncio.to_thread(check_sensor_timeouts, SessionLocal)
                for device_id in devices:
                    await realtime_hub.broadcast({"type": "alerts", "device_id": device_id, "data": []})
            except Exception:
                logging.exception("Không thể kiểm tra thời gian mất dữ liệu cảm biến")

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        realtime_hub.bind_running_loop()
        if start_background_services:
            consumer.start()
        monitor = asyncio.create_task(monitor_sensors()) if start_background_services else None
        try:
            yield
        finally:
            if monitor:
                monitor.cancel()
                with suppress(asyncio.CancelledError):
                    await monitor
            if start_background_services:
                consumer.stop()
            realtime_hub.unbind_loop()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )
    application.state.mqtt_consumer = consumer
    application.state.realtime_hub = realtime_hub
    application.include_router(api_router)
    return application


app = create_app()
