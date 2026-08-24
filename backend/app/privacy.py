from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from starlette.datastructures import UploadFile


ALLOWED_IMAGE_TYPES = {
    "image/jpeg": (".jpg",),
    "image/png": (".png",),
    "image/webp": (".webp",),
}
READ_CHUNK_BYTES = 64 * 1024


class ImageValidationError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _sniff_mime(header: bytes) -> Optional[str]:
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    return None


async def persist_private_image(
    upload: UploadFile,
    max_bytes: int,
) -> Tuple[Path, str]:
    declared_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if declared_type not in ALLOWED_IMAGE_TYPES:
        raise ImageValidationError(
            "UNSUPPORTED_IMAGE_TYPE",
            "仅支持 JPEG、PNG 或 WebP 图片。",
            415,
        )
    if upload.size is not None and upload.size > max_bytes:
        raise ImageValidationError("IMAGE_TOO_LARGE", "图片超过允许大小。", 413)

    first_chunk = await upload.read(READ_CHUNK_BYTES)
    actual_type = _sniff_mime(first_chunk)
    if actual_type is None:
        raise ImageValidationError("INVALID_IMAGE", "文件不是有效的支持图片。", 415)
    if actual_type != declared_type:
        raise ImageValidationError(
            "IMAGE_TYPE_MISMATCH",
            "图片内容与声明格式不一致。",
            415,
        )

    suffix = ALLOWED_IMAGE_TYPES[actual_type][0]
    descriptor, raw_path = tempfile.mkstemp(prefix="cc-meal-", suffix=suffix)
    image_path = Path(raw_path)
    os.chmod(image_path, 0o600)
    total = 0
    try:
        with os.fdopen(descriptor, "wb") as handle:
            chunk = first_chunk
            while chunk:
                total += len(chunk)
                if total > max_bytes:
                    raise ImageValidationError("IMAGE_TOO_LARGE", "图片超过允许大小。", 413)
                handle.write(chunk)
                chunk = await upload.read(READ_CHUNK_BYTES)
        return image_path, actual_type
    except BaseException:
        image_path.unlink(missing_ok=True)
        raise


def delete_private_image(image_path: Optional[Path]) -> None:
    if image_path is not None:
        image_path.unlink(missing_ok=True)

