from __future__ import annotations

import re
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from .catalog import CatalogError, SqliteFoodCatalog
from .config import Settings
from .models import (
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    MealAnalysisResponse,
)
from .nutrition import NutritionEngine, NutritionEstimationError, UnmatchedFoodError
from .privacy import ImageValidationError, delete_private_image, persist_private_image
from .providers import DemoVisionProvider, VisionProvider


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


class ApiError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _valid_request_id(value: Optional[str]) -> Optional[str]:
    if value and REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return None


def _error_payload(request: Request, code: str, message: str) -> dict:
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    return ErrorResponse(
        detail=ErrorDetail(code=code, message=message, requestId=request_id)
    ).model_dump()


def create_app(
    settings: Optional[Settings] = None,
    provider: Optional[VisionProvider] = None,
    catalog: Optional[SqliteFoodCatalog] = None,
) -> FastAPI:
    active_settings = settings or Settings.from_environment()
    active_provider: VisionProvider = provider or DemoVisionProvider()

    app = FastAPI(
        title="Clinical Clarity Meal Analysis API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
    )
    app.state.settings = active_settings
    app.state.provider = active_provider
    app.state.catalog = catalog
    app.state.engine = NutritionEngine(catalog, active_settings.max_candidates) if catalog else None
    app.state.catalog_lock = threading.Lock()

    def get_engine() -> NutritionEngine:
        if app.state.engine is not None:
            return app.state.engine
        with app.state.catalog_lock:
            if app.state.engine is None:
                loaded_catalog = SqliteFoodCatalog(
                    active_settings.food_db_path,
                    minimum_match_score=active_settings.minimum_match_score,
                )
                app.state.catalog = loaded_catalog
                app.state.engine = NutritionEngine(
                    loaded_catalog,
                    max_candidates=active_settings.max_candidates,
                )
        return app.state.engine

    @app.middleware("http")
    async def privacy_headers_and_request_id(request: Request, call_next):
        client_header = _valid_request_id(request.headers.get("X-Request-Id"))
        request.state.had_client_request_id = client_header is not None
        request.state.request_id = client_header or str(uuid.uuid4())

        if request.url.path == "/v1/analyze-meal" and request.method == "POST":
            content_length = request.headers.get("content-length")
            if content_length and content_length.isdigit():
                multipart_allowance = 1024 * 1024
                if int(content_length) > active_settings.max_image_bytes + multipart_allowance:
                    response = JSONResponse(
                        status_code=413,
                        content=_error_payload(
                            request, "IMAGE_TOO_LARGE", "上传内容超过允许大小。"
                        ),
                    )
                    response.headers["Cache-Control"] = "no-store"
                    response.headers["X-Content-Type-Options"] = "nosniff"
                    response.headers["X-Request-Id"] = request.state.request_id
                    return response

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(request, exc.code, exc.message),
        )

    @app.exception_handler(CatalogError)
    async def handle_catalog_error(request: Request, exc: CatalogError):
        return JSONResponse(
            status_code=503,
            content=_error_payload(
                request,
                "CATALOG_UNAVAILABLE",
                "版本化食品库暂时不可用，请稍后重试。",
            ),
        )

    @app.exception_handler(UnmatchedFoodError)
    async def handle_unmatched_food(request: Request, exc: UnmatchedFoodError):
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                request,
                "FOOD_MATCH_LOW_CONFIDENCE",
                "无法把全部候选与食品库可靠匹配，请重新拍照或手动确认。",
            ),
        )

    @app.exception_handler(NutritionEstimationError)
    async def handle_estimation_error(request: Request, exc: NutritionEstimationError):
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                request,
                "ESTIMATION_REJECTED",
                "目前无法生成科学可信的估算，请重新拍照或手动确认。",
            ),
        )

    @app.get("/healthz", response_model=HealthResponse)
    async def health() -> HealthResponse:
        engine = get_engine()
        provider_mode = getattr(active_provider, "mode_label", "injected")
        return HealthResponse(
            status="ok",
            datasetVersion=engine.catalog.dataset_version,
            catalogFoodCount=engine.catalog.count,
            providerMode=provider_mode,
        )

    @app.post(
        "/v1/analyze-meal",
        response_model=MealAnalysisResponse,
        responses={
            413: {"model": ErrorResponse},
            415: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    async def analyze_meal(request: Request) -> MealAnalysisResponse:
        upload: Optional[UploadFile] = None
        image_path: Optional[Path] = None
        try:
            try:
                form = await request.form(
                    max_files=1,
                    max_fields=8,
                    max_part_size=active_settings.max_image_bytes + 1,
                )
            except MultiPartException as exc:
                raise ApiError(413, "IMAGE_TOO_LARGE", "上传图片超过允许大小。") from exc

            raw_upload = form.get("image")
            if not isinstance(raw_upload, UploadFile):
                raise ApiError(422, "IMAGE_REQUIRED", "必须提供 image 图片字段。")
            upload = raw_upload

            if not request.state.had_client_request_id:
                form_request_id = _valid_request_id(str(form.get("request_id", "")))
                if form_request_id:
                    request.state.request_id = form_request_id

            locale = str(form.get("locale", "zh-CN"))[:20]
            market = str(form.get("market", "MY"))[:8]
            image_path, mime_type = await persist_private_image(
                upload,
                max_bytes=active_settings.max_image_bytes,
            )

            try:
                vision = await active_provider.analyze(
                    image_path=image_path,
                    mime_type=mime_type,
                    locale=locale,
                    market=market,
                )
            except Exception as exc:
                # Do not propagate provider messages: they can contain upstream
                # payload details. The temporary image is still removed below.
                raise ApiError(
                    503,
                    "VISION_PROVIDER_UNAVAILABLE",
                    "视觉识别暂时不可用，请稍后重试。",
                ) from exc
            return get_engine().estimate(request.state.request_id, vision)
        except ImageValidationError as exc:
            raise ApiError(exc.status_code, exc.code, exc.message) from exc
        finally:
            delete_private_image(image_path)
            if upload is not None:
                await upload.close()

    return app


app = create_app()
