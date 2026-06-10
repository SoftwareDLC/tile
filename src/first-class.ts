import { escapeTileText, resolveTileDelimiter } from './text.js';
import type {
  JsonTileFirstClassCell,
  JsonTileFirstClassColumn,
  JsonTileFirstClassDocument,
  JsonTileFirstClassTable
} from './types.js';

export function encodeFirstClassTablesToTile(
  document: JsonTileFirstClassDocument
): string {
  const delimiter = resolveTileDelimiter(document.delimiter ?? 'tab');

  return document.tables
    .map((table) =>
      [
        encodeFirstClassTableDefinition(table, delimiter),
        table.columns
          .map((column) => formatFirstClassTableColumn(column, delimiter))
          .join(delimiter),
        ...table.rows.map((row) =>
          row.map((cell) => formatFirstClassTableCell(cell, delimiter)).join(delimiter)
        )
      ].join('\n')
    )
    .join('\n\n');
}

function formatFirstClassTableColumn(
  column: JsonTileFirstClassColumn,
  delimiter: string
): string {
  if (typeof column === 'string') {
    return escapeTileText(column, delimiter);
  }

  if (column.embedded_columns.length === 0) {
    throw new Error('First-class TILE embedded column groups cannot be empty');
  }

  return `[${column.embedded_columns
    .map((embedded_column) =>
      formatFirstClassEmbeddedColumnName(embedded_column, delimiter)
    )
    .join(delimiter === ',' ? ';' : ',')}]`;
}

function formatFirstClassEmbeddedColumnName(
  column: string,
  delimiter: string
): string {
  if (
    column.includes('[') ||
    column.includes(']') ||
    (delimiter !== ',' && column.includes(','))
  ) {
    throw new Error(
      'First-class TILE embedded column names cannot contain comma or brackets'
    );
  }

  return escapeTileText(column, delimiter);
}

function encodeFirstClassTableDefinition(
  table: JsonTileFirstClassTable,
  delimiter: string
): string {
  const definition_parts = [table.id];

  if (table.kind || table.path) {
    definition_parts.push(table.kind ?? '');
  }

  if (table.path) {
    definition_parts.push(table.path);
  }

  return definition_parts.map((part) => escapeTileText(part, delimiter)).join(delimiter);
}

function formatFirstClassTableCell(
  cell: JsonTileFirstClassCell,
  delimiter: string
): string {
  if (cell === null || typeof cell === 'undefined') {
    return '';
  }

  if (typeof cell === 'number' && !Number.isFinite(cell)) {
    throw new Error('First-class TILE only supports finite numbers');
  }

  return escapeTileText(String(cell), delimiter);
}
