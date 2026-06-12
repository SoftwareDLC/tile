# software-dlc-tile

Python helpers for first-class TILE prompt tables.

This package is an incubating Python surface for `@software-dlc/tile`. It starts
with first-class TILE because that is the smallest useful API for Python, data,
and LLM users who already have structured rows and want compact prompt context.

```python
from software_dlc_tile import encode_first_class_tables_to_tile

tile = encode_first_class_tables_to_tile({
    "delimiter": "pipe",
    "tables": [
        {
            "id": "packages",
            "columns": ["name", {"embedded_columns": ["dependency"]}],
            "rows": [
                ["fastapi", "pydantic"],
                ["", "starlette"],
            ],
        }
    ],
})
```

This first Python package does not yet implement lossless JSON-to-TILE encoding
or TILE-to-JSON decoding. Those should come after shared conformance coverage is
expanded for the full wire format.
