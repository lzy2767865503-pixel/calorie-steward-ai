from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.providers import VisionCandidate
from conftest import FixedVisionProvider


def test_android_contract_and_deterministic_calories(
    settings, catalog, jpeg_bytes
) -> None:
    provider = FixedVisionProvider()
    app = create_app(settings=settings, provider=provider, catalog=catalog)

    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            headers={"X-Request-Id": "android-request-1234"},
            data={"request_id": "android-request-1234", "locale": "zh-CN", "market": "MY"},
            files={"image": ("meal.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "requestId",
        "scanId",
        "estimatedKcal",
        "lowKcal",
        "highKcal",
        "confidence",
        "foods",
        "assumptions",
        "modelVersion",
        "datasetVersion",
        "sourceLabel",
        "isDemo",
    }
    # 150 g * 130/100 + 120 g * 200/100 = 435 kcal.
    assert body["estimatedKcal"] == 435
    assert body["lowKcal"] <= 435 <= body["highKcal"]
    assert sum(item["sharePercent"] for item in body["foods"]) == 100
    assert body["foods"][0]["estimatedKcal"] == 195.0
    assert body["foods"][1]["estimatedKcal"] == 240.0
    assert body["datasetVersion"] == "catalog-test-2026-08"
    assert body["modelVersion"] == "test-vision-2.1"
    assert body["isDemo"] is True
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["x-request-id"] == "android-request-1234"


def test_temp_image_is_deleted_after_provider_returns(settings, catalog, jpeg_bytes) -> None:
    provider = FixedVisionProvider()
    app = create_app(settings=settings, provider=provider, catalog=catalog)

    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            data={"request_id": "delete-check-1234"},
            files={"image": ("sensitive.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert response.status_code == 200
    assert provider.seen_path is not None
    assert not Path(provider.seen_path).exists()


def test_temp_image_is_deleted_and_provider_details_are_hidden_on_failure(
    settings, catalog, jpeg_bytes
) -> None:
    class FailingProvider(FixedVisionProvider):
        async def analyze(self, image_path, mime_type, locale, market):
            self.seen_path = image_path
            raise RuntimeError(f"upstream leaked path {image_path}")

    provider = FailingProvider()
    app = create_app(settings=settings, provider=provider, catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            headers={"X-Request-Id": "provider-failure-123"},
            files={"image": ("sensitive-person.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "VISION_PROVIDER_UNAVAILABLE",
        "message": "视觉识别暂时不可用，请稍后重试。",
        "requestId": "provider-failure-123",
    }
    assert provider.seen_path is not None
    assert not Path(provider.seen_path).exists()
    assert "sensitive-person" not in response.text
    assert str(provider.seen_path) not in response.text


def test_rejects_spoofed_mime_and_still_returns_request_id(
    settings, catalog
) -> None:
    app = create_app(settings=settings, provider=FixedVisionProvider(), catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            headers={"X-Request-Id": "mime-check-12345"},
            files={"image": ("fake.jpg", b"not an image", "image/jpeg")},
        )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "INVALID_IMAGE"
    assert response.json()["detail"]["requestId"] == "mime-check-12345"
    assert response.headers["cache-control"] == "no-store"


def test_rejects_declared_mime_that_disagrees_with_bytes(settings, catalog, jpeg_bytes) -> None:
    app = create_app(settings=settings, provider=FixedVisionProvider(), catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            files={"image": ("meal.png", jpeg_bytes, "image/png")},
        )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "IMAGE_TYPE_MISMATCH"


def test_rejects_image_over_configured_limit(catalog, jpeg_bytes, catalog_path) -> None:
    tiny_settings = Settings(food_db_path=catalog_path, max_image_bytes=16)
    app = create_app(settings=tiny_settings, provider=FixedVisionProvider(), catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            files={"image": ("large.jpg", jpeg_bytes * 10, "image/jpeg")},
        )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "IMAGE_TOO_LARGE"


def test_rejects_unreliable_food_match(settings, catalog, jpeg_bytes) -> None:
    provider = FixedVisionProvider(
        candidates=(VisionCandidate("nonexistent mystery object", 100.0, 0.9),)
    )
    app = create_app(settings=settings, provider=provider, catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            files={"image": ("meal.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "FOOD_MATCH_LOW_CONFIDENCE"


def test_health_reports_catalog_version_and_provider_mode(settings, catalog) -> None:
    app = create_app(settings=settings, provider=FixedVisionProvider(), catalog=catalog)
    with TestClient(app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "datasetVersion": "catalog-test-2026-08",
        "catalogFoodCount": 4,
        "providerMode": "test",
    }


def test_default_demo_provider_runs_end_to_end(settings, catalog, jpeg_bytes) -> None:
    app = create_app(settings=settings, catalog=catalog)
    with TestClient(app) as client:
        response = client.post(
            "/v1/analyze-meal",
            data={"request_id": "default-demo-12345"},
            files={"image": ("meal.jpg", jpeg_bytes, "image/jpeg")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["estimatedKcal"] == 491
    assert body["isDemo"] is True
    assert body["modelVersion"] == "demo-vision-fixture-v1"
    assert any("固定样例" in assumption for assumption in body["assumptions"])
