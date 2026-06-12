from __future__ import annotations


def escape_tile_text(value: str, delimiter: str = "\t") -> str:
    result: list[str] = []

    for char in value:
        if char == "\\":
            result.append("\\\\")
        elif char == "\t":
            result.append("\\t")
        elif char == "\n":
            result.append("\\n")
        elif char == "\r":
            result.append("\\r")
        elif char == " " and delimiter == " ":
            result.append("\\s")
        elif char == delimiter and delimiter != "\t":
            result.append(f"\\{char}")
        else:
            result.append(char)

    return "".join(result)


def unescape_tile_text(value: str) -> str:
    result: list[str] = []
    index = 0

    while index < len(value):
        char = value[index]
        if char != "\\":
            result.append(char)
            index += 1
            continue

        if index + 1 >= len(value):
            raise ValueError("Invalid TILE escape: trailing backslash")

        escaped_char = value[index + 1]
        if escaped_char == "t":
            result.append("\t")
        elif escaped_char == "n":
            result.append("\n")
        elif escaped_char == "r":
            result.append("\r")
        elif escaped_char == "\\":
            result.append("\\")
        elif escaped_char == "s":
            result.append(" ")
        elif escaped_char == ",":
            result.append(",")
        elif escaped_char == "|":
            result.append("|")
        elif escaped_char == "@":
            result.append("@")
        elif escaped_char == ":":
            result.append(":")
        else:
            raise ValueError(f"Invalid TILE escape: \\{escaped_char}")

        index += 2

    return "".join(result)


def resolve_tile_delimiter(delimiter: str) -> str:
    if delimiter == "comma":
        return ","

    if delimiter == "pipe":
        return "|"

    if delimiter == "space":
        return " "

    return "\t"
