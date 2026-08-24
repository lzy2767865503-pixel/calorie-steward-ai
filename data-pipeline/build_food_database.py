#!/usr/bin/env python3
"""Build the Clinical Clarity 5,000-record food catalogue.

The pipeline consumes only official USDA FoodData Central bulk downloads. Every
nutrient stored in the catalogue is copied from the selected USDA food record;
missing nutrients stay NULL. No translations or inferred nutrients are created.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence
from urllib.error import HTTPError

try:
    import ijson
except ImportError as exc:  # pragma: no cover - exercised by the CLI preflight
    raise SystemExit(
        "Missing dependency 'ijson'. Run: python3 -m pip install -r requirements.txt"
    ) from exc


PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
DATA_DIR = PROJECT_DIR / "data"
DATABASE_PATH = (
    PROJECT_DIR
    / "android-app"
    / "app"
    / "src"
    / "main"
    / "assets"
    / "databases"
    / "clinical_clarity_foods.sqlite"
)
CSV_PATH = DATA_DIR / "food-catalog.csv"
MANIFEST_PATH = DATA_DIR / "dataset-manifest.json"
QUALITY_PATH = DATA_DIR / "quality-report.json"
SHA_PATH = DATA_DIR / "SHA256SUMS"
DIFF_PATH = DATA_DIR / "catalog-v3-added-supermarket-foods.csv"

EXPECTED_COUNT = 5_000
PREVIOUS_COUNT = 2_000
ADDED_BRANDED_COUNT = 3_000
CATALOG_VERSION = "USDA-FDC-CC-2026.08-v3"
PREVIOUS_CATALOG_VERSION = "USDA-FDC-CC-2026.08-v2"
PREVIOUS_SOURCE_ID_SET_SHA256 = (
    "18c0d00706004468dc31c30875b37f6a6b38907bb3a84ef8da1fe9af7331038d"
)
PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256 = (
    "24f7e3c2ef59c34762697c99948d42b852bc05ff7a1f39b3118bff30713a4a7a"
)
RETAINED_V2_KNOWN_DISCONTINUED_SOURCE_IDS = {
    "USDA-FDC-2772590",
    "USDA-FDC-2773295",
    "USDA-FDC-2773438",
}
DATABASE_SCHEMA_VERSION = 3
CATALOG_EFFECTIVE_DATE = "2026-08-18"
PREVIOUS_QUOTAS = {"foundation": 300, "survey": 1_300, "branded": 400}
QUOTAS = {"foundation": 300, "survey": 1_300, "branded": 3_400}
MUST_INCLUDE_ANCHORS: dict[str, tuple[str, ...]] = {
    "survey": (
        "Rice, white, cooked, no added fat",
        "Soup, broth",
    ),
}
BRANDED_API_PAGE_SIZE = 200
PREVIOUS_BRANDED_API_PAGE_COUNT = 3
BRANDED_GROCERY_API_PAGE_COUNT = 3
BRANDED_API_ENDPOINT = "https://api.nal.usda.gov/fdc/v1/foods/search"
BRANDED_PORTAL_ENDPOINT = "https://fdc.nal.usda.gov/portal-data/external/search"
BRANDED_PORTAL_PAGE_START = 1
BRANDED_PORTAL_PAGE_END = 82
BRANDED_PORTAL_PAGE_SIZE = 50
BRANDED_SNAPSHOT_DATE = os.environ.get(
    "FDC_BRANDED_SNAPSHOT_DATE",
    datetime.now().astimezone().date().isoformat(),
)

FDC_DETAILS_URL = "https://fdc.nal.usda.gov/fdc-app.html#/food-details/{fdc_id}/nutrients"
FDC_DOWNLOADS_URL = "https://fdc.nal.usda.gov/download-datasets/"
FDC_DOCUMENTATION_URL = "https://fdc.nal.usda.gov/data-documentation.html"
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


@dataclass(frozen=True)
class DatasetSpec:
    key: str
    label: str
    release: str
    url: str
    json_prefix: str
    quality_grade: str
    quality_rank: int

    @property
    def cache_name(self) -> str:
        return f"{self.key}-{self.release}.zip"


DATASETS: dict[str, DatasetSpec] = {
    "foundation": DatasetSpec(
        key="foundation",
        label="USDA FoodData Central Foundation Foods",
        release="2026-04-30",
        url=(
            "https://fdc.nal.usda.gov/fdc-datasets/"
            "FoodData_Central_foundation_food_json_2026-04-30.zip"
        ),
        json_prefix="FoundationFoods.item",
        quality_grade="A",
        quality_rank=1,
    ),
    "survey": DatasetSpec(
        key="survey",
        label="USDA FoodData Central Survey Foods (FNDDS 2021-2023)",
        release="2024-10-31",
        url=(
            "https://fdc.nal.usda.gov/fdc-datasets/"
            "FoodData_Central_survey_food_json_2024-10-31.zip"
        ),
        json_prefix="SurveyFoods.item",
        quality_grade="C",
        quality_rank=3,
    ),
    "branded": DatasetSpec(
        key="branded",
        label="USDA FoodData Central Branded Foods API snapshot",
        release=BRANDED_SNAPSHOT_DATE,
        url=BRANDED_API_ENDPOINT,
        json_prefix="foods.item",
        quality_grade="B",
        quality_rank=2,
    ),
}

BRANDED_BULK_SPEC = DatasetSpec(
    key="branded",
    label="USDA FoodData Central Branded Foods bulk JSON",
    release="2026-04-30",
    url=(
        "https://fdc.nal.usda.gov/fdc-datasets/"
        "FoodData_Central_branded_food_json_2026-04-30.zip"
    ),
    json_prefix="BrandedFoods.item",
    quality_grade="B",
    quality_rank=2,
)

BRANDED_PORTAL_SPEC = DatasetSpec(
    key="branded",
    label="USDA FoodData Central website GROCERY search snapshot",
    release=BRANDED_SNAPSHOT_DATE,
    url=BRANDED_PORTAL_ENDPOINT,
    json_prefix="foods.item",
    quality_grade="B",
    quality_rank=2,
)


@dataclass
class FoodRow:
    id: int = 0
    source_id: str = ""
    name_en: str = ""
    name_zh: str | None = None
    name_ms: str | None = None
    category: str = ""
    data_type: str = ""
    energy_kcal_100g: float | None = None
    protein_g_100g: float | None = None
    carbohydrate_g_100g: float | None = None
    fat_g_100g: float | None = None
    fibre_g_100g: float | None = None
    sodium_mg_100g: float | None = None
    serving_g: float | None = None
    barcode: str | None = None
    barcode_gtin14: str | None = None
    gtin_recovered_missing_leading_zero: int = 0
    brand: str | None = None
    market_country: str | None = None
    trade_channels: str | None = None
    publication_date: str | None = None
    modified_date: str | None = None
    discontinued_date: str | None = None
    discontinuation_status: str = "NOT_APPLICABLE"
    source_name: str = "USDA FoodData Central"
    source_url: str = ""
    quality_grade: str = ""
    dataset_version: str = ""
    quality_rank: int = 0
    active: int = 1
    aliases: list[str] = field(default_factory=list, repr=False)
    source_dataset: str = field(default="", repr=False)
    nutrient_provenance: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)

    def identity(self) -> str:
        return "|".join(
            (
                normalize_identity(self.name_en),
                normalize_identity(self.brand or ""),
            )
        )


FOOD_COLUMNS = [
    "id",
    "source_id",
    "name_en",
    "name_zh",
    "name_ms",
    "category",
    "data_type",
    "energy_kcal_100g",
    "protein_g_100g",
    "carbohydrate_g_100g",
    "fat_g_100g",
    "fibre_g_100g",
    "sodium_mg_100g",
    "serving_g",
    "barcode",
    "barcode_gtin14",
    "gtin_recovered_missing_leading_zero",
    "brand",
    "market_country",
    "trade_channels",
    "publication_date",
    "modified_date",
    "discontinued_date",
    "discontinuation_status",
    "source_name",
    "source_url",
    "quality_grade",
    "dataset_version",
    "quality_rank",
    "active",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_space(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def normalize_identity(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def normalize_iso_date(value: Any) -> str | None:
    raw = normalize_space(value)
    if not raw:
        return None
    for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], pattern).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def branded_version_key(item: dict[str, Any]) -> tuple[str, str, int]:
    publication_date = normalize_iso_date(
        item.get("publicationDate") or item.get("publishedDate")
    ) or ""
    modified_date = normalize_iso_date(item.get("modifiedDate")) or ""
    try:
        fdc_id = int(item.get("fdcId") or 0)
    except (TypeError, ValueError):
        fdc_id = 0
    return publication_date, modified_date, fdc_id


def discontinuation_marker_reason(item: dict[str, Any]) -> str | None:
    """Return an explicit USDA discontinuation marker without inferring stock."""
    discontinued_date = normalize_iso_date(item.get("discontinuedDate"))
    date_marker = (
        discontinued_date is not None
        and discontinued_date <= CATALOG_EFFECTIVE_DATE
    )
    description = " ".join(
        normalize_space(item.get(field))
        for field in ("description", "shortDescription")
    )
    description_marker = bool(
        re.search(
            r"(?<![A-Za-z0-9])DISCONTINUED(?![A-Za-z0-9])",
            description,
            flags=re.IGNORECASE,
        )
    )
    if date_marker and description_marker:
        return "DATE_AND_DESCRIPTION"
    if date_marker:
        return "DATE"
    if description_marker:
        return "DESCRIPTION"
    return None


def discontinuation_status(item: dict[str, Any]) -> str:
    """Classify evidence; UNKNOWN is not represented as current availability."""
    if discontinuation_marker_reason(item):
        return "KNOWN_DISCONTINUED"
    discontinued_date = normalize_iso_date(item.get("discontinuedDate"))
    if discontinued_date and discontinued_date > CATALOG_EFFECTIVE_DATE:
        return "FUTURE_DISCONTINUATION_DATE"
    if "discontinuedDate" in item:
        return "NO_KNOWN_MARKER"
    return "UNKNOWN"


def safe_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def plausible_nonnegative(value: Any, maximum: float | None = None) -> float | None:
    parsed = safe_number(value)
    if parsed is None or parsed < 0:
        return None
    if maximum is not None and parsed > maximum:
        return None
    return parsed


def gtin_checksum_is_valid(digits: str) -> bool:
    if len(digits) not in {8, 12, 13, 14} or not digits.isdigit():
        return False
    weighted_sum = sum(
        int(digit) * (3 if (len(digits) - index) % 2 == 0 else 1)
        for index, digit in enumerate(digits[:-1])
    )
    expected = (10 - weighted_sum % 10) % 10
    return expected == int(digits[-1])


def valid_barcode(value: Any) -> str | None:
    """Return a check-digit-valid GTIN without inventing ambiguous zeroes.

    USDA sometimes serializes GTIN-8 or UPC-A after dropping exactly one
    leading zero. Only those unambiguous 7->8 and 11->12 recoveries are
    accepted. Other unsupported lengths remain invalid rather than being
    broadly padded into a potentially different retail symbol.
    """
    return normalize_source_gtin(value)[0]


def normalize_source_gtin(value: Any) -> tuple[str | None, bool]:
    raw = normalize_space(value)
    if not raw:
        return None, False
    digits = re.sub(r"\D", "", raw)
    if gtin_checksum_is_valid(digits):
        return digits, False
    if len(digits) in {7, 11}:
        recovered = f"0{digits}"
        if gtin_checksum_is_valid(recovered):
            return recovered, True
    return None, False


def scan_compatible_barcode(gtin: str) -> str:
    """Return the value emitted by common UPC-A/EAN-13 scanners.

    FoodData Central commonly serializes a UPC-A as a 14-digit GTIN with two
    leading zeroes. ML Kit emits that printed symbol as 12-digit UPC-A, so the
    lookup column stores the scanner form while ``barcode_gtin14`` preserves the
    canonical GTIN representation.
    """
    gtin14 = gtin.zfill(14)
    if gtin14.startswith("00"):
        candidate = gtin14[2:]
        if gtin_checksum_is_valid(candidate):
            return candidate
    if gtin14.startswith("0"):
        candidate = gtin14[1:]
        if gtin_checksum_is_valid(candidate):
            return candidate
    return gtin14


def extract_category(item: dict[str, Any], dataset_key: str) -> str:
    if dataset_key == "branded":
        branded_category = normalize_space(item.get("brandedFoodCategory"))
        if branded_category:
            return branded_category
    if dataset_key == "survey":
        value = item.get("wweiaFoodCategory")
        if isinstance(value, dict):
            category = normalize_space(
                value.get("wweiaFoodCategoryDescription")
                or value.get("description")
            )
            if category:
                return category
        for attribute in item.get("foodAttributes") or []:
            if normalize_space(attribute.get("name")).casefold() == "wweia category description":
                category = normalize_space(attribute.get("value"))
                if category:
                    return category
    value = item.get("foodCategory")
    if isinstance(value, dict):
        return normalize_space(value.get("description") or value.get("name")) or "Uncategorized"
    return normalize_space(value) or "Uncategorized"


def extract_serving_grams(item: dict[str, Any], dataset_key: str) -> float | None:
    if dataset_key == "branded":
        amount = plausible_nonnegative(item.get("servingSize"), maximum=20_000)
        unit = normalize_space(item.get("servingSizeUnit")).casefold().replace(".", "")
        if amount is None or amount == 0:
            return None
        if unit in {"g", "grm", "gram", "grams"}:
            return amount
        if unit in {"oz", "ounce", "ounces"}:
            return amount * 28.349523125
        return None

    portions = item.get("foodPortions") or []
    candidates: list[tuple[int, float]] = []
    for portion in portions:
        grams = plausible_nonnegative(portion.get("gramWeight"), maximum=20_000)
        if grams is None or grams == 0:
            continue
        sequence = portion.get("sequenceNumber")
        try:
            priority = int(sequence) if sequence is not None else 9_999
        except (TypeError, ValueError):
            priority = 9_999
        candidates.append((priority, grams))
    return min(candidates, default=(0, None), key=lambda pair: pair[0])[1]


def extract_nutrients(
    item: dict[str, Any],
) -> tuple[dict[str, float | None], dict[str, dict[str, Any]]]:
    by_id: dict[int, tuple[str, float, dict[str, Any]]] = {}
    for food_nutrient in item.get("foodNutrients") or []:
        nutrient = food_nutrient.get("nutrient") or {}
        try:
            nutrient_id = int(nutrient.get("id") or food_nutrient.get("nutrientId"))
        except (TypeError, ValueError):
            continue
        amount = plausible_nonnegative(
            food_nutrient.get("amount")
            if food_nutrient.get("amount") is not None
            else food_nutrient.get("value")
        )
        if amount is None:
            continue
        unit = normalize_space(
            nutrient.get("unitName") or food_nutrient.get("unitName")
        ).casefold()
        derivation = food_nutrient.get("foodNutrientDerivation") or {}
        nutrient_source = derivation.get("foodNutrientSource") or {}
        provenance = {
            "fdc_nutrient_id": nutrient_id,
            "unit_name": unit,
            "derivation_code": normalize_space(
                derivation.get("code") or food_nutrient.get("derivationCode")
            )
            or None,
            "derivation_description": normalize_space(
                derivation.get("description")
                or food_nutrient.get("derivationDescription")
            )
            or None,
            "nutrient_source_description": normalize_space(
                nutrient_source.get("description")
                or food_nutrient.get("foodNutrientSourceDescription")
            )
            or None,
            "data_points": (
                int(food_nutrient["dataPoints"])
                if safe_number(food_nutrient.get("dataPoints")) is not None
                else None
            ),
        }
        by_id[nutrient_id] = (unit, amount, provenance)

    energy: float | None = None
    energy_id: int | None = None
    for nutrient_id in (1008, 2048, 2047):
        unit_amount = by_id.get(nutrient_id)
        if unit_amount and unit_amount[0] == "kcal":
            energy = plausible_nonnegative(unit_amount[1], maximum=1_000)
            if energy is not None:
                energy_id = nutrient_id
                break

    def amount(nutrient_id: int, maximum: float) -> float | None:
        unit_amount = by_id.get(nutrient_id)
        return (
            plausible_nonnegative(unit_amount[1], maximum=maximum)
            if unit_amount
            else None
        )

    values = {
        "energy_kcal_100g": energy,
        "protein_g_100g": amount(1003, 100),
        "carbohydrate_g_100g": amount(1005, 100),
        "fat_g_100g": amount(1004, 100),
        "fibre_g_100g": amount(1079, 100),
        "sodium_mg_100g": amount(1093, 100_000),
    }
    source_ids = {
        "energy_kcal_100g": energy_id,
        "protein_g_100g": 1003,
        "carbohydrate_g_100g": 1005,
        "fat_g_100g": 1004,
        "fibre_g_100g": 1079,
        "sodium_mg_100g": 1093,
    }
    provenance: dict[str, dict[str, Any]] = {}
    for key, nutrient_id in source_ids.items():
        if values[key] is None or nutrient_id is None or nutrient_id not in by_id:
            continue
        details = dict(by_id[nutrient_id][2])
        details["amount"] = values[key]
        provenance[key] = details
    return values, provenance


def normalize_food(item: dict[str, Any] | None, spec: DatasetSpec) -> FoodRow | None:
    if not isinstance(item, dict):
        return None
    name = normalize_space(item.get("description"))
    fdc_id = normalize_space(item.get("fdcId"))
    if not name or not fdc_id.isdigit():
        return None

    nutrients, nutrient_provenance = extract_nutrients(item)
    if nutrients["energy_kcal_100g"] is None:
        return None

    category = extract_category(item, spec.key)
    serving_g = extract_serving_grams(item, spec.key)

    # A zero-energy edible oil is not a physically credible per-100 g profile.
    # This most often comes from label rounding on tiny oil-spray servings, but
    # the exclusion applies to every source so the catalogue invariant does not
    # depend on which USDA dataset supplied the record.
    if (
        normalize_identity(category) == "oils edible"
        and nutrients["energy_kcal_100g"] <= 0
    ):
        return None

    brand = None
    barcode = None
    barcode_gtin14 = None
    gtin_recovered_missing_leading_zero = 0
    market_country = None
    trade_channels = None
    publication_date = None
    modified_date = None
    discontinued_date = None
    row_discontinuation_status = "NOT_APPLICABLE"
    if spec.key == "branded":
        brand = normalize_space(item.get("brandOwner") or item.get("brandName")) or None
        source_barcode, recovered_missing_zero = normalize_source_gtin(
            item.get("gtinUpc")
        )
        if source_barcode is None:
            return None
        # The Android barcode path calculates from a labelled serving. A missing
        # serving must never silently become a made-up 100 g "standard serving".
        if serving_g is None:
            return None
        if nutrients["energy_kcal_100g"] <= 0:
            return None
        barcode_gtin14 = source_barcode.zfill(14)
        barcode = scan_compatible_barcode(source_barcode)
        gtin_recovered_missing_leading_zero = int(recovered_missing_zero)
        market_country = normalize_space(item.get("marketCountry")) or None
        raw_trade_channels = item.get("tradeChannels") or []
        if isinstance(raw_trade_channels, str):
            raw_trade_channels = [raw_trade_channels]
        normalized_trade_channels = sorted(
            {
                normalize_space(value).upper()
                for value in raw_trade_channels
                if normalize_space(value)
            }
        )
        trade_channels = "|".join(normalized_trade_channels) or None
        publication_date = normalize_iso_date(
            item.get("publicationDate") or item.get("publishedDate")
        )
        modified_date = normalize_iso_date(item.get("modifiedDate"))
        discontinued_date = normalize_iso_date(item.get("discontinuedDate"))
        row_discontinuation_status = discontinuation_status(item)

    data_type = normalize_space(item.get("dataType"))
    if not data_type:
        data_type = {
            "foundation": "Foundation",
            "survey": "Survey (FNDDS)",
            "branded": "Branded",
        }[spec.key]

    aliases = [name.casefold()]
    food_code = normalize_space(item.get("foodCode"))
    if food_code:
        aliases.append(food_code)
    if brand:
        aliases.append(f"{brand} {name}".casefold())
    if barcode:
        aliases.append(barcode)
    if barcode_gtin14 and barcode_gtin14 != barcode:
        aliases.append(barcode_gtin14)
    household = normalize_space(item.get("householdServingFullText"))
    if household:
        aliases.append(household.casefold())

    return FoodRow(
        source_id=f"USDA-FDC-{fdc_id}",
        name_en=name,
        category=category,
        data_type=data_type,
        energy_kcal_100g=nutrients["energy_kcal_100g"],
        protein_g_100g=nutrients["protein_g_100g"],
        carbohydrate_g_100g=nutrients["carbohydrate_g_100g"],
        fat_g_100g=nutrients["fat_g_100g"],
        fibre_g_100g=nutrients["fibre_g_100g"],
        sodium_mg_100g=nutrients["sodium_mg_100g"],
        serving_g=serving_g,
        barcode=barcode,
        barcode_gtin14=barcode_gtin14,
        gtin_recovered_missing_leading_zero=(
            gtin_recovered_missing_leading_zero
        ),
        brand=brand,
        market_country=market_country,
        trade_channels=trade_channels,
        publication_date=publication_date,
        modified_date=modified_date,
        discontinued_date=discontinued_date,
        discontinuation_status=row_discontinuation_status,
        source_url=FDC_DETAILS_URL.format(fdc_id=fdc_id),
        quality_grade=spec.quality_grade,
        dataset_version=f"{spec.label}; release {spec.release}",
        quality_rank=spec.quality_rank,
        aliases=sorted(set(filter(None, aliases))),
        source_dataset=spec.key,
        nutrient_provenance=nutrient_provenance,
    )


def download(spec: DatasetSpec, offline: bool) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    destination = CACHE_DIR / spec.cache_name
    if destination.exists() and zipfile.is_zipfile(destination):
        print(f"Using cached {destination.name} ({destination.stat().st_size:,} bytes)")
        return destination
    if offline:
        raise FileNotFoundError(f"Offline mode: missing cached source {destination}")

    partial = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(
        spec.url,
        headers={"User-Agent": "ClinicalClarityFoodPipeline/1.0 (+auditable USDA import)"},
    )
    print(f"Downloading {spec.label}: {spec.url}")
    with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
        total = int(response.headers.get("Content-Length") or 0)
        copied = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            copied += len(chunk)
            if total and (copied == total or copied // (25 * 1024 * 1024) != (copied - len(chunk)) // (25 * 1024 * 1024)):
                print(f"  {copied / total:6.1%} ({copied:,}/{total:,} bytes)")
    partial.replace(destination)
    if not zipfile.is_zipfile(destination):
        raise ValueError(f"Downloaded file is not a valid ZIP archive: {destination}")
    return destination


def iter_json_records(path: Path, spec: DatasetSpec) -> Iterator[dict[str, Any]]:
    with zipfile.ZipFile(path) as archive:
        json_members = [name for name in archive.namelist() if name.casefold().endswith(".json")]
        if len(json_members) != 1:
            raise ValueError(f"Expected one JSON member in {path.name}; found {json_members}")
        with archive.open(json_members[0], "r") as stream:
            yield from ijson.items(stream, spec.json_prefix)


def fetch_branded_api(
    api_key: str, offline: bool, *, grocery_only: bool
) -> list[Path]:
    """Fetch an auditable snapshot from USDA's official search API."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    pages_needed = (
        BRANDED_GROCERY_API_PAGE_COUNT
        if grocery_only
        else PREVIOUS_BRANDED_API_PAGE_COUNT
    )
    for page_number in range(1, pages_needed + 1):
        cache_prefix = "branded-grocery-api" if grocery_only else "branded-api"
        destination = CACHE_DIR / (
            f"{cache_prefix}-{DATASETS['branded'].release}-page-{page_number:03d}.json"
        )
        if destination.exists():
            try:
                cached = json.loads(destination.read_text(encoding="utf-8"))
                if isinstance(cached.get("foods"), list):
                    paths.append(destination)
                    print(f"Using cached {destination.name} ({destination.stat().st_size:,} bytes)")
                    continue
            except (OSError, ValueError, AttributeError):
                pass
        if offline:
            raise FileNotFoundError(f"Offline mode: missing cached API page {destination}")

        query_parameters = {
            "api_key": api_key,
            "dataType": "Branded",
            "pageSize": BRANDED_API_PAGE_SIZE,
            "pageNumber": page_number,
            "sortBy": "publishedDate",
            "sortOrder": "desc",
        }
        if grocery_only:
            query_parameters["query"] = "tradeChannels:GROCERY"
        query = urllib.parse.urlencode(query_parameters)
        request = urllib.request.Request(
            f"{BRANDED_API_ENDPOINT}?{query}",
            headers={"User-Agent": "ClinicalClarityFoodPipeline/1.0 (+auditable USDA import)"},
        )
        print(
            f"Downloading USDA Branded {'GROCERY ' if grocery_only else ''}API page "
            f"{page_number}/{pages_needed} "
            f"({BRANDED_API_PAGE_SIZE} requested records)"
        )
        payload: bytes | None = None
        for attempt in range(1, 7):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    payload = response.read()
                break
            except HTTPError as error:
                if error.code != 429 or attempt == 6:
                    raise
                retry_after = error.headers.get("Retry-After")
                try:
                    delay_seconds = max(1, min(int(retry_after or 0), 30))
                except ValueError:
                    delay_seconds = 0
                if delay_seconds == 0:
                    delay_seconds = min(5 * (2 ** (attempt - 1)), 30)
                print(
                    f"  USDA API rate limited page {page_number}; retrying in "
                    f"{delay_seconds}s (attempt {attempt}/6)"
                )
                time.sleep(delay_seconds)
        if payload is None:
            raise RuntimeError(f"USDA API page {page_number} returned no payload")
        parsed = json.loads(payload)
        if not isinstance(parsed.get("foods"), list):
            raise ValueError(f"USDA API page {page_number} has no foods array")
        if grocery_only and any(
            "GROCERY" not in (food.get("tradeChannels") or [])
            for food in parsed["foods"]
        ):
            raise ValueError(
                f"USDA API GROCERY query page {page_number} contains a non-GROCERY row"
            )
        temporary = destination.with_suffix(".json.part")
        temporary.write_bytes(payload)
        temporary.replace(destination)
        paths.append(destination)
        # USDA's DEMO_KEY has a low burst allowance. A small fixed delay keeps
        # the resumable page cache polite without affecting offline rebuilds.
        time.sleep(2)
    return paths


def fetch_branded_portal(offline: bool) -> list[Path]:
    """Freeze a deterministic supplementary slice of official website search."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []

    def validate(payload: dict[str, Any], page_number: int) -> None:
        foods = payload.get("foods")
        if not isinstance(foods, list):
            raise ValueError(f"USDA portal page {page_number} has no foods array")
        if int(payload.get("currentPage") or 0) != page_number:
            raise ValueError(
                f"USDA portal page mismatch: requested {page_number}, "
                f"received {payload.get('currentPage')!r}"
            )
        total_hits = int(payload.get("totalHits") or 0)
        expected_rows = min(
            BRANDED_PORTAL_PAGE_SIZE,
            max(0, total_hits - (page_number - 1) * BRANDED_PORTAL_PAGE_SIZE),
        )
        if len(foods) != expected_rows:
            raise ValueError(
                f"USDA portal page {page_number} expected "
                f"{expected_rows} rows from totalHits={total_hits}; got {len(foods)}"
            )
        if any(
            "GROCERY" not in (food.get("tradeChannels") or []) for food in foods
        ):
            raise ValueError(
                f"USDA portal GROCERY page {page_number} contains a non-GROCERY row"
            )

    for page_number in range(BRANDED_PORTAL_PAGE_START, BRANDED_PORTAL_PAGE_END + 1):
        destination = CACHE_DIR / (
            f"branded-portal-grocery-{BRANDED_SNAPSHOT_DATE}-"
            f"page-{page_number:03d}.json"
        )
        if destination.exists():
            try:
                cached = json.loads(destination.read_text(encoding="utf-8"))
                validate(cached, page_number)
                paths.append(destination)
                print(f"Using cached {destination.name} ({destination.stat().st_size:,} bytes)")
                continue
            except (OSError, ValueError, TypeError, AttributeError):
                pass
        if offline:
            raise FileNotFoundError(f"Offline mode: missing cached portal page {destination}")

        request_payload = {
            "generalSearchInput": "",
            "includeDataTypes": {
                "Survey (FNDDS)": False,
                "Foundation": False,
                "Branded": True,
                "SR Legacy": False,
                "Experimental": False,
            },
            "includeTradeChannels": {
                "NO_TRADE_CHANNEL": False,
                "GROCERY": True,
                "CHILD_NUTRITION_FOOD_PROGRAMS": False,
                "FOOD_SERVICE": False,
                "VENDING": False,
                "ONLINE": False,
                "MASS_MERCHANDISING": False,
                "MILITARY": False,
                "CONVENIENCE": False,
                "DRUG": False,
                "ALL_UNCHECKED_HANDLE": False,
            },
            "pageNumber": page_number,
            "currentPage": page_number,
            "sortField": "publishedDate",
            "sortDirection": "desc",
            "requireAllWords": False,
        }
        encoded = json.dumps(request_payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            BRANDED_PORTAL_ENDPOINT,
            data=encoded,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ClinicalClarityFoodPipeline/1.0 (+auditable USDA import)",
            },
            method="POST",
        )
        print(
            f"Downloading USDA portal GROCERY page {page_number}/"
            f"{BRANDED_PORTAL_PAGE_END} ({BRANDED_PORTAL_PAGE_SIZE} rows)"
        )
        response_payload: bytes | None = None
        for attempt in range(1, 6):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    response_payload = response.read()
                break
            except HTTPError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 5:
                    raise
                delay_seconds = min(5 * (2 ** (attempt - 1)), 30)
                print(
                    f"  portal page {page_number} HTTP {error.code}; retrying in "
                    f"{delay_seconds}s (attempt {attempt}/5)"
                )
                time.sleep(delay_seconds)
        if response_payload is None:
            raise RuntimeError(f"USDA portal page {page_number} returned no payload")
        parsed = json.loads(response_payload)
        validate(parsed, page_number)
        temporary = destination.with_suffix(".json.part")
        temporary.write_bytes(response_payload)
        temporary.replace(destination)
        paths.append(destination)
        time.sleep(1)
    return paths


def collect_branded_api(paths: Sequence[Path], spec: DatasetSpec) -> tuple[list[FoodRow], dict[str, int]]:
    candidates: list[FoodRow] = []
    counters = defaultdict(int)
    seen_source_ids: set[str] = set()
    seen_barcodes: set[str] = set()
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for item in payload.get("foods") or []:
            counters["records_scanned"] += 1
            row = normalize_food(item, spec)
            if row is None:
                counters["records_rejected_missing_identity_energy_or_barcode"] += 1
                continue
            if row.source_id in seen_source_ids:
                counters["records_rejected_duplicate_source_id"] += 1
                continue
            if row.barcode and row.barcode in seen_barcodes:
                counters["records_rejected_duplicate_barcode"] += 1
                continue
            seen_source_ids.add(row.source_id)
            if row.barcode:
                seen_barcodes.add(row.barcode)
            candidates.append(row)
            counters["eligible_candidates"] += 1
    return candidates, dict(counters)


def collect_branded_expansion(
    bulk_path: Path,
    retained_api_paths: Sequence[Path],
    grocery_api_paths: Sequence[Path],
    portal_paths: Sequence[Path],
    bulk_spec: DatasetSpec,
    api_spec: DatasetSpec,
    portal_spec: DatasetSpec,
) -> tuple[list[FoodRow], dict[str, Any]]:
    """Resolve global latest GTIN versions without retaining the full bulk in memory."""
    counters = defaultdict(int)
    search_source_ids: dict[str, set[int]] = defaultdict(set)
    raw_gtin_lengths: dict[str, Counter[str]] = defaultdict(Counter)
    recovered_lengths: dict[str, Counter[str]] = defaultdict(Counter)
    recovered_canonical_gtins: dict[str, set[str]] = defaultdict(set)
    with tempfile.NamedTemporaryFile(
        prefix="clinical-clarity-branded-latest-", suffix=".sqlite", delete=False
    ) as temporary:
        index_path = Path(temporary.name)

    upsert_sql = """
        INSERT INTO latest_gtin(
            gtin14, version_key, fdc_id, component, is_grocery,
            discontinued_date, recovered_missing_leading_zero,
            has_nonrecovered_version, known_discontinuation_marker,
            discontinuation_marker_reason, discontinuation_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(gtin14) DO UPDATE SET
            version_key = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.version_key ELSE latest_gtin.version_key END,
            fdc_id = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.fdc_id ELSE latest_gtin.fdc_id END,
            component = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.component ELSE latest_gtin.component END,
            is_grocery = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.is_grocery ELSE latest_gtin.is_grocery END,
            discontinued_date = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.discontinued_date ELSE latest_gtin.discontinued_date END,
            recovered_missing_leading_zero = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.recovered_missing_leading_zero
                ELSE latest_gtin.recovered_missing_leading_zero END,
            known_discontinuation_marker = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.known_discontinuation_marker
                ELSE latest_gtin.known_discontinuation_marker END,
            discontinuation_marker_reason = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.discontinuation_marker_reason
                ELSE latest_gtin.discontinuation_marker_reason END,
            discontinuation_status = CASE
                WHEN excluded.version_key > latest_gtin.version_key
                THEN excluded.discontinuation_status
                ELSE latest_gtin.discontinuation_status END,
            has_nonrecovered_version = MAX(
                latest_gtin.has_nonrecovered_version,
                excluded.has_nonrecovered_version
            )
    """

    def index_item(
        connection: sqlite3.Connection, item: dict[str, Any], component: str
    ) -> None:
        counters[f"{component}_records_scanned"] += 1
        raw_gtin_digits = re.sub(r"\D", "", normalize_space(item.get("gtinUpc")))
        raw_length = str(len(raw_gtin_digits))
        raw_gtin_lengths[component][raw_length] += 1
        source_barcode, recovered_missing_zero = normalize_source_gtin(
            item.get("gtinUpc")
        )
        if source_barcode is None:
            counters[f"{component}_records_rejected_invalid_gtin"] += 1
            if len(raw_gtin_digits) in {7, 11}:
                counters[
                    f"{component}_missing_leading_zero_recovery_checksum_failures"
                ] += 1
            elif not raw_gtin_digits:
                counters[f"{component}_missing_raw_gtin_records"] += 1
            elif len(raw_gtin_digits) not in {8, 12, 13, 14}:
                counters[f"{component}_unsupported_raw_gtin_length_records"] += 1
            else:
                counters[f"{component}_invalid_gtin_checksum_records"] += 1
            return
        if recovered_missing_zero:
            canonical_gtin = source_barcode.zfill(14)
            counters[
                f"{component}_recovered_missing_leading_zero_gtin_records"
            ] += 1
            recovered_lengths[component][raw_length] += 1
            recovered_canonical_gtins[component].add(canonical_gtin)
        raw_channels = item.get("tradeChannels") or []
        if isinstance(raw_channels, str):
            raw_channels = [raw_channels]
        normalized_channels = {
            normalize_space(value).upper() for value in raw_channels
        }
        is_grocery = int("GROCERY" in normalized_channels)
        if is_grocery:
            counters[f"{component}_raw_grocery_records"] += 1
        publication_date, modified_date, fdc_id = branded_version_key(item)
        if component != "bulk" and fdc_id:
            search_source_ids[component].add(fdc_id)
        version_key = f"{publication_date}|{modified_date}|{fdc_id:012d}"
        discontinued_date = normalize_iso_date(item.get("discontinuedDate")) or ""
        marker_reason = discontinuation_marker_reason(item) or ""
        item_discontinuation_status = discontinuation_status(item)
        connection.execute(
            upsert_sql,
            (
                source_barcode.zfill(14),
                version_key,
                fdc_id,
                component,
                is_grocery,
                discontinued_date,
                int(recovered_missing_zero),
                int(not recovered_missing_zero),
                int(bool(marker_reason)),
                marker_reason,
                item_discontinuation_status,
            ),
        )
        counters["valid_gtin_version_records"] += 1

    try:
        with sqlite3.connect(index_path) as index:
            index.execute("PRAGMA journal_mode = OFF")
            index.execute("PRAGMA synchronous = OFF")
            index.execute(
                """
                CREATE TABLE latest_gtin(
                    gtin14 TEXT PRIMARY KEY,
                    version_key TEXT NOT NULL,
                    fdc_id INTEGER NOT NULL,
                    component TEXT NOT NULL,
                    is_grocery INTEGER NOT NULL,
                    discontinued_date TEXT NOT NULL,
                    recovered_missing_leading_zero INTEGER NOT NULL,
                    has_nonrecovered_version INTEGER NOT NULL,
                    known_discontinuation_marker INTEGER NOT NULL,
                    discontinuation_marker_reason TEXT NOT NULL,
                    discontinuation_status TEXT NOT NULL
                )
                """
            )
            for item in iter_json_records(bulk_path, bulk_spec):
                index_item(index, item, "bulk")
                if counters["bulk_records_scanned"] % 50_000 == 0:
                    print(
                        f"  bulk indexed {counters['bulk_records_scanned']:,}; "
                        f"raw GROCERY {counters['bulk_raw_grocery_records']:,}",
                        flush=True,
                    )

            search_payloads: list[tuple[dict[str, Any], DatasetSpec, str]] = []
            for paths, spec, component in (
                (retained_api_paths, api_spec, "retained_api"),
                (grocery_api_paths, api_spec, "grocery_api"),
                (portal_paths, portal_spec, "portal_search"),
            ):
                for path in paths:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    search_payloads.append((payload, spec, component))
                    for item in payload.get("foods") or []:
                        index_item(index, item, component)
            retained_api_source_ids = search_source_ids["retained_api"]
            grocery_api_source_ids = search_source_ids["grocery_api"]
            api_source_ids = retained_api_source_ids | grocery_api_source_ids
            portal_source_ids = search_source_ids["portal_search"]
            counters["retained_api_distinct_source_ids"] = len(
                retained_api_source_ids
            )
            counters["grocery_api_distinct_source_ids"] = len(
                grocery_api_source_ids
            )
            counters["retained_grocery_api_source_id_overlap"] = len(
                retained_api_source_ids & grocery_api_source_ids
            )
            counters["august_api_distinct_source_ids"] = len(api_source_ids)
            counters["portal_distinct_source_ids"] = len(portal_source_ids)
            counters["api_portal_source_id_overlap"] = len(
                api_source_ids & portal_source_ids
            )
            counters["portal_distinct_source_ids_new_after_api_source_id_dedup"] = len(
                portal_source_ids - api_source_ids
            )
            counters["api_portal_distinct_source_id_union"] = len(
                api_source_ids | portal_source_ids
            )
            frozen_components = (
                "bulk",
                "retained_api",
                "grocery_api",
                "portal_search",
            )
            counters["raw_gtin_length_distribution_by_component"] = {
                component: dict(
                    sorted(raw_gtin_lengths[component].items(), key=lambda pair: int(pair[0]))
                )
                for component in frozen_components
            }
            counters["recovered_missing_leading_zero_records_by_component_and_raw_length"] = {
                component: dict(
                    sorted(recovered_lengths[component].items(), key=lambda pair: int(pair[0]))
                )
                for component in frozen_components
            }
            counters["recovered_missing_leading_zero_unique_canonical_gtins_by_component"] = {
                component: len(recovered_canonical_gtins[component])
                for component in frozen_components
            }
            counters["recovered_missing_leading_zero_gtin_records"] = sum(
                sum(distribution.values()) for distribution in recovered_lengths.values()
            )
            counters["recovered_missing_leading_zero_unique_canonical_gtins"] = len(
                set().union(*recovered_canonical_gtins.values())
                if recovered_canonical_gtins
                else set()
            )
            counters["missing_leading_zero_recovery_checksum_failures"] = sum(
                counters[
                    f"{component}_missing_leading_zero_recovery_checksum_failures"
                ]
                for component in frozen_components
            )
            counters["unsupported_raw_gtin_length_records"] = sum(
                counters[f"{component}_unsupported_raw_gtin_length_records"]
                for component in frozen_components
            )
            counters["missing_raw_gtin_records"] = sum(
                counters[f"{component}_missing_raw_gtin_records"]
                for component in frozen_components
            )
            index.commit()

            unique_gtins = query_scalar(index, "SELECT COUNT(*) FROM latest_gtin")
            counters["unique_valid_gtins"] = unique_gtins
            counters["duplicate_gtin_version_records"] = (
                counters["valid_gtin_version_records"] - unique_gtins
            )
            counters["superseded_versions_excluded"] = counters[
                "duplicate_gtin_version_records"
            ]
            counters["latest_gtins_without_grocery_channel"] = query_scalar(
                index, "SELECT COUNT(*) FROM latest_gtin WHERE is_grocery = 0"
            )
            counters["known_discontinuation_marker_grocery_latest_gtins_excluded"] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin WHERE is_grocery = 1 "
                "AND known_discontinuation_marker = 1",
            )
            counters["date_discontinued_grocery_latest_gtins_excluded"] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin WHERE is_grocery = 1 "
                "AND discontinuation_marker_reason IN ('DATE', 'DATE_AND_DESCRIPTION')",
            )
            counters["description_discontinued_grocery_latest_gtins_excluded"] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin WHERE is_grocery = 1 "
                "AND discontinuation_marker_reason IN "
                "('DESCRIPTION', 'DATE_AND_DESCRIPTION')",
            )
            counters["unknown_discontinuation_status_grocery_latest_gtins"] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin WHERE is_grocery = 1 "
                "AND known_discontinuation_marker = 0 "
                "AND discontinuation_status = 'UNKNOWN'",
            )
            counters["latest_recovered_missing_leading_zero_gtins"] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin "
                "WHERE recovered_missing_leading_zero = 1",
            )
            counters[
                "recovered_missing_leading_zero_versions_that_changed_latest"
            ] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin "
                "WHERE recovered_missing_leading_zero = 1 "
                "AND has_nonrecovered_version = 1",
            )
            counters[
                "latest_recovered_missing_leading_zero_non_grocery_gtins_excluded"
            ] = query_scalar(
                index,
                "SELECT COUNT(*) FROM latest_gtin "
                "WHERE recovered_missing_leading_zero = 1 AND is_grocery = 0",
            )
            target_rows = index.execute(
                "SELECT component, fdc_id FROM latest_gtin "
                "WHERE is_grocery = 1 AND known_discontinuation_marker = 0",
            ).fetchall()

        targets: dict[str, set[int]] = defaultdict(set)
        for component, fdc_id in target_rows:
            targets[component].add(int(fdc_id))

        candidates: list[FoodRow] = []

        def materialize(item: dict[str, Any], spec: DatasetSpec, component: str) -> None:
            try:
                fdc_id = int(item.get("fdcId") or 0)
            except (TypeError, ValueError):
                return
            if fdc_id not in targets[component]:
                return
            row = normalize_food(item, spec)
            if row is None or not is_high_quality_grocery_candidate(row):
                counters["latest_records_rejected_by_quality_filter"] += 1
                return
            candidates.append(row)
            counters[f"eligible_latest_from_{component}"] += 1

        for item in iter_json_records(bulk_path, bulk_spec):
            counters["bulk_records_materialization_pass"] += 1
            materialize(item, bulk_spec, "bulk")
            if counters["bulk_records_materialization_pass"] % 100_000 == 0:
                print(
                    f"  bulk materialized pass "
                    f"{counters['bulk_records_materialization_pass']:,}; "
                    f"eligible latest {len(candidates):,}",
                    flush=True,
                )
        for payload, spec, component in search_payloads:
            for item in payload.get("foods") or []:
                materialize(item, spec, component)

        candidates.sort(key=lambda row: (stable_hash(row.source_id), row.source_id))
        counters["eligible_latest_candidates"] = len(candidates)
        counters["eligible_latest_recovered_missing_leading_zero_gtins"] = sum(
            row.gtin_recovered_missing_leading_zero for row in candidates
        )
        counters["august_api_records_scanned"] = (
            counters["retained_api_records_scanned"]
            + counters["grocery_api_records_scanned"]
        )
        counters["august_api_raw_grocery_records"] = (
            counters["retained_api_raw_grocery_records"]
            + counters["grocery_api_raw_grocery_records"]
        )
        counters["eligible_latest_from_august_api"] = (
            counters["eligible_latest_from_retained_api"]
            + counters["eligible_latest_from_grocery_api"]
        )
        return candidates, dict(counters)
    finally:
        index_path.unlink(missing_ok=True)


def collect_candidates(path: Path, spec: DatasetSpec) -> tuple[list[FoodRow], dict[str, int]]:
    candidates: list[FoodRow] = []
    counters = defaultdict(int)
    seen_source_ids: set[str] = set()
    seen_barcodes: set[str] = set()

    for item in iter_json_records(path, spec):
        counters["records_scanned"] += 1
        row = normalize_food(item, spec)
        if row is None:
            counters["records_rejected_missing_identity_energy_or_barcode"] += 1
            continue
        if row.source_id in seen_source_ids:
            counters["records_rejected_duplicate_source_id"] += 1
            continue
        if row.barcode and row.barcode in seen_barcodes:
            counters["records_rejected_duplicate_barcode"] += 1
            continue
        seen_source_ids.add(row.source_id)
        if row.barcode:
            seen_barcodes.add(row.barcode)
        candidates.append(row)
        counters["eligible_candidates"] += 1
    return candidates, dict(counters)


PLACEHOLDER_IDENTITIES = {
    "",
    "n a",
    "na",
    "none",
    "not applicable",
    "unknown",
    "unbranded",
}


def trade_channel_set(row: FoodRow) -> set[str]:
    return set((row.trade_channels or "").split("|")) - {""}


def is_high_quality_grocery_candidate(row: FoodRow) -> bool:
    """Return whether a row is suitable for the v3 supermarket expansion."""
    return (
        row.source_dataset == "branded"
        and row.barcode is not None
        and row.barcode_gtin14 is not None
        and row.serving_g is not None
        and row.serving_g > 0
        and row.energy_kcal_100g is not None
        and row.energy_kcal_100g > 0
        and "GROCERY" in trade_channel_set(row)
        and row.publication_date is not None
        and row.discontinuation_status != "KNOWN_DISCONTINUED"
        and normalize_identity(row.name_en) not in PLACEHOLDER_IDENTITIES
        and bool(re.search(r"[A-Za-z]", row.name_en))
        and normalize_identity(row.brand or "") not in PLACEHOLDER_IDENTITIES
        and normalize_identity(row.category) not in PLACEHOLDER_IDENTITIES
        and normalize_identity(row.category) != "uncategorized"
        and normalize_identity(row.market_country or "") not in PLACEHOLDER_IDENTITIES
    )


def source_id_set_sha256(rows: Sequence[FoodRow]) -> str:
    payload = "\n".join(sorted(row.source_id for row in rows)) + "\n"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def diversified_select(
    candidates: Sequence[FoodRow],
    count: int,
    used_identities: set[str],
    used_source_ids: set[str],
    used_barcodes: set[str],
) -> list[FoodRow]:
    buckets: dict[str, deque[FoodRow]] = {}
    grouped: dict[str, list[FoodRow]] = defaultdict(list)
    for row in candidates:
        grouped[normalize_identity(row.category) or "uncategorized"].append(row)
    for category, rows in grouped.items():
        rows.sort(key=lambda row: (stable_hash(row.source_id), row.source_id))
        buckets[category] = deque(rows)

    category_order = sorted(buckets, key=lambda value: (stable_hash(value), value))
    selected: list[FoodRow] = []
    while category_order and len(selected) < count:
        next_round: list[str] = []
        for category in category_order:
            bucket = buckets[category]
            accepted = False
            while bucket and not accepted:
                row = bucket.popleft()
                identity = row.identity()
                if identity in used_identities or row.source_id in used_source_ids:
                    continue
                if row.barcode and row.barcode in used_barcodes:
                    continue
                selected.append(row)
                used_identities.add(identity)
                used_source_ids.add(row.source_id)
                if row.barcode:
                    used_barcodes.add(row.barcode)
                accepted = True
            if bucket:
                next_round.append(category)
            if len(selected) >= count:
                break
        category_order = next_round
    return selected


def balanced_branded_select(
    candidates: Sequence[FoodRow],
    count: int,
    used_identities: set[str],
    used_source_ids: set[str],
    used_barcodes: set[str],
) -> list[FoodRow]:
    """Round-robin across brands, then categories within each brand."""
    grouped: dict[str, dict[str, list[FoodRow]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in candidates:
        if not is_high_quality_grocery_candidate(row):
            continue
        brand = normalize_identity(row.brand or "")
        category = normalize_identity(row.category) or "uncategorized"
        grouped[brand][category].append(row)

    buckets: dict[str, dict[str, deque[FoodRow]]] = {}
    category_orders: dict[str, deque[str]] = {}
    for brand, categories in grouped.items():
        buckets[brand] = {}
        for category, rows in categories.items():
            rows.sort(key=lambda row: (stable_hash(row.source_id), row.source_id))
            buckets[brand][category] = deque(rows)
        category_orders[brand] = deque(
            sorted(categories, key=lambda value: (stable_hash(value), value))
        )

    brand_order = sorted(buckets, key=lambda value: (stable_hash(value), value))
    selected: list[FoodRow] = []
    while brand_order and len(selected) < count:
        next_brand_round: list[str] = []
        for brand in brand_order:
            categories = category_orders[brand]
            accepted = False
            while categories and not accepted:
                category = categories.popleft()
                bucket = buckets[brand][category]
                while bucket and not accepted:
                    row = bucket.popleft()
                    identity = row.identity()
                    if identity in used_identities or row.source_id in used_source_ids:
                        continue
                    if row.barcode and row.barcode in used_barcodes:
                        continue
                    selected.append(row)
                    used_identities.add(identity)
                    used_source_ids.add(row.source_id)
                    if row.barcode:
                        used_barcodes.add(row.barcode)
                    accepted = True
                if bucket:
                    categories.append(category)
            if categories:
                next_brand_round.append(brand)
            if len(selected) >= count:
                break
        brand_order = next_brand_round
    return selected


def select_catalog(
    candidates: dict[str, list[FoodRow]],
    previous_branded_candidates: Sequence[FoodRow],
    grocery_candidates: Sequence[FoodRow],
) -> tuple[list[FoodRow], list[FoodRow], list[FoodRow]]:
    selected: list[FoodRow] = []
    used_identities: set[str] = set()
    used_source_ids: set[str] = set()
    used_barcodes: set[str] = set()

    anchor_counts: dict[str, int] = defaultdict(int)
    for dataset_key, required_names in MUST_INCLUDE_ANCHORS.items():
        for required_name in required_names:
            matches = [
                row for row in candidates[dataset_key] if row.name_en == required_name
            ]
            if not matches:
                raise ValueError(
                    f"Required {dataset_key} anchor is absent from the official source: "
                    f"{required_name!r}"
                )
            matches.sort(key=lambda row: row.source_id)
            row = matches[0]
            identity = row.identity()
            if identity in used_identities or row.source_id in used_source_ids:
                raise ValueError(f"Required anchor collides with another anchor: {required_name!r}")
            selected.append(row)
            used_identities.add(identity)
            used_source_ids.add(row.source_id)
            if row.barcode:
                used_barcodes.add(row.barcode)
            anchor_counts[dataset_key] += 1

    for key in ("foundation", "survey"):
        remaining_quota = PREVIOUS_QUOTAS[key] - anchor_counts[key]
        if remaining_quota < 0:
            raise ValueError(f"Required anchors exceed the configured {key} quota")
        rows = diversified_select(
            candidates[key],
            remaining_quota,
            used_identities,
            used_source_ids,
            used_barcodes,
        )
        selected.extend(rows)
        print(
            f"Selected {len(rows) + anchor_counts[key]:,}/{PREVIOUS_QUOTAS[key]:,} "
            f"retained {key} records "
            f"({anchor_counts[key]} required anchors)"
        )

    previous_branded = diversified_select(
        previous_branded_candidates,
        PREVIOUS_QUOTAS["branded"],
        used_identities,
        used_source_ids,
        used_barcodes,
    )
    if len(previous_branded) != PREVIOUS_QUOTAS["branded"]:
        raise ValueError(
            "Could not reproduce the previous 400-row Branded selection; "
            f"got {len(previous_branded):,}"
        )
    selected.extend(previous_branded)
    previous_rows = list(selected)
    previous_source_digest = source_id_set_sha256(previous_rows)
    previous_branded_digest = source_id_set_sha256(previous_branded)
    if previous_source_digest != PREVIOUS_SOURCE_ID_SET_SHA256:
        raise ValueError(
            "Previous 2,000-row source-id set changed: "
            f"expected {PREVIOUS_SOURCE_ID_SET_SHA256}, got {previous_source_digest}"
        )
    if previous_branded_digest != PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256:
        raise ValueError(
            "Previous 400-row Branded source-id set changed: "
            f"expected {PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256}, "
            f"got {previous_branded_digest}"
        )
    print(
        f"Retained {len(previous_rows):,}/{PREVIOUS_COUNT:,} previous records "
        f"(including {len(previous_branded):,} Branded)"
    )

    added_rows = balanced_branded_select(
        grocery_candidates,
        ADDED_BRANDED_COUNT,
        used_identities,
        used_source_ids,
        used_barcodes,
    )
    if len(added_rows) != ADDED_BRANDED_COUNT:
        eligible_count = sum(
            is_high_quality_grocery_candidate(row) for row in grocery_candidates
        )
        raise ValueError(
            f"Could not select {ADDED_BRANDED_COUNT:,} new high-quality GROCERY "
            f"Branded foods from {eligible_count:,} eligible candidates; "
            f"got {len(added_rows):,} after deduplication"
        )
    selected.extend(added_rows)
    print(
        f"Selected {len(added_rows):,}/{ADDED_BRANDED_COUNT:,} new GROCERY Branded records"
    )

    if len(selected) != EXPECTED_COUNT:
        raise ValueError(
            f"Could not select exactly {EXPECTED_COUNT:,} unique valid foods; got {len(selected):,}"
        )

    selected_counts = {
        key: sum(row.source_dataset == key for row in selected) for key in QUOTAS
    }
    if selected_counts != QUOTAS:
        raise ValueError(
            "Selected source distribution does not match configured quotas: "
            f"expected {QUOTAS!r}, got {selected_counts!r}"
        )

    selected.sort(
        key=lambda row: (
            {"foundation": 0, "survey": 1, "branded": 2}[row.source_dataset],
            normalize_identity(row.category),
            normalize_identity(row.name_en),
            row.source_id,
        )
    )
    for index, row in enumerate(selected, start=1):
        row.id = index
    return selected, previous_rows, added_rows


SCHEMA_SQL = f"""
PRAGMA foreign_keys = ON;
PRAGMA page_size = 4096;
PRAGMA user_version = {DATABASE_SCHEMA_VERSION};
CREATE TABLE dataset_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE food (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    name_en TEXT NOT NULL,
    name_zh TEXT,
    name_ms TEXT,
    category TEXT NOT NULL DEFAULT '',
    data_type TEXT NOT NULL,
    energy_kcal_100g REAL NOT NULL CHECK (energy_kcal_100g >= 0 AND energy_kcal_100g <= 1000),
    protein_g_100g REAL,
    carbohydrate_g_100g REAL,
    fat_g_100g REAL,
    fibre_g_100g REAL,
    sodium_mg_100g REAL,
    serving_g REAL,
    barcode TEXT,
    barcode_gtin14 TEXT,
    gtin_recovered_missing_leading_zero INTEGER NOT NULL DEFAULT 0
        CHECK (gtin_recovered_missing_leading_zero IN (0, 1)),
    brand TEXT,
    market_country TEXT,
    trade_channels TEXT,
    publication_date TEXT,
    modified_date TEXT,
    discontinued_date TEXT,
    discontinuation_status TEXT NOT NULL CHECK (
        discontinuation_status IN (
            'NOT_APPLICABLE', 'UNKNOWN', 'NO_KNOWN_MARKER',
            'FUTURE_DISCONTINUATION_DATE', 'KNOWN_DISCONTINUED'
        )
    ),
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A', 'B', 'C')),
    dataset_version TEXT NOT NULL,
    quality_rank INTEGER NOT NULL CHECK (quality_rank BETWEEN 1 AND 3),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE food_alias (
    id INTEGER PRIMARY KEY,
    food_id INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    UNIQUE(food_id, alias)
);
CREATE TABLE food_nutrient_provenance (
    food_id INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    nutrient_key TEXT NOT NULL,
    fdc_nutrient_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    unit_name TEXT NOT NULL,
    derivation_code TEXT,
    derivation_description TEXT,
    nutrient_source_description TEXT,
    data_points INTEGER,
    PRIMARY KEY(food_id, nutrient_key)
);
CREATE INDEX idx_food_active_quality_name ON food(active, quality_rank, name_en);
CREATE INDEX idx_food_barcode ON food(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_food_barcode_gtin14 ON food(barcode_gtin14)
    WHERE barcode_gtin14 IS NOT NULL;
CREATE INDEX idx_food_category ON food(category);
CREATE INDEX idx_food_alias_alias ON food_alias(alias);
CREATE INDEX idx_food_alias_food_id ON food_alias(food_id);
CREATE INDEX idx_food_nutrient_provenance_fdc_id
    ON food_nutrient_provenance(fdc_nutrient_id);
"""


def food_values(row: FoodRow) -> tuple[Any, ...]:
    return tuple(getattr(row, column) for column in FOOD_COLUMNS)


def write_database(
    rows: Sequence[FoodRow], destination: Path, generated_at_utc: str
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix="clinical-clarity-foods-", suffix=".sqlite", dir=destination.parent, delete=False
    ) as temporary:
        temp_path = Path(temporary.name)
    try:
        connection = sqlite3.connect(temp_path)
        try:
            connection.execute("PRAGMA journal_mode = OFF")
            connection.execute("PRAGMA synchronous = OFF")
            connection.executescript(SCHEMA_SQL)
            metadata = {
                "dataset_version": CATALOG_VERSION,
                "record_count": str(EXPECTED_COUNT),
                "previous_catalog_version": PREVIOUS_CATALOG_VERSION,
                "retained_previous_record_count": str(PREVIOUS_COUNT),
                "added_grocery_branded_record_count": str(ADDED_BRANDED_COUNT),
                "previous_source_id_set_sha256": PREVIOUS_SOURCE_ID_SET_SHA256,
                "schema_version": str(DATABASE_SCHEMA_VERSION),
                "generated_at_utc": generated_at_utc,
                "catalog_effective_date": CATALOG_EFFECTIVE_DATE,
                "catalog_name": "Clinical Clarity Food Catalogue",
                "foundation_release": DATASETS["foundation"].release,
                "survey_release": DATASETS["survey"].release,
                "branded_snapshot_date": DATASETS["branded"].release,
                "branded_bulk_release": BRANDED_BULK_SPEC.release,
                "license": "CC0-1.0",
            }
            connection.executemany(
                "INSERT INTO dataset_metadata(key, value) VALUES (?, ?)",
                sorted(metadata.items()),
            )
            placeholders = ", ".join("?" for _ in FOOD_COLUMNS)
            connection.executemany(
                f"INSERT INTO food ({', '.join(FOOD_COLUMNS)}) VALUES ({placeholders})",
                (food_values(row) for row in rows),
            )
            alias_rows: list[tuple[int, str]] = []
            for row in rows:
                for alias in sorted(set(row.aliases)):
                    alias_value = normalize_space(alias)
                    if alias_value:
                        alias_rows.append((row.id, alias_value))
            connection.executemany(
                "INSERT OR IGNORE INTO food_alias(food_id, alias) VALUES (?, ?)",
                alias_rows,
            )
            provenance_rows: list[tuple[Any, ...]] = []
            for row in rows:
                for nutrient_key, provenance in sorted(row.nutrient_provenance.items()):
                    provenance_rows.append(
                        (
                            row.id,
                            nutrient_key,
                            provenance["fdc_nutrient_id"],
                            provenance["amount"],
                            provenance["unit_name"],
                            provenance["derivation_code"],
                            provenance["derivation_description"],
                            provenance["nutrient_source_description"],
                            provenance["data_points"],
                        )
                    )
            connection.executemany(
                """
                INSERT INTO food_nutrient_provenance(
                    food_id, nutrient_key, fdc_nutrient_id, amount, unit_name,
                    derivation_code, derivation_description,
                    nutrient_source_description, data_points
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                provenance_rows,
            )
            connection.commit()
            result = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise ValueError(f"SQLite integrity check failed: {result}")
            connection.execute("VACUUM")
        finally:
            connection.close()
        os.replace(temp_path, destination)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def csv_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, float):
        return format(value, ".12g")
    return value


def write_csv(rows: Sequence[FoodRow], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(FOOD_COLUMNS)
        for row in rows:
            writer.writerow(csv_value(value) for value in food_values(row))


def write_added_foods_csv(rows: Sequence[FoodRow], destination: Path) -> None:
    columns = (
        "source_id",
        "name_en",
        "brand",
        "category",
        "market_country",
        "barcode",
        "barcode_gtin14",
        "gtin_recovered_missing_leading_zero",
        "serving_g",
        "energy_kcal_100g",
        "trade_channels",
        "publication_date",
        "modified_date",
        "discontinued_date",
        "discontinuation_status",
        "source_url",
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(columns)
        for row in sorted(rows, key=lambda value: value.source_id):
            writer.writerow(csv_value(getattr(row, column)) for column in columns)


def query_scalar(
    connection: sqlite3.Connection,
    sql: str,
    parameters: Sequence[Any] = (),
) -> int:
    return int(connection.execute(sql, parameters).fetchone()[0])


def validate_outputs(
    rows: Sequence[FoodRow],
    previous_rows: Sequence[FoodRow],
    added_rows: Sequence[FoodRow],
    expansion_stats: dict[str, Any],
    database_path: Path,
    generated_at_utc: str,
) -> dict[str, Any]:
    with sqlite3.connect(database_path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        sqlite_user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        dataset_metadata = dict(
            connection.execute(
                "SELECT key, value FROM dataset_metadata ORDER BY key"
            ).fetchall()
        )
        counts = {
            "total_records": query_scalar(connection, "SELECT COUNT(*) FROM food"),
            "catalog_enabled_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE active = 1"
            ),
            "null_energy_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE energy_kcal_100g IS NULL"
            ),
            "invalid_energy_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE energy_kcal_100g < 0 OR energy_kcal_100g > 1000",
            ),
            "duplicate_source_ids": query_scalar(
                connection,
                "SELECT COUNT(*) FROM (SELECT source_id FROM food GROUP BY source_id HAVING COUNT(*) > 1)",
            ),
            "duplicate_barcodes": query_scalar(
                connection,
                "SELECT COUNT(*) FROM (SELECT barcode FROM food WHERE barcode IS NOT NULL "
                "GROUP BY barcode HAVING COUNT(*) > 1)",
            ),
            "duplicate_gtin14": query_scalar(
                connection,
                "SELECT COUNT(*) FROM (SELECT barcode_gtin14 FROM food "
                "WHERE barcode_gtin14 IS NOT NULL GROUP BY barcode_gtin14 HAVING COUNT(*) > 1)",
            ),
            "barcode_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE barcode IS NOT NULL"
            ),
            "serving_size_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE serving_g IS NOT NULL"
            ),
            "branded_missing_or_nonpositive_serving_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE quality_grade = 'B' "
                "AND (serving_g IS NULL OR serving_g <= 0)",
            ),
            "branded_nonpositive_energy_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE quality_grade = 'B' "
                "AND energy_kcal_100g <= 0",
            ),
            "branded_missing_barcode_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE quality_grade = 'B' "
                "AND (barcode IS NULL OR barcode_gtin14 IS NULL)",
            ),
            "known_discontinuation_marker_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food "
                "WHERE discontinuation_status = 'KNOWN_DISCONTINUED'",
            ),
            "recovered_missing_leading_zero_gtin_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food "
                "WHERE gtin_recovered_missing_leading_zero = 1",
            ),
            "nonpositive_energy_edible_oil_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE LOWER(category) = 'oils edible' "
                "AND energy_kcal_100g <= 0",
            ),
            "alias_records": query_scalar(connection, "SELECT COUNT(*) FROM food_alias"),
            "nutrient_provenance_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food_nutrient_provenance"
            ),
            "foods_without_energy_provenance": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE NOT EXISTS ("
                "SELECT 1 FROM food_nutrient_provenance p "
                "WHERE p.food_id = food.id AND p.nutrient_key = 'energy_kcal_100g')",
            ),
            "missing_source_metadata_records": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE source_id = '' OR source_name = '' "
                "OR source_url = '' OR dataset_version = ''",
            ),
            "uncategorized_records": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE category = 'Uncategorized'"
            ),
            "distinct_categories": query_scalar(
                connection, "SELECT COUNT(DISTINCT category) FROM food"
            ),
            "unexpected_quality_grade_mappings": query_scalar(
                connection,
                "SELECT COUNT(*) FROM food WHERE NOT ("
                "(data_type = 'Foundation' AND quality_grade = 'A') OR "
                "(data_type = 'Branded' AND quality_grade = 'B') OR "
                "(data_type = 'Survey (FNDDS)' AND quality_grade = 'C'))",
            ),
            "dataset_metadata_records": query_scalar(
                connection, "SELECT COUNT(*) FROM dataset_metadata"
            ),
            "invented_chinese_names": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE name_zh IS NOT NULL"
            ),
            "invented_malay_names": query_scalar(
                connection, "SELECT COUNT(*) FROM food WHERE name_ms IS NOT NULL"
            ),
        }
        source_distribution = dict(
            connection.execute(
                "SELECT data_type, COUNT(*) FROM food GROUP BY data_type ORDER BY data_type"
            ).fetchall()
        )
        grade_distribution = dict(
            connection.execute(
                "SELECT quality_grade, COUNT(*) FROM food GROUP BY quality_grade ORDER BY quality_grade"
            ).fetchall()
        )
        barcode_length_distribution = {
            str(length): count
            for length, count in connection.execute(
                "SELECT LENGTH(barcode), COUNT(*) FROM food WHERE barcode IS NOT NULL "
                "GROUP BY LENGTH(barcode) ORDER BY LENGTH(barcode)"
            ).fetchall()
        }
        brand_distribution = dict(
            connection.execute(
                "SELECT COALESCE(brand, 'Unknown'), COUNT(*) FROM food "
                "WHERE data_type = 'Branded' GROUP BY COALESCE(brand, 'Unknown') "
                "ORDER BY COUNT(*) DESC, COALESCE(brand, 'Unknown')"
            ).fetchall()
        )
        market_country_distribution = dict(
            connection.execute(
                "SELECT COALESCE(market_country, 'Unknown'), COUNT(*) FROM food "
                "WHERE data_type = 'Branded' GROUP BY COALESCE(market_country, 'Unknown') "
                "ORDER BY COUNT(*) DESC, COALESCE(market_country, 'Unknown')"
            ).fetchall()
        )
        category_distribution = dict(
            connection.execute(
                "SELECT category, COUNT(*) FROM food GROUP BY category "
                "ORDER BY COUNT(*) DESC, category"
            ).fetchall()
        )
        branded_category_distribution = dict(
            connection.execute(
                "SELECT category, COUNT(*) FROM food WHERE data_type = 'Branded' "
                "GROUP BY category ORDER BY COUNT(*) DESC, category"
            ).fetchall()
        )
        nutrient_completeness = {
            column: query_scalar(connection, f"SELECT COUNT(*) FROM food WHERE {column} IS NOT NULL")
            for column in (
                "protein_g_100g",
                "carbohydrate_g_100g",
                "fat_g_100g",
                "fibre_g_100g",
                "sodium_mg_100g",
            )
        }
        duplicate_row_identities = sum(
            1
            for count in Counter(row.identity() for row in rows).values()
            if count > 1
        )
        invalid_barcode_checksums = sum(
            1 for row in rows if row.barcode and not gtin_checksum_is_valid(row.barcode)
        )
        invalid_gtin14_checksums = sum(
            1
            for row in rows
            if row.barcode_gtin14
            and (len(row.barcode_gtin14) != 14 or not gtin_checksum_is_valid(row.barcode_gtin14))
        )
        invalid_barcode_mappings = sum(
            1
            for row in rows
            if row.barcode and row.barcode_gtin14
            and row.barcode.zfill(14) != row.barcode_gtin14
        )
        non_official_source_urls = sum(
            1
            for row in rows
            if not row.source_url.startswith("https://fdc.nal.usda.gov/")
        )
        anchor_presence = {
            name: sum(
                1
                for row in rows
                if row.source_dataset == dataset_key and row.name_en == name
            )
            for dataset_key, names in MUST_INCLUDE_ANCHORS.items()
            for name in names
        }

    current_source_ids = {row.source_id for row in rows}
    previous_source_ids = {row.source_id for row in previous_rows}
    added_source_ids = {row.source_id for row in added_rows}
    retained_previous_count = len(current_source_ids & previous_source_ids)
    removed_previous_count = len(previous_source_ids - current_source_ids)
    unexpected_added_source_ids = (
        current_source_ids - previous_source_ids - added_source_ids
    )
    previous_source_digest = source_id_set_sha256(previous_rows)
    previous_branded_rows = [
        row for row in previous_rows if row.source_dataset == "branded"
    ]
    previous_known_discontinued_rows = [
        row
        for row in previous_rows
        if row.discontinuation_status == "KNOWN_DISCONTINUED"
    ]
    all_known_discontinued_source_ids = {
        row.source_id
        for row in rows
        if row.discontinuation_status == "KNOWN_DISCONTINUED"
    }
    previous_branded_digest = source_id_set_sha256(previous_branded_rows)
    new_grocery_channel_count = sum(
        "GROCERY" in trade_channel_set(row) for row in added_rows
    )
    new_high_quality_count = sum(
        is_high_quality_grocery_candidate(row) for row in added_rows
    )
    new_publication_date_count = sum(
        row.publication_date is not None for row in added_rows
    )
    new_known_discontinuation_marker_count = sum(
        row.discontinuation_status == "KNOWN_DISCONTINUED" for row in added_rows
    )
    new_description_discontinued_token_count = sum(
        discontinuation_marker_reason({"description": row.name_en})
        in {"DESCRIPTION", "DATE_AND_DESCRIPTION"}
        for row in added_rows
    )
    new_discontinuation_status_distribution = dict(
        sorted(Counter(row.discontinuation_status for row in added_rows).items())
    )
    new_recovered_missing_leading_zero_count = sum(
        row.gtin_recovered_missing_leading_zero for row in added_rows
    )
    new_brand_distribution = dict(
        sorted(
            Counter(row.brand or "Unknown" for row in added_rows).items(),
            key=lambda pair: (-pair[1], pair[0]),
        )
    )
    new_category_distribution = dict(
        sorted(
            Counter(row.category for row in added_rows).items(),
            key=lambda pair: (-pair[1], pair[0]),
        )
    )
    new_market_country_distribution = dict(
        sorted(
            Counter(row.market_country or "Unknown" for row in added_rows).items(),
            key=lambda pair: (-pair[1], pair[0]),
        )
    )
    branded_trade_channel_distribution = dict(
        sorted(
            Counter(
                channel
                for row in rows
                if row.source_dataset == "branded"
                for channel in trade_channel_set(row)
            ).items(),
            key=lambda pair: (-pair[1], pair[0]),
        )
    )

    required = {
        "sqlite_integrity": integrity == "ok",
        "exactly_5000_records": counts["total_records"] == EXPECTED_COUNT,
        "retained_previous_2000_records": retained_previous_count == PREVIOUS_COUNT,
        "removed_previous_records_is_zero": removed_previous_count == 0,
        "previous_source_id_set_matches_v2": (
            previous_source_digest == PREVIOUS_SOURCE_ID_SET_SHA256
        ),
        "previous_branded_source_id_set_matches_v2": (
            previous_branded_digest == PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256
        ),
        "exactly_3000_new_branded_records": (
            len(added_rows) == ADDED_BRANDED_COUNT
            and len(added_source_ids) == ADDED_BRANDED_COUNT
            and not unexpected_added_source_ids
            and all(row.source_dataset == "branded" for row in added_rows)
        ),
        "new_3000_grocery_channel_count": (
            new_grocery_channel_count == ADDED_BRANDED_COUNT
        ),
        "new_3000_pass_high_quality_filter": (
            new_high_quality_count == ADDED_BRANDED_COUNT
        ),
        "new_3000_have_publication_date_evidence": (
            new_publication_date_count == ADDED_BRANDED_COUNT
        ),
        "new_3000_have_no_known_discontinuation_marker": (
            new_known_discontinuation_marker_count == 0
        ),
        "new_3000_discontinuation_status_is_explicit": (
            sum(new_discontinuation_status_distribution.values())
            == ADDED_BRANDED_COUNT
            and set(new_discontinuation_status_distribution)
            <= {
                "UNKNOWN",
                "NO_KNOWN_MARKER",
                "FUTURE_DISCONTINUATION_DATE",
            }
        ),
        "new_3000_names_have_no_discontinued_token": (
            new_description_discontinued_token_count == 0
        ),
        "known_discontinuation_markers_are_exactly_retained_v2_legacy_set": (
            all_known_discontinued_source_ids
            == RETAINED_V2_KNOWN_DISCONTINUED_SOURCE_IDS
            and not (
                all_known_discontinued_source_ids
                & {row.source_id for row in added_rows}
            )
        ),
        "duplicate_gtin_versions_resolved_to_one_latest": (
            expansion_stats.get("duplicate_gtin_version_records", 0)
            == expansion_stats.get("superseded_versions_excluded", 0)
        ),
        "missing_leading_zero_gtins_use_strict_7_or_11_digit_recovery": (
            valid_barcode("39400015048") == "039400015048"
            and valid_barcode("39400015049") is None
            and valid_barcode("123456") is None
            and valid_barcode("3940001504") is None
        ),
        "known_newer_non_grocery_gtin_suppresses_older_grocery_version": (
            not any(
                row.barcode_gtin14 == "00039400015048" for row in added_rows
            )
        ),
        "all_catalog_rows_enabled": (
            counts["catalog_enabled_records"] == EXPECTED_COUNT
        ),
        "no_null_energy": counts["null_energy_records"] == 0,
        "no_invalid_energy": counts["invalid_energy_records"] == 0,
        "no_duplicate_source_ids": counts["duplicate_source_ids"] == 0,
        "no_duplicate_barcodes": counts["duplicate_barcodes"] == 0,
        "no_duplicate_gtin14": counts["duplicate_gtin14"] == 0,
        "no_duplicate_row_identities": duplicate_row_identities == 0,
        "all_barcodes_have_valid_gtin_check_digit": invalid_barcode_checksums == 0,
        "all_canonical_gtin14_values_valid": invalid_gtin14_checksums == 0,
        "scanner_barcodes_map_to_canonical_gtin14": invalid_barcode_mappings == 0,
        "all_nutrients_have_official_provenance": (
            counts["foods_without_energy_provenance"] == 0
            and counts["nutrient_provenance_records"]
            == sum(1 for row in rows for value in row.nutrient_provenance.values())
        ),
        "all_source_metadata_present": counts["missing_source_metadata_records"] == 0,
        "all_record_links_are_official_fdc": non_official_source_urls == 0,
        "quality_grades_match_source_types": (
            counts["unexpected_quality_grade_mappings"] == 0
        ),
        "source_distribution_matches_configured_quotas": source_distribution
        == {
            "Foundation": QUOTAS["foundation"],
            "Survey (FNDDS)": QUOTAS["survey"],
            "Branded": QUOTAS["branded"],
        },
        "all_must_include_anchors_present_once": all(
            count == 1 for count in anchor_presence.values()
        ),
        "dataset_metadata_matches_catalog": (
            dataset_metadata.get("dataset_version") == CATALOG_VERSION
            and dataset_metadata.get("record_count") == str(EXPECTED_COUNT)
            and dataset_metadata.get("previous_catalog_version")
            == PREVIOUS_CATALOG_VERSION
            and dataset_metadata.get("retained_previous_record_count")
            == str(PREVIOUS_COUNT)
            and dataset_metadata.get("added_grocery_branded_record_count")
            == str(ADDED_BRANDED_COUNT)
            and dataset_metadata.get("previous_source_id_set_sha256")
            == PREVIOUS_SOURCE_ID_SET_SHA256
            and dataset_metadata.get("schema_version") == str(DATABASE_SCHEMA_VERSION)
            and dataset_metadata.get("generated_at_utc") == generated_at_utc
            and dataset_metadata.get("catalog_effective_date") == CATALOG_EFFECTIVE_DATE
            and dataset_metadata.get("branded_bulk_release")
            == BRANDED_BULK_SPEC.release
            and sqlite_user_version == DATABASE_SCHEMA_VERSION
        ),
        "no_invented_translations": (
            counts["invented_chinese_names"] == 0 and counts["invented_malay_names"] == 0
        ),
        "all_3400_branded_records_have_barcodes": (
            counts["branded_missing_barcode_records"] == 0
            and counts["barcode_records"] == QUOTAS["branded"]
        ),
        "all_branded_barcodes_have_positive_serving_grams": (
            counts["branded_missing_or_nonpositive_serving_records"] == 0
        ),
        "all_branded_records_have_positive_energy": (
            counts["branded_nonpositive_energy_records"] == 0
        ),
        "no_nonpositive_energy_edible_oils": (
            counts["nonpositive_energy_edible_oil_records"] == 0
        ),
    }
    return {
        "report_schema_version": 2,
        "dataset_version": CATALOG_VERSION,
        "database_schema_version": DATABASE_SCHEMA_VERSION,
        "sqlite_user_version": sqlite_user_version,
        "dataset_metadata": dataset_metadata,
        "generated_at_utc": generated_at_utc,
        "status": "passed" if all(required.values()) else "failed",
        "required_checks": required,
        "sqlite_integrity_check": integrity,
        "counts": counts,
        "duplicate_row_identities": duplicate_row_identities,
        "invalid_barcode_checksums": invalid_barcode_checksums,
        "invalid_gtin14_checksums": invalid_gtin14_checksums,
        "invalid_barcode_mappings": invalid_barcode_mappings,
        "non_official_source_urls": non_official_source_urls,
        "must_include_anchor_presence": anchor_presence,
        "retention": {
            "previous_catalog_version": PREVIOUS_CATALOG_VERSION,
            "expected_previous_records": PREVIOUS_COUNT,
            "retained_previous_records": retained_previous_count,
            "removed_previous_records": removed_previous_count,
            "retention_rate_percent": round(
                retained_previous_count / PREVIOUS_COUNT * 100, 2
            ),
            "expected_source_id_set_sha256": PREVIOUS_SOURCE_ID_SET_SHA256,
            "actual_source_id_set_sha256": previous_source_digest,
            "expected_branded_source_id_set_sha256": (
                PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256
            ),
            "actual_branded_source_id_set_sha256": previous_branded_digest,
            "known_discontinuation_marker_records_preserved_from_v2": len(
                previous_known_discontinued_rows
            ),
            "known_discontinuation_marker_records_preserved_from_v2_detail": [
                {
                    "source_id": row.source_id,
                    "discontinued_date": row.discontinued_date,
                    "discontinuation_status": row.discontinuation_status,
                    "scope": "retained-v2-legacy-exception",
                }
                for row in sorted(
                    previous_known_discontinued_rows,
                    key=lambda value: value.source_id,
                )
            ],
        },
        "grocery_expansion": {
            "expected_new_records": ADDED_BRANDED_COUNT,
            "actual_new_records": len(added_rows),
            "unique_new_source_ids": len(added_source_ids),
            "grocery_channel_records": new_grocery_channel_count,
            "high_quality_filter_records": new_high_quality_count,
            "publication_date_evidence_records": new_publication_date_count,
            "known_discontinuation_marker_records": (
                new_known_discontinuation_marker_count
            ),
            "description_discontinued_token_records": (
                new_description_discontinued_token_count
            ),
            "discontinuation_status_distribution": (
                new_discontinuation_status_distribution
            ),
            "selected_recovered_missing_leading_zero_gtin_records": (
                new_recovered_missing_leading_zero_count
            ),
            "distinct_brands": len(new_brand_distribution),
            "distinct_categories": len(new_category_distribution),
            "brand_distribution": new_brand_distribution,
            "category_distribution": new_category_distribution,
            "market_country_distribution": new_market_country_distribution,
            "latest_version_resolution": expansion_stats,
        },
        "barcode_coverage_percent": round(counts["barcode_records"] / EXPECTED_COUNT * 100, 2),
        "barcode_length_distribution": barcode_length_distribution,
        "serving_size_coverage_percent": round(
            counts["serving_size_records"] / EXPECTED_COUNT * 100, 2
        ),
        "source_distribution": source_distribution,
        "quality_grade_distribution": grade_distribution,
        "branded_distinct_brands": len(brand_distribution),
        "branded_distinct_categories": len(branded_category_distribution),
        "branded_largest_brand_share_percent": round(
            max(brand_distribution.values(), default=0) / QUOTAS["branded"] * 100,
            2,
        ),
        "branded_brand_distribution": brand_distribution,
        "category_distribution": category_distribution,
        "branded_category_distribution": branded_category_distribution,
        "branded_market_country_distribution": market_country_distribution,
        "branded_trade_channel_distribution": branded_trade_channel_distribution,
        "nutrient_non_null_counts": nutrient_completeness,
        "quality_grade_definitions": {
            "A": "USDA Foundation analytical food profile",
            "B": "USDA-published branded manufacturer-label profile",
            "C": "USDA FNDDS survey or standardized-recipe profile",
        },
        "limitations": [
            "A food nutrient profile is per 100 g and does not by itself determine the portion visible in a photo.",
            "Branded values originate from manufacturer label submissions published by USDA, not independent laboratory retesting by this project.",
            "FNDDS represents US survey foods and is not a Malaysia-specific restaurant database.",
            "Chinese and Malay names are intentionally null; a reviewed localization source is required.",
            "MyFCD data are not redistributed because commercial redistribution permission has not been obtained.",
            "The retained v2 Branded subset and v3 GROCERY expansion reflect USDA-published market-country labels and are not proof of Malaysian shelf availability.",
            "The expansion is balanced by deterministic brand and category round-robin, but remains constrained by the official query result pool.",
            "The FoodData Central /portal-data/external/search endpoint is an internal website-search backend, not a promised stable public API; the frozen response artifacts are retained for offline reproducibility.",
            "Latest-version resolution means latest only among the frozen bulk, API, and website-search artifacts listed in the manifest; it does not claim live or exhaustive USDA-wide latest status.",
            "A GROCERY search result and an UNKNOWN discontinuation_status do not prove that a product is active, currently manufactured, or available in a store; they mean only that USDA published the GROCERY channel and the frozen row has no known discontinuation marker.",
            "The food.active database flag means enabled in this offline catalogue; it is not a claim that a branded product remains commercially active.",
            "Three retained v2 Branded rows have known effective discontinuedDate markers and remain only because v3 guarantees exact retention of all prior 2,000 source records; they are explicitly flagged and are not part of the 3,000-row GROCERY expansion.",
        ],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def build_manifest(
    rows: Sequence[FoodRow],
    source_artifacts: dict[str, list[Path]],
    scan_stats: dict[str, Any],
    generated_at_utc: str,
) -> dict[str, Any]:
    dataset_counts = {
        key: sum(1 for row in rows if row.source_dataset == key) for key in DATASETS
    }
    source_entries = []
    for key, spec in DATASETS.items():
        artifacts = source_artifacts[key]
        artifact_records = [
            {
                "filename": artifact.name,
                "bytes": artifact.stat().st_size,
                "sha256": sha256_file(artifact),
            }
            for artifact in artifacts
        ]
        source_entry = {
                "key": key,
                "name": spec.label,
                "release": spec.release,
                "download_url": spec.url if key != "branded" else None,
                "retrieval_method": (
                    "official FoodData Central API and website-search snapshots plus "
                    "official bulk JSON ZIP"
                    if key == "branded"
                    else "official FoodData Central bulk ZIP download"
                ),
                "source_artifacts": artifact_records,
                "records_selected": dataset_counts[key],
                "scan_statistics": scan_stats[key],
                "quality_grade": spec.quality_grade,
            }
        if key == "branded":
            source_entry["source_components"] = {
                "retained_v2_base": {
                    "role": "retained-v2-source-fixture",
                    "source": "official FoodData Central API GET snapshot",
                    "release": DATASETS["branded"].release,
                    "acquisition_url": (
                        f"{BRANDED_API_ENDPOINT}?dataType=Branded&pageSize="
                        f"{BRANDED_API_PAGE_SIZE}&sortBy=publishedDate&sortOrder=desc"
                    ),
                    "pages": PREVIOUS_BRANDED_API_PAGE_COUNT,
                    "purpose": "reproduce and retain the previous 400 Branded rows",
                    "artifacts": [
                        record
                        for record in artifact_records
                        if record["filename"].startswith("branded-api-")
                    ],
                },
                "v3_supermarket_expansion": {
                    "role": "v3-expansion-bulk-candidate-source",
                    "source": "official FoodData Central Branded bulk JSON ZIP",
                    "release": BRANDED_BULK_SPEC.release,
                    "acquisition_url": BRANDED_BULK_SPEC.url,
                    "raw_filter": "tradeChannels contains GROCERY",
                    "purpose": (
                        "select 3,000 additional rows with row-level GROCERY verification"
                    ),
                    "artifacts": [
                        record
                        for record in artifact_records
                        if record["filename"] == BRANDED_BULK_SPEC.cache_name
                    ],
                },
                "v3_grocery_api_bridge": {
                    "role": "v3-expansion-newer-api-candidate-source",
                    "source": "official FoodData Central API GROCERY query snapshot",
                    "release": DATASETS["branded"].release,
                    "acquisition_url": (
                        f"{BRANDED_API_ENDPOINT}?query=tradeChannels%3AGROCERY&"
                        f"dataType=Branded&pageSize={BRANDED_API_PAGE_SIZE}&"
                        "sortBy=publishedDate&sortOrder=desc"
                    ),
                    "pages": BRANDED_GROCERY_API_PAGE_COUNT,
                    "raw_filter": "tradeChannels contains GROCERY",
                    "discontinuation_evidence": (
                        "Search rows may omit discontinuedDate; missing evidence is "
                        "classified UNKNOWN, never active."
                    ),
                    "purpose": (
                        "supplement the April bulk with newer official rows before "
                        "cross-source latest-version resolution"
                    ),
                    "artifacts": [
                        record
                        for record in artifact_records
                        if record["filename"].startswith("branded-grocery-api-")
                    ],
                },
                "v3_official_portal_search": {
                    "role": "v3-expansion-independent-website-search-candidate-source",
                    "source": "official FoodData Central website search snapshot",
                    "release": BRANDED_PORTAL_SPEC.release,
                    "acquisition_url": BRANDED_PORTAL_ENDPOINT,
                    "method": "POST application/json",
                    "query": {
                        "includeDataTypes.Branded": True,
                        "includeTradeChannels.GROCERY": True,
                        "sortField": "publishedDate",
                        "sortDirection": "desc",
                    },
                    "page_size": BRANDED_PORTAL_PAGE_SIZE,
                    "page_range": [
                        BRANDED_PORTAL_PAGE_START,
                        BRANDED_PORTAL_PAGE_END,
                    ],
                    "discontinuation_evidence": (
                        "Website-search rows may omit discontinuedDate; missing evidence "
                        "is classified UNKNOWN, never active."
                    ),
                    "purpose": (
                        "independent frozen official GROCERY website-search result set used "
                        "to broaden candidate coverage; it is not treated as a continuation "
                        "of API pagination and the endpoint is not represented as a stable "
                        "public API"
                    ),
                    "artifacts": [
                        record
                        for record in artifact_records
                        if record["filename"].startswith(
                            "branded-portal-grocery-"
                        )
                    ],
                },
            }
        source_entries.append(source_entry)
    return {
        "manifest_schema_version": 2,
        "catalog_name": "Clinical Clarity Food Catalogue",
        "dataset_version": CATALOG_VERSION,
        "database_schema_version": DATABASE_SCHEMA_VERSION,
        "catalog_effective_date": CATALOG_EFFECTIVE_DATE,
        "generated_at_utc": generated_at_utc,
        "record_count": len(rows),
        "pipeline": {
            "script": str(Path(__file__).relative_to(PROJECT_DIR)),
            "script_sha256": sha256_file(Path(__file__)),
            "unit_test": str(
                (PIPELINE_DIR / "test_build_food_database.py").relative_to(PROJECT_DIR)
            ),
            "unit_test_sha256": sha256_file(
                PIPELINE_DIR / "test_build_food_database.py"
            ),
            "requirements": str((PIPELINE_DIR / "requirements.txt").relative_to(PROJECT_DIR)),
            "requirements_sha256": sha256_file(PIPELINE_DIR / "requirements.txt"),
        },
        "selection_policy": {
            "target_quotas": QUOTAS,
            "previous_catalog": {
                "version": PREVIOUS_CATALOG_VERSION,
                "record_count": PREVIOUS_COUNT,
                "source_id_set_sha256": PREVIOUS_SOURCE_ID_SET_SHA256,
                "branded_source_id_set_sha256": (
                    PREVIOUS_BRANDED_SOURCE_ID_SET_SHA256
                ),
                "retention_policy": "retain all 2,000 previous source ids",
                "discontinuation_compatibility_note": (
                    "Known discontinuation markers on retained v2 rows are persisted and "
                    "reported; the no-known-marker gate applies to the 3,000 new rows."
                ),
            },
            "grocery_expansion_count": ADDED_BRANDED_COUNT,
            "algorithm": (
                "First reproduce the v2 Foundation, Survey, and 400-row Branded selection; "
                "then select 3,000 additional official Branded rows by deterministic brand "
                "round-robin and category round-robin within each brand. Rows within buckets "
                "are sorted by SHA-256 of USDA source id. Before selection, duplicate GTIN "
                "versions across all frozen, manifested USDA sources are resolved to the "
                "latest among those sources by publication date, modified date, and FDC id; "
                "a latest version with an effective discontinuedDate or an independent "
                "DISCONTINUED description token excludes that GTIN without falling back. "
                "Duplicate "
                "source ids, barcodes, and "
                "normalized name-brand identities are excluded"
            ),
            "required_energy": "Official USDA energy value in kcal/100 g",
            "branded_requirement": (
                "Valid GTIN-8, UPC-A, EAN-13, or GTIN-14 with a correct check digit; "
                "positive labelled serving grams and energy; edible oils with nonpositive "
                "energy excluded"
            ),
            "new_row_requirement": (
                "Every additional row must have raw USDA tradeChannels containing GROCERY, "
                "a non-placeholder brand/category/market country, a valid barcode, positive "
                "serving grams and energy, and no known discontinuation marker"
            ),
            "discontinuation_evidence_policy": (
                "Exclude a GTIN when its latest frozen version has discontinuedDate on or "
                "before catalog_effective_date or an independent DISCONTINUED token in its "
                "description. A missing discontinuedDate field is persisted as UNKNOWN; "
                "UNKNOWN is not evidence of active manufacture or current shelf availability."
            ),
            "barcode_storage": (
                "barcode stores the scanner-compatible UPC-A/EAN-13/GTIN-14 value; "
                "barcode_gtin14 preserves the canonical 14-digit representation"
            ),
            "source_gtin_normalization": (
                "Accept check-digit-valid raw GTIN-8, UPC-A, EAN-13, and GTIN-14. "
                "If and only if the raw digit length is 7 or 11, attempt exactly one "
                "leading-zero recovery to GTIN-8 or UPC-A and require a valid check "
                "digit; reject every other unsupported length rather than padding it."
            ),
            "missing_value_policy": "NULL; never replaced with zero or an AI estimate",
            "translation_policy": "No Chinese or Malay translations generated",
            "must_include_anchors": MUST_INCLUDE_ANCHORS,
        },
        "license": {
            "name": "CC0 1.0 Universal public-domain dedication",
            "url": CC0_URL,
            "fooddata_central_documentation": FDC_DOCUMENTATION_URL,
            "fooddata_central_downloads": FDC_DOWNLOADS_URL,
        },
        "sources": source_entries,
        "excluded_sources": {
            "MyFCD": (
                "Not included because commercial redistribution permission has not been obtained."
            )
        },
        "outputs": {
            "database": {
                "path": str(DATABASE_PATH.relative_to(PROJECT_DIR)),
                "bytes": DATABASE_PATH.stat().st_size,
                "sha256": sha256_file(DATABASE_PATH),
            },
            "csv": {
                "path": str(CSV_PATH.relative_to(PROJECT_DIR)),
                "bytes": CSV_PATH.stat().st_size,
                "sha256": sha256_file(CSV_PATH),
            },
            "added_supermarket_foods": {
                "path": str(DIFF_PATH.relative_to(PROJECT_DIR)),
                "records": ADDED_BRANDED_COUNT,
                "bytes": DIFF_PATH.stat().st_size,
                "sha256": sha256_file(DIFF_PATH),
            },
        },
    }


def write_sha256s(paths: Iterable[Path], destination: Path) -> None:
    lines = [
        f"{sha256_file(path)}  {path.relative_to(PROJECT_DIR)}"
        for path in sorted(paths, key=lambda value: str(value))
    ]
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Do not download; fail if a required source ZIP or API page is not cached",
    )
    parser.add_argument(
        "--fdc-api-key",
        default=os.environ.get("FDC_API_KEY", "DEMO_KEY"),
        help="USDA FoodData Central API key (default: FDC_API_KEY or USDA DEMO_KEY)",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if sum(QUOTAS.values()) != EXPECTED_COUNT:
        raise ValueError(f"Configured quotas must sum to exactly {EXPECTED_COUNT:,}")

    source_artifacts: dict[str, list[Path]] = {}
    candidates: dict[str, list[FoodRow]] = {}
    scan_stats: dict[str, Any] = {}
    for key in ("foundation", "survey"):
        spec = DATASETS[key]
        archive = download(spec, offline=args.offline)
        source_artifacts[key] = [archive]
        print(f"Parsing {spec.label}")
        candidates[key], scan_stats[key] = collect_candidates(archive, spec)
        print(
            f"  scanned {scan_stats[key].get('records_scanned', 0):,}; "
            f"eligible {len(candidates[key]):,}"
        )

    branded_spec = DATASETS["branded"]
    previous_branded_pages = fetch_branded_api(
        args.fdc_api_key, offline=args.offline, grocery_only=False
    )
    grocery_api_pages = fetch_branded_api(
        args.fdc_api_key, offline=args.offline, grocery_only=True
    )
    portal_pages = fetch_branded_portal(offline=args.offline)
    branded_bulk = download(BRANDED_BULK_SPEC, offline=args.offline)
    source_artifacts["branded"] = (
        previous_branded_pages + grocery_api_pages + portal_pages + [branded_bulk]
    )
    print(f"Parsing retained-v2 {branded_spec.label}")
    previous_branded_candidates, previous_branded_stats = collect_branded_api(
        previous_branded_pages, branded_spec
    )
    print(f"Parsing GROCERY rows from {BRANDED_BULK_SPEC.label}")
    grocery_candidates, grocery_stats = collect_branded_expansion(
        branded_bulk,
        previous_branded_pages,
        grocery_api_pages,
        portal_pages,
        BRANDED_BULK_SPEC,
        branded_spec,
        BRANDED_PORTAL_SPEC,
    )
    scan_stats["branded"] = {
        "retained_v2_base": previous_branded_stats,
        "grocery_expansion": grocery_stats,
    }
    print(
        f"  retained-v2 pool eligible {len(previous_branded_candidates):,}; "
        f"GROCERY pool eligible {len(grocery_candidates):,}"
    )

    rows, previous_rows, added_rows = select_catalog(
        candidates,
        previous_branded_candidates,
        grocery_candidates,
    )
    generated_at_utc = utc_now()
    write_database(rows, DATABASE_PATH, generated_at_utc)
    write_csv(rows, CSV_PATH)
    write_added_foods_csv(added_rows, DIFF_PATH)
    quality = validate_outputs(
        rows,
        previous_rows,
        added_rows,
        grocery_stats,
        DATABASE_PATH,
        generated_at_utc,
    )
    write_json(QUALITY_PATH, quality)
    manifest = build_manifest(rows, source_artifacts, scan_stats, generated_at_utc)
    if manifest["generated_at_utc"] != quality["dataset_metadata"]["generated_at_utc"]:
        raise ValueError("Manifest and SQLite generated_at_utc values differ")
    write_json(MANIFEST_PATH, manifest)
    write_sha256s(
        (DATABASE_PATH, CSV_PATH, DIFF_PATH, MANIFEST_PATH, QUALITY_PATH), SHA_PATH
    )

    print(json.dumps(quality, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"Database: {DATABASE_PATH} ({DATABASE_PATH.stat().st_size:,} bytes)")
    print(f"CSV:      {CSV_PATH} ({CSV_PATH.stat().st_size:,} bytes)")
    print(f"Added:    {DIFF_PATH} ({DIFF_PATH.stat().st_size:,} bytes)")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"Quality:  {QUALITY_PATH}")
    print(f"SHA-256:  {SHA_PATH}")
    if quality["status"] != "passed":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
