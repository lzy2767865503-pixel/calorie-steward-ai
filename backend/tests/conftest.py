from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Sequence

import pytest

from app.catalog import SqliteFoodCatalog
from app.config import Settings
from app.providers import VisionCandidate, VisionResult


class FixedVisionProvider:
    model_version = "test-vision-2.1"
    mode_label = "test"

    def __init__(self, candidates: Sequence[VisionCandidate] = ()) -> None:
        self.candidates = candidates or (
            VisionCandidate("White rice, cooked", 150.0, 0.90),
            VisionCandidate("Chicken, roasted", 120.0, 0.80),
        )
        self.seen_path = None

    async def analyze(self, image_path, mime_type, locale, market) -> VisionResult:
        self.seen_path = image_path
        assert image_path.is_file()
        assert mime_type == "image/jpeg"
        return VisionResult(
            candidates=self.candidates,
            model_version=self.model_version,
            assumptions=("测试识别假设。",),
            is_demo=True,
        )


@pytest.fixture()
def catalog_path(tmp_path: Path) -> Path:
    path = tmp_path / "foods.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE food (
                id INTEGER PRIMARY KEY,
                source_id TEXT NOT NULL,
                name_en TEXT NOT NULL,
                energy_kcal_100g REAL NOT NULL,
                source_name TEXT NOT NULL,
                quality_grade TEXT NOT NULL,
                dataset_version TEXT NOT NULL,
                quality_rank INTEGER NOT NULL,
                active INTEGER NOT NULL
            );
            CREATE TABLE food_alias (food_id INTEGER NOT NULL, alias TEXT NOT NULL);
            CREATE TABLE dataset_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """
        )
        connection.executemany(
            """
            INSERT INTO food (
                id, source_id, name_en, energy_kcal_100g, source_name,
                quality_grade, dataset_version, quality_rank, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                (1, "FDC-1", "White rice, cooked", 130.0, "Test Food Lab", "A", "source-v1", 1),
                (2, "FDC-2", "Chicken, roasted", 200.0, "Test Food Lab", "B", "source-v1", 2),
                (3, "FDC-3", "Cucumber, raw", 15.0, "Test Food Lab", "A", "source-v1", 1),
                (4, "FDC-4", "Clear broth", 7.0, "Test Food Lab", "C", "source-v1", 3),
            ),
        )
        connection.executemany(
            "INSERT INTO food_alias (food_id, alias) VALUES (?, ?)",
            (
                (1, "cooked white rice"),
                (1, "Rice, white, cooked, no added fat"),
                (
                    2,
                    "Chicken, broiler or fryers, breast, skinless, boneless, "
                    "meat only, cooked, braised",
                ),
                (3, "Cucumber, with peel, raw"),
                (4, "Soup, broth"),
            ),
        )
        connection.execute(
            "INSERT INTO dataset_metadata (key, value) VALUES ('dataset_version', 'catalog-test-2026-08')"
        )
    return path


@pytest.fixture()
def catalog(catalog_path: Path) -> SqliteFoodCatalog:
    return SqliteFoodCatalog(catalog_path)


@pytest.fixture()
def settings(catalog_path: Path) -> Settings:
    return Settings(food_db_path=catalog_path, max_image_bytes=1024)


@pytest.fixture()
def jpeg_bytes() -> bytes:
    return b"\xff\xd8\xff\xe0" + b"private-image-payload" + b"\xff\xd9"
