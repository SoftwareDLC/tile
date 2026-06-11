import {
  COLUMN_REF_TILE_VERSION,
  COMPACT_TILE_VERSION,
  LEGACY_TILE_VERSION,
  PRIMITIVE_HEADER_TILE_VERSION,
  TILE_VERSION,
  isTileTableKind,
  parseTileColumnHeader
} from './codec-internals.js';
import { parseTileCell, parseTileColumnCell } from './decode-cell.js';
import { unescapeTileText } from './text.js';
import type { JsonValue } from './types.js';
import type { ParsedTileColumn, ParsedTileTable } from './codec-internals.js';

function parseLegacyTileColumns(headers: string[]): ParsedTileColumn[] {
  return headers.map((header) => ({
    name: unescapeTileText(header),
    ref_table_id: null,
    primitive_type: null
  }));
}

function decodeLegacyTileToJson(tile: string): JsonValue {
  const lines = tile.split(/\r?\n/);
  if (lines[0] !== LEGACY_TILE_VERSION) {
    throw new Error(`Unsupported TILE version: ${lines[0] ?? '<empty>'}`);
  }

  let root_cell: string | null = null;
  let current_table: ParsedTileTable | null = null;
  const tables = new Map<string, ParsedTileTable>();

  lines.slice(1).forEach((line) => {
    if (line.length === 0) {
      return;
    }

    const cells = line.split('\t');
    const row_type = cells[0];

    if (row_type === 'root') {
      root_cell = cells[1] ?? null;
      return;
    }

    if (row_type === 'table') {
      const [table_id, kind, raw_path] = cells.slice(1);
      if (!table_id || !isTileTableKind(kind) || raw_path === undefined) {
        throw new Error(`Invalid TILE table row: ${line}`);
      }

      current_table = {
        id: table_id,
        kind,
        path: unescapeTileText(raw_path),
        columns: [],
        rows: []
      };
      tables.set(table_id, current_table);
      return;
    }

    if (!current_table) {
      throw new Error(`TILE row appears before table declaration: ${line}`);
    }

    if (row_type === 'cols') {
      current_table.columns = parseLegacyTileColumns(cells.slice(1));
      return;
    }

    if (row_type === 'row') {
      current_table.rows.push(cells.slice(1));
      return;
    }

    throw new Error(`Invalid TILE row type: ${row_type ?? '<empty>'}`);
  });

  if (!root_cell) {
    throw new Error('TILE root row is missing');
  }

  return parseTileCell(root_cell, tables, new Set<string>());
}

function decodeCompactTileToJson(tile: string): JsonValue {
  const sections = tile
    .split(/\r?\n\r?\n/)
    .filter((section) => section.trim().length > 0);
  const header_lines = sections[0]?.split(/\r?\n/) ?? [];

  if (header_lines[0] !== COMPACT_TILE_VERSION) {
    throw new Error(`Unsupported TILE version: ${header_lines[0] ?? '<empty>'}`);
  }

  const root_line = header_lines[1];
  if (!root_line) {
    throw new Error('TILE root row is missing');
  }

  const root_cells = root_line.split('\t');
  if (root_cells[0] !== 'root' || !root_cells[1]) {
    throw new Error(`Invalid TILE root row: ${root_line}`);
  }

  const tables = new Map<string, ParsedTileTable>();

  sections.slice(1).forEach((section) => {
    const lines = section.split(/\r?\n/).filter((line) => line.length > 0);
    const table_line = lines[0];
    const columns_line = lines[1];

    if (!table_line || !columns_line) {
      throw new Error(`Invalid TILE table section: ${section}`);
    }

    const [table_id, kind, raw_path, extra] = table_line.split('\t');
    if (
      !table_id ||
      !isTileTableKind(kind) ||
      raw_path === undefined ||
      extra !== undefined
    ) {
      throw new Error(`Invalid TILE table row: ${table_line}`);
    }

    tables.set(table_id, {
      id: table_id,
      kind,
      path: unescapeTileText(raw_path),
      columns: parseLegacyTileColumns(columns_line.split('\t')),
      rows: lines.slice(2).map((line) => line.split('\t'))
    });
  });

  return parseTileCell(root_cells[1], tables, new Set<string>());
}

function decodeColumnTileToJson(input: {
  tile: string;
  supports_primitive_headers: boolean;
}): JsonValue {
  const sections = input.tile
    .split(/\r?\n\r?\n/)
    .filter((section) => section.trim().length > 0);
  const header_lines = sections[0]?.split(/\r?\n/) ?? [];

  if (
    header_lines[0] !== TILE_VERSION &&
    header_lines[0] !== PRIMITIVE_HEADER_TILE_VERSION &&
    header_lines[0] !== COLUMN_REF_TILE_VERSION
  ) {
    throw new Error(`Unsupported TILE version: ${header_lines[0] ?? '<empty>'}`);
  }

  const root_line = header_lines[1];
  if (!root_line) {
    throw new Error('TILE root row is missing');
  }

  const root_cells = root_line.split('\t');
  const root_column = parseTileColumnHeader(
    root_cells[0] ?? '',
    input.supports_primitive_headers
  );
  if (root_column.name !== 'root' || !root_cells[1]) {
    throw new Error(`Invalid TILE root row: ${root_line}`);
  }

  const tables = new Map<string, ParsedTileTable>();

  sections.slice(1).forEach((section) => {
    const lines = section.split(/\r?\n/).filter((line) => line.length > 0);
    const table_line = lines[0];
    const columns_line = lines[1];

    if (!table_line || !columns_line) {
      throw new Error(`Invalid TILE table section: ${section}`);
    }

    const [table_id, kind, raw_path, extra] = table_line.split('\t');
    if (
      !table_id ||
      !isTileTableKind(kind) ||
      raw_path === undefined ||
      extra !== undefined
    ) {
      throw new Error(`Invalid TILE table row: ${table_line}`);
    }

    tables.set(table_id, {
      id: table_id,
      kind,
      path: unescapeTileText(raw_path),
      columns: columns_line
        .split('\t')
        .map((header) =>
          parseTileColumnHeader(header, input.supports_primitive_headers)
        ),
      rows: lines.slice(2).map((line) => line.split('\t'))
    });
  });

  return parseTileColumnCell({
    column: root_column,
    cell: root_cells[1],
    tables,
    stack: new Set<string>()
  });
}

export function decodeTileToJson(tile: string): JsonValue {
  const version = tile.split(/\r?\n/, 1)[0];
  if (version === LEGACY_TILE_VERSION) {
    return decodeLegacyTileToJson(tile);
  }

  if (version === COMPACT_TILE_VERSION) {
    return decodeCompactTileToJson(tile);
  }

  if (version === COLUMN_REF_TILE_VERSION) {
    return decodeColumnTileToJson({
      tile,
      supports_primitive_headers: false
    });
  }

  if (version === PRIMITIVE_HEADER_TILE_VERSION) {
    return decodeColumnTileToJson({
      tile,
      supports_primitive_headers: true
    });
  }

  return decodeColumnTileToJson({
    tile,
    supports_primitive_headers: true
  });
}
