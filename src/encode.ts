import {
  PROPERTIES_PATH,
  ROOT_PATH,
  TILE_VERSION,
  addTablePath,
  canMergeObjectKeys,
  createCellColumnPlan,
  createPathSegment,
  createPropertyValueColumnPlan,
  createRefCell,
  encodeCellForColumnPlan,
  encodePrimitiveCell,
  encodeRootLine,
  encodeTileColumnHeader,
  isJsonObject,
  normalizeEncodeOptions,
  validateJsonValue
} from './codec-internals.js';
import { escapeTileText } from './text.js';
import type { JsonTileEncodeOptions, JsonValue } from './types.js';
import type {
  TileArrayRow,
  TileTableDraft,
  TileTableKind
} from './codec-internals.js';

export function encodeJsonToTile(
  value: unknown,
  options: JsonTileEncodeOptions = {}
): string {
  const json_value = validateJsonValue(value);
  const normalized_options = normalizeEncodeOptions(options);
  const tables: TileTableDraft[] = [];
  const table_by_key = new Map<string, TileTableDraft>();
  let properties_table: TileTableDraft | null = null;
  let next_table_number = 0;
  let next_object_row_number = 0;
  let next_array_number = 0;
  let next_properties_object_number = 0;

  function createTable(kind: TileTableKind, path: string): TileTableDraft {
    const table_key = `${kind}\u0000${path}`;
    const existing_table = table_by_key.get(table_key);
    if (existing_table) {
      return existing_table;
    }

    const table: TileTableDraft = {
      id: `t${next_table_number.toString(36)}`,
      kind,
      path,
      paths: [path],
      path_set: new Set([path]),
      columns: [],
      column_set: new Set<string>(),
      array_ids: [],
      object_rows: [],
      array_rows: [],
      property_rows: []
    };
    next_table_number += 1;
    tables.push(table);
    table_by_key.set(table_key, table);

    return table;
  }

  function getPropertiesTable(): TileTableDraft {
    if (properties_table) {
      return properties_table;
    }

    properties_table = {
      id: `t${next_table_number.toString(36)}`,
      kind: 'properties',
      path: PROPERTIES_PATH,
      paths: [PROPERTIES_PATH],
      path_set: new Set([PROPERTIES_PATH]),
      columns: [],
      column_set: new Set<string>(),
      array_ids: [],
      object_rows: [],
      array_rows: [],
      property_rows: []
    };
    next_table_number += 1;

    return properties_table;
  }

  function getArrayTable(path: string): TileTableDraft {
    return createTable('array', path);
  }

  function getPathObjectTable(path: string): TileTableDraft {
    return createTable('object', path);
  }

  function getNormalizedObjectTable(
    path: string,
    keys: Set<string>
  ): TileTableDraft {
    if (path === ROOT_PATH) {
      return getPathObjectTable(path);
    }

    const matching_table = tables.find(
      (table) =>
        table.kind === 'object' &&
        !table.path_set.has(ROOT_PATH) &&
        canMergeObjectKeys({
          keys,
          table,
          options: normalized_options
        })
    );

    if (matching_table) {
      addTablePath(matching_table, path);
      return matching_table;
    }

    return createTable('object', path);
  }

  function getObjectTable(path: string, keys: Set<string>): TileTableDraft {
    if (normalized_options.object_table_strategy === 'normalized_shape') {
      return getNormalizedObjectTable(path, keys);
    }

    return getPathObjectTable(path);
  }

  function addObjectColumn(table: TileTableDraft, column: string): void {
    if (table.column_set.has(column)) {
      return;
    }

    table.column_set.add(column);
    table.columns.push(column);
  }

  function encodeValue(input: JsonValue, path: string): string {
    if (Array.isArray(input)) {
      const table = getArrayTable(path);
      const array_id = `a${next_array_number.toString(36)}`;
      next_array_number += 1;
      table.array_ids.push(array_id);

      input.forEach((item, index) => {
        table.array_rows.push({
          array_id,
          index,
          value_cell: encodeValue(item, `${path}[]`)
        });
      });

      return createRefCell(table.id, array_id);
    }

    if (isJsonObject(input)) {
      if (path !== ROOT_PATH && Object.keys(input).length === 1) {
        const table = getPropertiesTable();
        const object_id = `p${next_properties_object_number.toString(36)}`;
        next_properties_object_number += 1;

        Object.entries(input).forEach(([key, child_value]) => {
          table.property_rows.push({
            object_id,
            key,
            value_cell: encodeValue(
              child_value,
              `${path}${createPathSegment(key)}`
            )
          });
        });

        return createRefCell(table.id, object_id);
      }

      const table = getObjectTable(path, new Set(Object.keys(input)));
      const row_id = `r${next_object_row_number.toString(36)}`;
      next_object_row_number += 1;
      const cells_by_column = new Map<string, string>();

      Object.entries(input).forEach(([key, child_value]) => {
        addObjectColumn(table, key);
        cells_by_column.set(
          key,
          encodeValue(child_value, `${path}${createPathSegment(key)}`)
        );
      });

      table.object_rows.push({
        id: row_id,
        cells_by_column
      });

      return createRefCell(table.id, row_id);
    }

    return encodePrimitiveCell(input);
  }

  const root_cell = encodeValue(json_value, ROOT_PATH);
  const root_line = encodeRootLine(root_cell);
  const sections = [[TILE_VERSION, root_line].join('\n')];

  const output_tables = properties_table ? [...tables, properties_table] : tables;

  output_tables.forEach((table) => {
    const table_lines = [
      [table.id, table.kind, escapeTileText(table.path)].join('\t')
    ];

    if (table.kind === 'properties') {
      const value_plan = createPropertyValueColumnPlan(
        table.property_rows.map((row) => row.value_cell)
      );
      table_lines.push(
        ['$id', 'key:s', encodeTileColumnHeader(value_plan)].join('\t')
      );
      table.property_rows.forEach((row) => {
        table_lines.push(
          [
            row.object_id,
            escapeTileText(row.key),
            encodeCellForColumnPlan({
              cell: row.value_cell,
              plan: value_plan
            })
          ].join('\t')
        );
      });
      sections.push(table_lines.join('\n'));
      return;
    }

    if (table.kind === 'array') {
      const value_plans = createCellColumnPlan({
        column: 'value',
        cells: table.array_rows.map((row) => row.value_cell)
      });

      table_lines.push(
        ['$id', ...value_plans.map(encodeTileColumnHeader)].join('\t')
      );

      const rows_by_array_id = new Map<string, TileArrayRow[]>();
      table.array_rows.forEach((row) => {
        const rows = rows_by_array_id.get(row.array_id) ?? [];
        rows.push(row);
        rows_by_array_id.set(row.array_id, rows);
      });

      table.array_ids.forEach((array_id) => {
        table_lines.push(array_id);
        const array_rows = rows_by_array_id
          .get(array_id)
          ?.slice()
          .sort((left, right) => left.index - right.index);
        array_rows?.forEach((row) => {
          table_lines.push(
            [
              '',
              ...value_plans.map((plan) =>
                encodeCellForColumnPlan({ cell: row.value_cell, plan })
              )
            ].join('\t')
          );
        });
      });
      sections.push(table_lines.join('\n'));
      return;
    }

    const column_plans = table.columns.flatMap((column) =>
      createCellColumnPlan({
        column,
        cells: table.object_rows.map(
          (row) => row.cells_by_column.get(column) ?? ''
        )
      })
    );

    table_lines.push(
      ['$id', ...column_plans.map(encodeTileColumnHeader)].join('\t')
    );
    table.object_rows.forEach((row) => {
      table_lines.push(
        [
          row.id,
          ...column_plans.map((plan) =>
            encodeCellForColumnPlan({
              cell: row.cells_by_column.get(plan.source_column) ?? '',
              plan
            })
          )
        ].join('\t')
      );
    });
    sections.push(table_lines.join('\n'));
  });

  return sections.join('\n\n');
}
