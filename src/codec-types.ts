import type {
  JsonTileObjectTableStrategy,
  JsonTilePathEncodingStrategy
} from './types.js';

export type TileTableKind = 'object' | 'array' | 'properties';
export type TilePrimitiveType = 's' | 'n' | 'b' | 'z' | 'j';

export type TileObjectRow = {
  id: string;
  cells_by_column: Map<string, string>;
};

export type TileArrayRow = {
  array_id: string;
  index: number;
  value_cell: string;
};

export type TilePropertyRow = {
  object_id: string;
  key: string;
  value_cell: string;
};

export type TileTableDraft = {
  id: string;
  kind: TileTableKind;
  path: string;
  paths: string[];
  path_set: Set<string>;
  columns: string[];
  column_set: Set<string>;
  array_ids: string[];
  object_rows: TileObjectRow[];
  array_rows: TileArrayRow[];
  property_rows: TilePropertyRow[];
};

export type ParsedTileTable = {
  id: string;
  kind: TileTableKind;
  path: string;
  columns: ParsedTileColumn[];
  rows: string[][];
};

export type ParsedTileColumn = {
  name: string;
  ref_table_id: string | null;
  primitive_type: TilePrimitiveType | null;
};

export type TileRefCell = {
  table_id: string;
  row_id: string;
};

export type TilePrimitiveCell = {
  primitive_type: TilePrimitiveType;
  payload: string;
};

export type TileOutputColumnPlan = {
  name: string;
  source_column: string;
  ref_table_id: string | null;
  primitive_type: TilePrimitiveType | null;
};

export type NormalizedJsonTileEncodeOptions = {
  object_table_strategy: JsonTileObjectTableStrategy;
  path_rules: Readonly<Record<string, JsonTilePathEncodingStrategy>>;
  inline_small_object_max_chars: number;
  normalized_min_shared_keys: number;
  normalized_min_overlap_ratio: number;
  normalized_max_columns: number;
  normalized_max_paths: number;
};
