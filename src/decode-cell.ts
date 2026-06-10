import { parsePrimitiveCellHeader } from './codec-internals.js';
import { unescapeTileText } from './text.js';
import type { JsonObject, JsonPrimitive, JsonValue } from './types.js';
import type {
  ParsedTileColumn,
  ParsedTileTable,
  TilePrimitiveType
} from './codec-internals.js';

export function parseTileCell(
  cell: string,
  tables: Map<string, ParsedTileTable>,
  stack: Set<string>
): JsonValue {
  const primitive = parsePrimitiveCellHeader(cell);
  const prefix = cell.slice(0, 2);
  const payload = primitive?.payload ?? cell.slice(2);

  if (primitive?.primitive_type === 's') {
    return unescapeTileText(payload);
  }

  if (primitive?.primitive_type === 'n') {
    const parsed_number = Number(payload);
    if (!Number.isFinite(parsed_number)) {
      throw new Error(`Invalid TILE number cell: ${cell}`);
    }

    return parsed_number;
  }

  if (primitive?.primitive_type === 'b') {
    if (payload === '1') {
      return true;
    }

    if (payload === '0') {
      return false;
    }

    throw new Error(`Invalid TILE boolean cell: ${cell}`);
  }

  if (primitive?.primitive_type === 'z') {
    if (payload.length > 0) {
      throw new Error(`Invalid TILE null cell: ${cell}`);
    }

    return null;
  }

  if (prefix === 'r:') {
    const [table_id, row_id, extra] = payload.split(':');
    if (!table_id || !row_id || extra !== undefined) {
      throw new Error(`Invalid TILE reference cell: ${cell}`);
    }

    return resolveTileReference({ table_id, row_id, tables, stack });
  }

  throw new Error(`Invalid TILE cell prefix: ${cell}`);
}

function resolveTileReference(input: {
  table_id: string;
  row_id: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonValue {
  const table = input.tables.get(input.table_id);
  if (!table) {
    throw new Error(`Unknown TILE table reference: ${input.table_id}`);
  }

  const stack_key = `${input.table_id}:${input.row_id}`;
  if (input.stack.has(stack_key)) {
    throw new Error(`Cyclic TILE reference detected at ${stack_key}`);
  }

  input.stack.add(stack_key);
  try {
    if (table.kind === 'array') {
      return decodeArrayReference({
        table,
        array_id: input.row_id,
        tables: input.tables,
        stack: input.stack
      });
    }

    if (table.kind === 'properties') {
      return decodePropertiesReference({
        table,
        object_id: input.row_id,
        tables: input.tables,
        stack: input.stack
      });
    }

    return decodeObjectReference({
      table,
      row_id: input.row_id,
      tables: input.tables,
      stack: input.stack
    });
  } finally {
    input.stack.delete(stack_key);
  }
}

function decodeObjectReference(input: {
  table: ParsedTileTable;
  row_id: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonObject {
  const row = input.table.rows.find((candidate) => candidate[0] === input.row_id);
  if (!row) {
    throw new Error(`Unknown TILE object row reference: ${input.row_id}`);
  }

  const object_value: JsonObject = {};
  input.table.columns.slice(1).forEach((column, column_index) => {
    const cell = row[column_index + 1];
    if (cell === undefined || cell === '') {
      return;
    }

    object_value[column.name] = parseTileColumnCell({
      column,
      cell,
      tables: input.tables,
      stack: input.stack
    });
  });

  return object_value;
}

function decodeArrayReference(input: {
  table: ParsedTileTable;
  array_id: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonValue[] {
  const index_column_index = input.table.columns.findIndex(
    (column) => column.name === '$idx'
  );
  if (index_column_index !== -1) {
    return decodeIndexedArrayReference({
      ...input,
      index_column_index
    });
  }

  return decodeOrderedArrayReference(input);
}

function findArrayValueColumn(input: {
  table: ParsedTileTable;
  row: string[];
}): { column: ParsedTileColumn; column_index: number } | null {
  return (
    input.table.columns
      .map((column, column_index) => ({
        column,
        column_index
      }))
      .find(
        (candidate) =>
          candidate.column.name === 'value' &&
          (input.row[candidate.column_index] ?? '').length > 0
      ) ?? null
  );
}

function decodeIndexedArrayReference(input: {
  table: ParsedTileTable;
  array_id: string;
  index_column_index: number;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonValue[] {
  const entries = input.table.rows
    .filter((row) => row[0] === input.array_id)
    .map((row) => {
      const raw_index = row[input.index_column_index];
      if (!raw_index) {
        throw new Error(`Missing TILE array index for ${input.array_id}`);
      }

      const index_column = input.table.columns[input.index_column_index];
      if (!index_column) {
        throw new Error(`Missing TILE array index column for ${input.array_id}`);
      }

      const parsed_index = parseTileColumnCell({
        column: index_column,
        cell: raw_index,
        tables: input.tables,
        stack: input.stack
      });
      if (
        typeof parsed_index !== 'number' ||
        !Number.isInteger(parsed_index) ||
        parsed_index < 0
      ) {
        throw new Error(`Invalid TILE array index for ${input.array_id}`);
      }

      const value_column = findArrayValueColumn({
        table: input.table,
        row
      });
      if (!value_column) {
        throw new Error(`Missing TILE array value for ${input.array_id}`);
      }

      const value_cell = row[value_column.column_index];
      if (value_cell === undefined) {
        throw new Error(`Missing TILE array value for ${input.array_id}`);
      }

      return {
        index: parsed_index,
        value: parseTileColumnCell({
          column: value_column.column,
          cell: value_cell,
          tables: input.tables,
          stack: input.stack
        })
      };
    })
    .sort((left, right) => left.index - right.index);

  entries.forEach((entry, expected_index) => {
    if (entry.index !== expected_index) {
      throw new Error(`Non-contiguous TILE array indexes for ${input.array_id}`);
    }
  });

  return entries.map((entry) => entry.value);
}

function decodeOrderedArrayReference(input: {
  table: ParsedTileTable;
  array_id: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonValue[] {
  let current_array_id: string | null = null;
  let found_array = false;
  const values: JsonValue[] = [];

  input.table.rows.forEach((row) => {
    const array_id_cell = row[0];
    if (array_id_cell && array_id_cell.length > 0) {
      current_array_id = array_id_cell;
      if (current_array_id === input.array_id) {
        found_array = true;
      }
      return;
    }

    if (!current_array_id) {
      throw new Error(`TILE array value row appears before an array marker`);
    }

    if (current_array_id !== input.array_id) {
      return;
    }

    const value_column = findArrayValueColumn({
      table: input.table,
      row
    });
    if (!value_column) {
      throw new Error(`Missing TILE array value for ${input.array_id}`);
    }

    const value_cell = row[value_column.column_index];
    if (value_cell === undefined) {
      throw new Error(`Missing TILE array value for ${input.array_id}`);
    }

    values.push(
      parseTileColumnCell({
        column: value_column.column,
        cell: value_cell,
        tables: input.tables,
        stack: input.stack
      })
    );
  });

  if (!found_array) {
    throw new Error(`Unknown TILE array reference: ${input.array_id}`);
  }

  return values;
}

function decodePropertiesReference(input: {
  table: ParsedTileTable;
  object_id: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonObject {
  const key_column = input.table.columns.find(
    (column) => column.name === 'key'
  );
  const value_column = input.table.columns.find(
    (column) => column.name === 'value'
  );

  if (!key_column || !value_column) {
    throw new Error(`Invalid TILE properties table: ${input.table.id}`);
  }

  const key_column_index = input.table.columns.indexOf(key_column);
  const value_column_index = input.table.columns.indexOf(value_column);
  const object_value: JsonObject = {};

  input.table.rows
    .filter((row) => row[0] === input.object_id)
    .forEach((row) => {
      const key_cell = row[key_column_index];
      const value_cell = row[value_column_index];
      if (!key_cell || !value_cell) {
        throw new Error(`Invalid TILE properties row for ${input.object_id}`);
      }

      const key = parseTileColumnCell({
        column: key_column,
        cell: key_cell,
        tables: input.tables,
        stack: input.stack
      });
      if (typeof key !== 'string') {
        throw new Error(`Invalid TILE properties key for ${input.object_id}`);
      }

      object_value[key] = parseTileColumnCell({
        column: value_column,
        cell: value_cell,
        tables: input.tables,
        stack: input.stack
      });
    });

  return object_value;
}

function parsePrimitiveColumnPayload(input: {
  primitive_type: TilePrimitiveType;
  cell: string;
}): JsonPrimitive {
  if (input.primitive_type === 's') {
    return unescapeTileText(input.cell);
  }

  if (input.primitive_type === 'n') {
    const parsed_number = Number(input.cell);
    if (!Number.isFinite(parsed_number)) {
      throw new Error(`Invalid TILE number cell: ${input.cell}`);
    }

    return parsed_number;
  }

  if (input.primitive_type === 'b') {
    if (input.cell === '1') {
      return true;
    }

    if (input.cell === '0') {
      return false;
    }

    throw new Error(`Invalid TILE boolean cell: ${input.cell}`);
  }

  if (input.cell !== '1') {
    throw new Error(`Invalid TILE null cell: ${input.cell}`);
  }

  return null;
}

export function parseTileColumnCell(input: {
  column: ParsedTileColumn;
  cell: string;
  tables: Map<string, ParsedTileTable>;
  stack: Set<string>;
}): JsonValue {
  if (input.column.ref_table_id) {
    return resolveTileReference({
      table_id: input.column.ref_table_id,
      row_id: input.cell,
      tables: input.tables,
      stack: input.stack
    });
  }

  if (input.column.primitive_type) {
    return parsePrimitiveColumnPayload({
      primitive_type: input.column.primitive_type,
      cell: input.cell
    });
  }

  return parseTileCell(input.cell, input.tables, input.stack);
}
