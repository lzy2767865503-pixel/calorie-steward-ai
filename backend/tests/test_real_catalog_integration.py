from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_default_demo_runs_against_shipped_5000_food_catalog(jpeg_bytes) -> None:
    project_root = Path(__file__).resolve().parents[2]
    catalog_path = (
        project_root
        / "android-app"
        / "app"
        / "src"
        / "main"
        / "assets"
        / "databases"
        / "clinical_clarity_foods.sqlite"
    )
    assert catalog_path.is_file()

    app = create_app(
        settings=Settings(food_db_path=catalog_path, max_image_bytes=1024)
    )
    with TestClient(app) as client:
        health = client.get("/healthz")
        response = client.post(
            "/v1/analyze-meal",
            data={"request_id": "real-catalog-demo-2026"},
            files={"image": ("meal.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert health.status_code == 200
    assert health.json()["catalogFoodCount"] == 5000
    assert response.status_code == 200
    body = response.json()
    assert body["estimatedKcal"] == 446
    assert body["isDemo"] is True
    assert body["modelVersion"] == "demo-vision-fixture-v1"
    assert {item["foodId"] for item in body["foods"]} == {219, 258, 1300, 1384}
    assert all(item["qualityGrade"] in {"A", "C"} for item in body["foods"])
