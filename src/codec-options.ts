import {
  DEFAULT_NORMALIZED_MAX_COLUMNS,
  DEFAULT_NORMALIZED_MAX_PATHS,
  DEFAULT_NORMALIZED_MIN_OVERLAP_RATIO,
  DEFAULT_NORMALIZED_MIN_SHARED_KEYS
} from './codec-constants.js';
import type { JsonTileEncodeOptions } from './types.js';
import type {
  NormalizedJsonTileEncodeOptions,
  TileTableDraft,
  TileTableKind
} from './codec-types.js';

export function createPathSegment(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;
}

export function normalizeEncodeOptions(
  options: JsonTileEncodeOptions
): NormalizedJsonTileEncodeOptions {
  return {
    object_table_strategy: options.object_table_strategy ?? 'path',
    normalized_min_shared_keys:
      options.normalized_min_shared_keys ?? DEFAULT_NORMALIZED_MIN_SHARED_KEYS,
    normalized_min_overlap_ratio:
      options.normalized_min_overlap_ratio ??
      DEFAULT_NORMALIZED_MIN_OVERLAP_RATIO,
    normalized_max_columns:
      options.normalized_max_columns ?? DEFAULT_NORMALIZED_MAX_COLUMNS,
    normalized_max_paths:
      options.normalized_max_paths ?? DEFAULT_NORMALIZED_MAX_PATHS
  };
}

export function isTileTableKind(
  value: string | undefined
): value is TileTableKind {
  return value === 'object' || value === 'array' || value === 'properties';
}

export function addTablePath(table: TileTableDraft, path: string): void {
  if (table.path_set.has(path)) {
    return;
  }

  table.path_set.add(path);
  table.paths.push(path);
  table.path = table.paths.join('|');
}

function countSharedKeys(left: Set<string>, right: Set<string>): number {
  let shared_count = 0;
  left.forEach((key) => {
    if (right.has(key)) {
      shared_count += 1;
    }
  });

  return shared_count;
}

export function canMergeObjectKeys(input: {
  keys: Set<string>;
  table: TileTableDraft;
  options: NormalizedJsonTileEncodeOptions;
}): boolean {
  if (input.keys.size === 0 || input.table.column_set.size === 0) {
    return false;
  }

  const union_keys = new Set([...input.table.column_set, ...input.keys]);
  if (union_keys.size > input.options.normalized_max_columns) {
    return false;
  }

  if (input.table.paths.length >= input.options.normalized_max_paths) {
    return false;
  }

  const shared_count = countSharedKeys(input.keys, input.table.column_set);
  const overlap_denominator = Math.min(
    input.keys.size,
    input.table.column_set.size
  );
  const overlap_ratio =
    overlap_denominator === 0 ? 0 : shared_count / overlap_denominator;

  return (
    shared_count >= input.options.normalized_min_shared_keys &&
    overlap_ratio >= input.options.normalized_min_overlap_ratio
  );
}
