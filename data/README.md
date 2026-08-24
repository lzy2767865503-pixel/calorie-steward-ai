# Food catalogue audit bundle

`food-catalog.csv` and the Android SQLite asset contain the same 5,000 selected
USDA FoodData Central records. `dataset-manifest.json` records the exact source
artifacts and selection policy; `quality-report.json` records the executable
validation results; `catalog-v3-added-supermarket-foods.csv` lists the 3,000
new supermarket rows; `SHA256SUMS` protects all five deliverables against silent
changes.

The unified public catalogue version is `USDA-FDC-CC-2026.08-v3`. Runtime
clients and backend health/version endpoints should read it from
`dataset_metadata.dataset_version`; per-row `dataset_version` remains detailed
source provenance and is not the product-level release identifier.
`generated_at_utc` is the real artifact-build time and is identical in SQLite,
the manifest, and the quality report. `catalog_effective_date` separately records
the fixed release date without pretending it is a build timestamp.

The catalogue is a nutrient reference, not proof that a photo contains a given
portion. Photo recognition and portion estimation must report uncertainty and
must not present a single calorie number as laboratory truth.

The formal source grades are:

- A: USDA Foundation analytical profile (300 records)
- B: USDA-published Branded manufacturer-label profile (3,400 records)
- C: USDA FNDDS survey or standardized-recipe profile (1,300 records)

Two FNDDS records are reproducible integration anchors:
`Rice, white, cooked, no added fat` and `Soup, broth`. They are selected directly
from the official source rather than inserted or edited after database creation.

All 3,400 branded rows have unique, check-digit-valid GTIN/UPC values, positive
serving weights in grams, and positive energy. The original v2 2,000 source ids
are retained, while all 3,000 new rows preserve raw USDA `GROCERY` trade-channel
evidence and have no known discontinuation marker. A missing USDA
`discontinuedDate` is recorded as `discontinuation_status=UNKNOWN`; it is not
interpreted as proof that a product is active or currently stocked. Three
known-discontinued rows remain explicitly flagged solely because the full v2
compatibility set must be retained; they are not part of the new 3,000.
Edible-oil rows with nonpositive energy are excluded.
Missing nutrients remain null. Chinese and Malay names are not generated or
guessed.

`barcode` is the scanner-compatible value used by Android exact lookup;
`barcode_gtin14` preserves USDA's canonical 14-digit value. The current branded
sources reflect the market-country values published by USDA and must not be
marketed as proof of Malaysian shelf availability. Malaysian expansion still
requires licensed local label data.

The Branded evidence combines the April 2026 official bulk release, frozen
official API responses, and an independent frozen result set from the official
FoodData Central website-search backend. The latter is not a promised stable
public API. “Latest” means latest among those manifested frozen artifacts only,
not a claim about all live USDA records.
