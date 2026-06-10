export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = {
  [key: string]: JsonValue;
};

export type JsonTileSizeComparison = {
  compact_json_chars: number;
  pretty_json_chars: number;
  tile_chars: number;
  estimated_compact_json_tokens: number;
  estimated_pretty_json_tokens: number;
  estimated_tile_tokens: number;
  tile_vs_compact_json_ratio: number;
  tile_vs_pretty_json_ratio: number;
};

export type JsonTileObjectTableStrategy = 'path' | 'normalized_shape';

export type JsonTileEncodeOptions = {
  object_table_strategy?: JsonTileObjectTableStrategy;
  normalized_min_shared_keys?: number;
  normalized_min_overlap_ratio?: number;
  normalized_max_columns?: number;
  normalized_max_paths?: number;
};

export type JsonTileFirstClassCell =
  | string
  | number
  | boolean
  | null
  | undefined;

export type JsonTileFirstClassEmbeddedColumns = {
  embedded_columns: readonly string[];
};

export type JsonTileFirstClassColumn =
  | string
  | JsonTileFirstClassEmbeddedColumns;

export type JsonTileFirstClassTable = {
  id: string;
  kind?: string;
  path?: string;
  columns: readonly JsonTileFirstClassColumn[];
  rows: readonly (readonly JsonTileFirstClassCell[])[];
};

export type JsonTileDelimiter = 'tab' | 'comma' | 'pipe' | 'space';

export type JsonTileFirstClassDocument = {
  tables: readonly JsonTileFirstClassTable[];
  delimiter?: JsonTileDelimiter;
};
