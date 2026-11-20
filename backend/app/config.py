from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Aquarium Monitoring API"
    app_version: str = "0.2.0"
    database_url: str = Field(
        default="postgresql+psycopg://flood_app:change-me-for-local-development@localhost:5432/flood_monitoring"
    )
    mqtt_host: str = "localhost"
    mqtt_port: int = 1884
    mqtt_client_id: str = "aquarium-monitoring-backend"
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    # Ký cookie phiên và sinh mã ghép nối. Bắt buộc đổi khi triển khai thật.
    secret_key: str = "dev-only-change-me"
    session_days: int = 14
    cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
