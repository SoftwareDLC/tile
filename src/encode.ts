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
import type {
  JsonObject,
  JsonTileEncodeOptions,
  JsonTilePathEncodingStrategy,
  JsonValue
} from './types.js';
import type {
  NormalizedJsonTileEncodeOptions,
  TileArrayRow,
  TileTableDraft,
  TileTableKind
} from './codec-internals.js';

type ObjectPathStats = {
  path: string;
  count: number;
  max_compact_chars: number;
  min_key_count: number;
  key_counts: Map<string, number>;
  all_primitive_leaf_objects: boolean;
  has_relation_key: boolean;
};

function collectVisibleSourceTokens(value: JsonValue): Set<string> {
  const tokens = new Set<string>();

  function visit(input: JsonValue): void {
    if (typeof input === 'string') {
      tokens.add(input);
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (isJsonObject(input)) {
      Object.entries(input).forEach(([key, child_value]) => {
        tokens.add(key);
        visit(child_value);
      });
    }
  }

  visit(value);
  return tokens;
}

function isPrimitiveLeafObject(value: JsonObject): boolean {
  return Object.values(value).every(
    (child_value) =>
      child_value === null ||
      typeof child_value === 'string' ||
      typeof child_value === 'number' ||
      typeof child_value === 'boolean'
  );
}

function hasRelationKey(keys: readonly string[]): boolean {
  return keys.some(
    (key) => key === 'id' || key === '$id' || /(?:^|_)id$/i.test(key)
  );
}

function collectObjectPathStats(value: JsonValue): Map<string, ObjectPathStats> {
  const stats_by_path = new Map<string, ObjectPathStats>();

  function visit(input: JsonValue, path: string): void {
    if (Array.isArray(input)) {
      input.forEach((item) => visit(item, `${path}[]`));
      return;
    }

    if (!isJsonObject(input)) {
      return;
    }

    const keys = Object.keys(input);
    const existing = stats_by_path.get(path);
    const stats =
      existing ??
      {
        path,
        count: 0,
        max_compact_chars: 0,
        min_key_count: Number.POSITIVE_INFINITY,
        key_counts: new Map<string, number>(),
        all_primitive_leaf_objects: true,
        has_relation_key: false
      };

    stats.count += 1;
    stats.max_compact_chars = Math.max(
      stats.max_compact_chars,
      JSON.stringify(input).length
    );
    stats.min_key_count = Math.min(stats.min_key_count, keys.length);
    stats.all_primitive_leaf_objects =
      stats.all_primitive_leaf_objects && isPrimitiveLeafObject(input);
    stats.has_relation_key = stats.has_relation_key || hasRelationKey(keys);
    keys.forEach((key) => {
      stats.key_counts.set(key, (stats.key_counts.get(key) ?? 0) + 1);
    });
    stats_by_path.set(path, stats);

    Object.entries(input).forEach(([key, child_value]) => {
      visit(child_value, `${path}${createPathSegment(key)}`);
    });
  }

  visit(value, ROOT_PATH);
  return stats_by_path;
}

function hasClearObjectSchema(stats: ObjectPathStats): boolean {
  if (stats.count < 2) {
    return false;
  }

  const shared_key_count = [...stats.key_counts.values()].filter(
    (count) => count === stats.count
  ).length;
  const overlap_denominator = Math.max(stats.min_key_count, 1);

  return shared_key_count / overlap_denominator >= 0.8;
}

function shouldAutoInlineSmallObject(input: {
  path: string;
  stats: ObjectPathStats;
  options: NormalizedJsonTileEncodeOptions;
}): boolean {
  if (input.path === ROOT_PATH) {
    return false;
  }

  return (
    input.stats.all_primitive_leaf_objects &&
    !input.stats.has_relation_key &&
    !hasClearObjectSchema(input.stats) &&
    input.stats.max_compact_chars <= input.options.inline_small_object_max_chars
  );
}

function createObjectPathPlan(input: {
  stats_by_path: Map<string, ObjectPathStats>;
  options: NormalizedJsonTileEncodeOptions;
}): Map<string, JsonTilePathEncodingStrategy> {
  const plan = new Map<string, JsonTilePathEncodingStrategy>();
  input.stats_by_path.forEach((stats, path) => {
    plan.set(
      path,
      shouldAutoInlineSmallObject({ path, stats, options: input.options })
        ? 'inline_json'
        : 'reference_table'
    );
  });

  Object.entries(input.options.path_rules).forEach(([path, raw_strategy]) => {
    if (
      raw_strategy !== 'auto' &&
      raw_strategy !== 'reference_table' &&
      raw_strategy !== 'inline_json'
    ) {
      throw new Error(
        `Invalid TILE path rule strategy for ${path}: ${String(raw_strategy)}`
      );
    }

    const strategy = raw_strategy;
    if (strategy === 'auto') {
      return;
    }

    if (!input.stats_by_path.has(path)) {
      throw new Error(`TILE path rule references unknown object path: ${path}`);
    }

    plan.set(path, strategy);
  });

  return plan;
}

function encodeInlineJsonCell(value: JsonValue): string {
  return `j:${escapeTileText(JSON.stringify(value))}`;
}

export function encodeJsonToTile(
  value: unknown,
  options: JsonTileEncodeOptions = {}
): string {
  const json_value = validateJsonValue(value);
  const normalized_options = normalizeEncodeOptions(options);
  const visible_source_tokens = collectVisibleSourceTokens(json_value);
  const object_path_plan = createObjectPathPlan({
    stats_by_path: collectObjectPathStats(json_value),
    options: normalized_options
  });
  const tables: TileTableDraft[] = [];
  const table_by_key = new Map<string, TileTableDraft>();
  let properties_table: TileTableDraft | null = null;
  let next_table_number = 0;
  let next_object_row_number = 0;
  let next_array_number = 0;
  let next_properties_object_number = 0;

  function nextGeneratedId(prefix: string, next_number: number): {
    id: string;
    next_number: number;
  } {
    let candidate_number = next_number;
    let id = `${prefix}${candidate_number.toString(36)}`;

    while (visible_source_tokens.has(id)) {
      candidate_number += 1;
      id = `${prefix}${candidate_number.toString(36)}`;
    }

    return { id, next_number: candidate_number + 1 };
  }

  function createTable(kind: TileTableKind, path: string): TileTableDraft {
    const table_key = `${kind}\u0000${path}`;
    const existing_table = table_by_key.get(table_key);
    if (existing_table) {
      return existing_table;
    }
    const next_table_id = nextGeneratedId('t', next_table_number);
    next_table_number = next_table_id.next_number;

    const table: TileTableDraft = {
      id: next_table_id.id,
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
    tables.push(table);
    table_by_key.set(table_key, table);

    return table;
  }

  function getPropertiesTable(): TileTableDraft {
    if (properties_table) {
      return properties_table;
    }

    const next_table_id = nextGeneratedId('t', next_table_number);
    next_table_number = next_table_id.next_number;

    properties_table = {
      id: next_table_id.id,
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
      const next_array_id = nextGeneratedId('a', next_array_number);
      const array_id = next_array_id.id;
      next_array_number = next_array_id.next_number;
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
      if (object_path_plan.get(path) === 'inline_json') {
        return encodeInlineJsonCell(input);
      }

      if (path !== ROOT_PATH && Object.keys(input).length === 1) {
        const table = getPropertiesTable();
        const next_object_id = nextGeneratedId(
          'p',
          next_properties_object_number
        );
        const object_id = next_object_id.id;
        next_properties_object_number = next_object_id.next_number;

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
      const next_row_id = nextGeneratedId('r', next_object_row_number);
      const row_id = next_row_id.id;
      next_object_row_number = next_row_id.next_number;
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
