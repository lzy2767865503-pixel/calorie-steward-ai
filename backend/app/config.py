from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    food_db_path: Path
    max_image_bytes: int = DEFAULT_MAX_IMAGE_BYTES
    max_candidates: int = 12
    minimum_match_score: float = 0.68

    @classmethod
    def from_environment(cls) -> "Settings":
        project_root = Path(__file__).resolve().parents[2]
        default_catalog = (
            project_root
            / "android-app"
            / "app"
            / "src"
            / "main"
            / "assets"
            / "databases"
            / "clinical_clarity_foods.sqlite"
        )
        configured_path = os.getenv("FOOD_DB_PATH")
        catalog_path = Path(configured_path).expanduser() if configured_path else default_catalog

        raw_max_bytes = os.getenv("MAX_IMAGE_BYTES", str(DEFAULT_MAX_IMAGE_BYTES))
        try:
            max_bytes = int(raw_max_bytes)
        except ValueError as exc:
            raise ValueError("MAX_IMAGE_BYTES must be an integer") from exc
        if max_bytes < 1024 or max_bytes > 32 * 1024 * 1024:
            raise ValueError("MAX_IMAGE_BYTES must be between 1 KiB and 32 MiB")

        return cls(food_db_path=catalog_path.resolve(), max_image_bytes=max_bytes)

