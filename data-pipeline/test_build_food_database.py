import unittest

from build_food_database import (
    FoodRow,
    branded_version_key,
    discontinuation_marker_reason,
    discontinuation_status,
    is_high_quality_grocery_candidate,
    normalize_source_gtin,
    valid_barcode,
)


class SourceGtinNormalizationTest(unittest.TestCase):
    def test_standard_gtin_lengths_remain_unchanged(self) -> None:
        for value in (
            "96385074",
            "036000291452",
            "4006381333931",
            "10012345000017",
        ):
            with self.subTest(value=value):
                self.assertEqual(normalize_source_gtin(value), (value, False))

    def test_only_one_missing_leading_zero_is_recovered(self) -> None:
        self.assertEqual(normalize_source_gtin("1000009"), ("01000009", True))
        self.assertEqual(
            normalize_source_gtin("39400015048"),
            ("039400015048", True),
        )
        self.assertEqual(valid_barcode("39400015048"), "039400015048")
        self.assertEqual(valid_barcode("39400015048").zfill(14), "00039400015048")

    def test_invalid_or_ambiguous_lengths_are_rejected(self) -> None:
        for value in (
            "1000008",      # seven digits, recovered check digit is invalid
            "39400015049",  # eleven digits, recovered check digit is invalid
            "123456",       # six digits: never padded
            "3940001504",   # ten digits: never padded
            "100123450000170",  # fifteen digits: never truncated
        ):
            with self.subTest(value=value):
                self.assertEqual(normalize_source_gtin(value), (None, False))

    def test_recovered_newer_non_grocery_version_suppresses_old_grocery(self) -> None:
        versions = (
            {
                "fdcId": 2498233,
                "gtinUpc": "039400015048",
                "publicationDate": "2023-03-16",
                "modifiedDate": "2023-02-06",
                "tradeChannels": ["NO_TRADE_CHANNEL"],
            },
            {
                "fdcId": 2739730,
                "gtinUpc": "00039400015048",
                "publicationDate": "2025-07-24",
                "modifiedDate": "2025-07-04",
                "tradeChannels": ["GROCERY"],
            },
            {
                "fdcId": 2757123,
                "gtinUpc": "39400015048",
                "publicationDate": "2026-04-23",
                "modifiedDate": "",
                "tradeChannels": ["NO_TRADE_CHANNEL"],
            },
        )

        canonical_gtins = {
            normalize_source_gtin(item["gtinUpc"])[0].zfill(14)
            for item in versions
        }
        self.assertEqual(canonical_gtins, {"00039400015048"})
        latest = max(versions, key=branded_version_key)
        self.assertEqual(latest["fdcId"], 2757123)
        self.assertNotIn("GROCERY", latest["tradeChannels"])


class DiscontinuationEvidenceTest(unittest.TestCase):
    def test_description_tokens_include_underscore_and_space(self) -> None:
        for description in (
            "DISCONTINUED_MAGGI Chicken Flavor Noodles",
            "Discontinued DIGIORNO Three Meat Pizza",
        ):
            with self.subTest(description=description):
                item = {"description": description}
                self.assertEqual(discontinuation_marker_reason(item), "DESCRIPTION")
                self.assertEqual(discontinuation_status(item), "KNOWN_DISCONTINUED")

    def test_missing_future_and_effective_date_statuses(self) -> None:
        self.assertEqual(
            discontinuation_status({"description": "Ordinary grocery food"}),
            "UNKNOWN",
        )
        self.assertEqual(
            discontinuation_status(
                {
                    "description": "Ordinary grocery food",
                    "discontinuedDate": "2027-01-01",
                }
            ),
            "FUTURE_DISCONTINUATION_DATE",
        )
        self.assertEqual(
            discontinuation_status(
                {
                    "description": "Ordinary grocery food",
                    "discontinuedDate": "2026-08-18",
                }
            ),
            "KNOWN_DISCONTINUED",
        )

    def test_known_discontinued_row_fails_grocery_quality_filter(self) -> None:
        row = FoodRow(
            source_id="USDA-FDC-test",
            name_en="DISCONTINUED_MAGGI Chicken Flavor Noodles",
            category="Prepared Soups",
            energy_kcal_100g=100,
            serving_g=50,
            barcode="036000291452",
            barcode_gtin14="00036000291452",
            brand="MAGGI",
            market_country="US",
            trade_channels="GROCERY",
            publication_date="2026-01-01",
            discontinuation_status="KNOWN_DISCONTINUED",
            source_dataset="branded",
        )
        self.assertFalse(is_high_quality_grocery_candidate(row))


if __name__ == "__main__":
    unittest.main()
