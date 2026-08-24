from __future__ import annotations

import difflib
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


class CatalogError(RuntimeError):
    pass


@dataclass(frozen=True)
class CatalogFood:
    id: int
    source_id: str
    name: str
    energy_kcal_100g: float
    source_name: str
    quality_grade: str
    dataset_version: str
    quality_rank: int


@dataclass(frozen=True)
class CatalogMatch:
    food: CatalogFood
    score: float
    basis: str


def normalize_food_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def _name_score(candidate: str, canonical: str) -> float:
    if candidate == canonical:
        return 1.0
    if not candidate or not canonical:
        return 0.0
    candidate_tokens = set(candidate.split())
    canonical_tokens = set(canonical.split())
    union = candidate_tokens | canonical_tokens
    jaccard = len(candidate_tokens & canonical_tokens) / len(union) if union else 0.0
    sequence = difflib.SequenceMatcher(None, candidate, canonical, autojunk=False).ratio()
    containment = 0.90 if candidate in canonical or canonical in candidate else 0.0
    return max(containment, sequence * 0.60 + jaccard * 0.40)


class SqliteFoodCatalog:
    REQUIRED_COLUMNS = {
        "id",
        "source_id",
        "name_en",
        "energy_kcal_100g",
        "source_name",
        "quality_grade",
        "dataset_version",
        "quality_rank",
        "active",
    }

    def __init__(
        self,
        path: Path,
        minimum_match_score: float = 0.68,
        minimum_match_gap: float = 0.08,
    ) -> None:
        self.path = path.resolve()
        self.minimum_match_score = minimum_match_score
        self.minimum_match_gap = minimum_match_gap
        self._foods: Tuple[CatalogFood, ...]
        self._exact_index: Dict[str, CatalogFood]
        self._normalized_names: Dict[int, str]
        self._dataset_version: str
        self._source_label: str
        self._load()

    def _connect_read_only(self) -> sqlite3.Connection:
        if not self.path.is_file():
            raise CatalogError(f"versioned food catalog is unavailable: {self.path}")
        uri = self.path.as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    def _load(self) -> None:
        try:
            with self._connect_read_only() as connection:
                columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(food)").fetchall()
                }
                missing = self.REQUIRED_COLUMNS - columns
                if missing:
                    raise CatalogError(
                        "food catalog schema is missing: " + ", ".join(sorted(missing))
                    )

                rows = connection.execute(
                    """
                    SELECT id, source_id, name_en, energy_kcal_100g, source_name,
                           quality_grade, dataset_version, quality_rank
                    FROM food
                    WHERE active = 1 AND energy_kcal_100g IS NOT NULL
                    ORDER BY quality_rank ASC, id ASC
                    """
                ).fetchall()
                if not rows:
                    raise CatalogError("food catalog has no active energy records")

                foods = tuple(
                    CatalogFood(
                        id=int(row["id"]),
                        source_id=str(row["source_id"]),
                        name=str(row["name_en"]).strip(),
                        energy_kcal_100g=float(row["energy_kcal_100g"]),
                        source_name=str(row["source_name"]).strip(),
                        quality_grade=str(row["quality_grade"]).strip().upper(),
                        dataset_version=str(row["dataset_version"]).strip(),
                        quality_rank=int(row["quality_rank"]),
                    )
                    for row in rows
                )

                aliases: List[Tuple[int, str]] = []
                alias_table_exists = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='food_alias'"
                ).fetchone()
                if alias_table_exists:
                    aliases = [
                        (int(row["food_id"]), str(row["alias"]))
                        for row in connection.execute(
                            "SELECT food_id, alias FROM food_alias ORDER BY food_id, alias"
                        ).fetchall()
                    ]

                metadata_version = self._read_metadata_version(connection)
        except sqlite3.Error as exc:
            raise CatalogError("food catalog could not be read") from exc

        by_id = {food.id: food for food in foods}
        exact: Dict[str, CatalogFood] = {}
        normalized_names: Dict[int, str] = {}
        for food in foods:
            normalized = normalize_food_name(food.name)
            normalized_names[food.id] = normalized
            exact.setdefault(normalized, food)
        for food_id, alias in aliases:
            food = by_id.get(food_id)
            if food is not None:
                exact.setdefault(normalize_food_name(alias), food)

        versions = sorted({food.dataset_version for food in foods if food.dataset_version})
        if metadata_version:
            dataset_version = metadata_version
        elif len(versions) == 1:
            dataset_version = versions[0]
        else:
            joined = "+".join(versions)
            dataset_version = "mixed:" + joined[:180]

        sources = sorted({food.source_name for food in foods if food.source_name})
        source_label = (" + ".join(sources[:3]) + " · 确定性计算")[:300]

        self._foods = foods
        self._exact_index = exact
        self._normalized_names = normalized_names
        self._dataset_version = dataset_version[:200]
        self._source_label = source_label

    @staticmethod
    def _read_metadata_version(connection: sqlite3.Connection) -> Optional[str]:
        table_exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='dataset_metadata'"
        ).fetchone()
        if not table_exists:
            return None
        row = connection.execute(
            "SELECT value FROM dataset_metadata WHERE key = 'dataset_version' LIMIT 1"
        ).fetchone()
        return str(row["value"]).strip() if row and row["value"] else None

    @property
    def dataset_version(self) -> str:
        return self._dataset_version

    @property
    def source_label(self) -> str:
        return self._source_label

    @property
    def count(self) -> int:
        return len(self._foods)

    def resolve(self, candidate_name: str) -> Optional[CatalogMatch]:
        normalized = normalize_food_name(candidate_name)
        exact = self._exact_index.get(normalized)
        if exact is not None:
            return CatalogMatch(food=exact, score=1.0, basis="exact_or_alias")

        # A generic one-token visual label such as "rice" or "soup" is not a
        # safe nutrition identity in a large catalogue. Require the provider to
        # return a reviewed canonical name/alias instead of silently choosing
        # the first of many materially different foods.
        if len(normalized.split()) < 2:
            return None

        ranked: List[Tuple[float, CatalogFood]] = []
        for food in self._foods:
            score = _name_score(normalized, self._normalized_names[food.id])
            ranked.append((score, food))

        ranked.sort(key=lambda item: (-item[0], item[1].quality_rank, item[1].id))
        if not ranked:
            return None
        best_score, best_food = ranked[0]
        second_score = ranked[1][0] if len(ranked) > 1 else 0.0
        if (
            best_score < self.minimum_match_score
            or best_score - second_score < self.minimum_match_gap
        ):
            return None
        return CatalogMatch(food=best_food, score=best_score, basis="fuzzy_with_gap")
