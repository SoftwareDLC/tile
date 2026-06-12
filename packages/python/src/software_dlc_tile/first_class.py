from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .text import escape_tile_text, resolve_tile_delimiter


JsonTileFirstClassCell = str | int | float | bool | None


def encode_first_class_tables_to_tile(document: Mapping[str, Any]) -> str:
    delimiter = resolve_tile_delimiter(str(document.get("delimiter", "tab")))
    tables = document.get("tables")
    if not isinstance(tables, Sequence) or isinstance(tables, (str, bytes)):
        raise TypeError("First-class TILE document requires a tables sequence")

    return "\n\n".join(_encode_first_class_table(table, delimiter) for table in tables)


def _encode_first_class_table(table: Any, delimiter: str) -> str:
    if not isinstance(table, Mapping):
        raise TypeError("First-class TILE tables must be mappings")

    columns = table.get("columns")
    rows = table.get("rows")
    if not isinstance(columns, Sequence) or isinstance(columns, (str, bytes)):
        raise TypeError("First-class TILE table columns must be a sequence")

    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        raise TypeError("First-class TILE table rows must be a sequence")

    lines = [
        _encode_first_class_table_definition(table, delimiter),
        delimiter.join(_format_first_class_table_column(column, delimiter) for column in columns),
    ]

    for row in rows:
        if not isinstance(row, Sequence) or isinstance(row, (str, bytes)):
            raise TypeError("First-class TILE table rows must contain cell sequences")
        lines.append(delimiter.join(_format_first_class_table_cell(cell, delimiter) for cell in row))

    return "\n".join(lines)


def _format_first_class_table_column(column: Any, delimiter: str) -> str:
    if isinstance(column, str):
        return escape_tile_text(column, delimiter)

    if not isinstance(column, Mapping):
        raise TypeError("First-class TILE columns must be strings or embedded column mappings")

    embedded_columns = column.get("embedded_columns")
    if (
        not isinstance(embedded_columns, Sequence)
        or isinstance(embedded_columns, (str, bytes))
        or len(embedded_columns) == 0
    ):
        raise ValueError("First-class TILE embedded column groups cannot be empty")

    join_delimiter = ";" if delimiter == "," else ","
    return (
        "["
        + join_delimiter.join(
            _format_first_class_embedded_column_name(embedded_column, delimiter)
            for embedded_column in embedded_columns
        )
        + "]"
    )


def _format_first_class_embedded_column_name(column: Any, delimiter: str) -> str:
    if not isinstance(column, str):
        raise TypeError("First-class TILE embedded column names must be strings")

    if "[" in column or "]" in column or (delimiter != "," and "," in column):
        raise ValueError(
            "First-class TILE embedded column names cannot contain comma or brackets"
        )

    return escape_tile_text(column, delimiter)


def _encode_first_class_table_definition(table: Mapping[str, Any], delimiter: str) -> str:
    table_id = table.get("id")
    if not isinstance(table_id, str):
        raise TypeError("First-class TILE table id must be a string")

    definition_parts = [table_id]
    kind = table.get("kind")
    path = table.get("path")

    if kind is not None and not isinstance(kind, str):
        raise TypeError("First-class TILE table kind must be a string")

    if path is not None and not isinstance(path, str):
        raise TypeError("First-class TILE table path must be a string")

    if kind or path:
        definition_parts.append(kind or "")

    if path:
        definition_parts.append(path)

    return delimiter.join(escape_tile_text(part, delimiter) for part in definition_parts)


def _format_first_class_table_cell(cell: Any, delimiter: str) -> str:
    if cell is None:
        return ""

    return escape_tile_text(_format_cell_value(cell), delimiter)


def _format_cell_value(cell: JsonTileFirstClassCell) -> str:
    if isinstance(cell, bool):
        return "true" if cell else "false"

    if isinstance(cell, str):
        return cell

    if isinstance(cell, int):
        return str(cell)

    if isinstance(cell, float):
        if not math.isfinite(cell):
            raise ValueError("First-class TILE only supports finite numbers")
        return _format_javascript_number(cell)

    raise TypeError("First-class TILE cells must be strings, numbers, booleans, or None")


def _format_javascript_number(value: float) -> str:
    if value == 0:
        return "0"

    sign = "-" if value < 0 else ""
    digits, decimal_exponent = _decimal_parts(abs(value))
    digit_count = len(digits)

    if digit_count <= decimal_exponent <= 21:
        return f"{sign}{digits}{'0' * (decimal_exponent - digit_count)}"

    if 0 < decimal_exponent <= 21:
        return f"{sign}{digits[:decimal_exponent]}.{digits[decimal_exponent:]}"

    if -6 < decimal_exponent <= 0:
        return f"{sign}0.{'0' * (-decimal_exponent)}{digits}"

    mantissa = digits if digit_count == 1 else f"{digits[0]}.{digits[1:]}"
    exponent = decimal_exponent - 1
    exponent_sign = "+" if exponent >= 0 else ""
    return f"{sign}{mantissa}e{exponent_sign}{exponent}"


def _decimal_parts(value: float) -> tuple[str, int]:
    text = repr(value)
    if "e" in text or "E" in text:
        mantissa_text, exponent_text = text.lower().split("e", 1)
        exponent = int(exponent_text)
        integer_part, _, fractional_part = mantissa_text.partition(".")
        digits = f"{integer_part}{fractional_part}".lstrip("0")
        return digits, exponent + len(integer_part)

    integer_part, _, fractional_part = text.partition(".")
    if integer_part == "0":
        trimmed_fractional_part = fractional_part.rstrip("0")
        leading_zero_count = len(trimmed_fractional_part) - len(
            trimmed_fractional_part.lstrip("0")
        )
        digits = trimmed_fractional_part.lstrip("0")
        return digits or "0", -leading_zero_count

    digits = f"{integer_part}{fractional_part}".rstrip("0")
    return digits, len(integer_part)
