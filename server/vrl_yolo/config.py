from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven runtime configuration.

    Same module powers both web and desktop modes — only the values here change.
    Override any field via VRL_YOLO_GUI_<UPPERCASE_NAME> environment variables.
    """

    model_config = SettingsConfigDict(
        env_prefix="VRL_YOLO_GUI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mode: Literal["web", "desktop"] = "web"

    storage_path: Path = Field(default=Path("./data/storage"))

    static_frontend_path: Path | None = None

    bundled_models_path: Path | None = None

    api_prefix: str = "/api"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    max_upload_mb: int = 500
