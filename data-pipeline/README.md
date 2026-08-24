# Clinical Clarity food catalogue pipeline

This pipeline builds the Android app's read-only, auditable food catalogue from
official USDA FoodData Central bulk downloads (Foundation, FNDDS, and Branded),
frozen official API snapshots, and an independent frozen slice of the official
FoodData Central website search. The website-search backend is not represented
as a stable public API. The pipeline deliberately does not invent translations
or nutrient values.

## Rebuild

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python build_food_database.py
.venv/bin/python -m unittest -v test_build_food_database.py
.venv/bin/python build_food_database.py --offline
```

`DEMO_KEY`, USDA's documented low-rate sample key, is used by default for the
small Branded snapshot. For repeat builds, set `FDC_API_KEY` to your own USDA
API key. The key is never written to the manifest or cache filenames. The API
snapshot is dated automatically; set `FDC_BRANDED_SNAPSHOT_DATE=YYYY-MM-DD` to
rebuild against an already cached, frozen snapshot.

The source archives, API response pages, and official website-search responses
are cached under `.cache/` and are excluded from version control. Offline mode
fails if any frozen artifact is absent. The generated deliverables are:

- `../android-app/app/src/main/assets/databases/clinical_clarity_foods.sqlite`
- `../data/food-catalog.csv`
- `../data/catalog-v3-added-supermarket-foods.csv`
- `../data/dataset-manifest.json`
- `../data/quality-report.json`
- `../data/SHA256SUMS`

The output contains exactly 5,000 catalogue-enabled records: 300 Foundation foods, 1,300
FNDDS survey foods, the retained 400-row v2 Branded subset, and 3,000 additional
Branded foods selected from the frozen April 2026 bulk, API, and independent
website-search artifacts. Every new row has a valid GTIN/UPC, positive energy
and serving grams, raw USDA `tradeChannels` containing `GROCERY`, and no known
discontinuation marker. `GROCERY` and `discontinuation_status=UNKNOWN` do not
prove current manufacture or shelf availability. `name_zh` and `name_ms` remain
null until a reviewed, licensed localization source is available.

The deterministic sample always includes the FNDDS anchors
`Rice, white, cooked, no added fat` and `Soup, broth`; they replace two ordinary
survey sample rows and do not change the 1,300-row FNDDS quota.

The catalogue-wide version is `USDA-FDC-CC-2026.08-v3`. It is stored in the
SQLite `dataset_metadata` table together with the record count, database schema
version, actual build-generation timestamp, fixed `catalog_effective_date`, and
component source releases. The SQLite and manifest `generated_at_utc` values are
written from the same build variable and must match exactly.
Consumers should expose this catalogue version rather than concatenate the
per-record source-release strings.

Quality grades are explicit: A = USDA Foundation analytical profile, B = USDA
Branded manufacturer-label profile, and C = USDA FNDDS survey/standardized
recipe profile. The database also retains a `food_nutrient_provenance` row for
every included nutrient so the USDA nutrient id and derivation metadata remain
auditable.

For packaged foods, `barcode` is normalized to the value a mobile scanner
returns (for example, 12-digit UPC-A rather than USDA's zero-padded 14-digit
form). `barcode_gtin14` retains the canonical USDA/GS1 representation. Both
forms are retained as aliases. Android normalizes every scanner value to
GTIN-14 and performs exact lookup against `barcode_gtin14`. Every selected
Branded row must also have a positive serving weight that can be
converted to grams. Edible-oil rows with nonpositive energy are excluded rather
than treating rounded label values as physically exact per-100 g measurements.
The `trade_channels` column retains sorted, pipe-delimited USDA trade-channel
evidence. `catalog-v3-added-supermarket-foods.csv` is the auditable 3,000-row
increment from v2 to v3.

Raw GTIN-8, UPC-A, EAN-13, and GTIN-14 values must pass their check digit.
USDA rows that omit exactly one leading zero are recovered only for 7-to-8 and
11-to-12 digit forms, followed by the same check-digit validation; no other
length is padded. Latest-version resolution is limited to the frozen artifacts
listed in the manifest. A latest GTIN version with an effective
`discontinuedDate` or an independent `DISCONTINUED` description token is
excluded without falling back to an older version. Missing discontinuation
evidence is persisted as `UNKNOWN`, not as active. Three known-discontinued
legacy Branded rows remain explicitly flagged only to preserve the exact v2
2,000-record compatibility set; none belongs to the new 3,000-row expansion.

USDA FoodData Central data are distributed under the CC0 1.0 public-domain
dedication. MyFCD is not redistributed by this pipeline because commercial
redistribution permission has not been obtained.
