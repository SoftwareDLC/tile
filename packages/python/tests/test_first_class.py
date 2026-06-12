from __future__ import annotations

import json
import math
import pathlib
import sys
import unittest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT_DIR / "packages/python/src"))

from software_dlc_tile import (  # noqa: E402
    encode_first_class_tables_to_tile,
    escape_tile_text,
    unescape_tile_text,
)


class FirstClassTileTests(unittest.TestCase):
    def test_first_class_conformance_cases(self) -> None:
        cases_path = ROOT_DIR / "conformance/first-class-cases.json"
        cases = json.loads(cases_path.read_text(encoding="utf8"))

        for case in cases:
            with self.subTest(case["id"]):
                self.assertEqual(
                    encode_first_class_tables_to_tile(case["document"]),
                    case["expected"],
                )

    def test_rejects_ambiguous_embedded_column_names(self) -> None:
        with self.assertRaisesRegex(ValueError, "comma or brackets"):
            encode_first_class_tables_to_tile(
                {
                    "tables": [
                        {
                            "id": "nodes",
                            "columns": [{"embedded_columns": ["edge,id"]}],
                            "rows": [],
                        }
                    ]
                }
            )

    def test_rejects_non_finite_numbers(self) -> None:
        with self.assertRaisesRegex(ValueError, "finite numbers"):
            encode_first_class_tables_to_tile(
                {
                    "tables": [
                        {
                            "id": "metrics",
                            "columns": ["value"],
                            "rows": [[math.inf]],
                        }
                    ]
                }
            )

    def test_tile_text_escaping_round_trip(self) -> None:
        escaped = escape_tile_text("a\tb\nc\\d")
        self.assertEqual(escaped, "a\\tb\\nc\\\\d")
        self.assertEqual(unescape_tile_text(escaped), "a\tb\nc\\d")

        with self.assertRaisesRegex(ValueError, "Invalid TILE escape"):
            unescape_tile_text("bad\\x")


if __name__ == "__main__":
    unittest.main()
