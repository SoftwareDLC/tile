import { validateJsonValue } from './codec-internals.js';
import { encodeJsonToTile } from './encode.js';
import type { JsonTileEncodeOptions, JsonTileSizeComparison } from './types.js';

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function compareJsonTileSize(
  value: unknown,
  options: JsonTileEncodeOptions = {}
): JsonTileSizeComparison {
  const json_value = validateJsonValue(value);
  const compact_json = JSON.stringify(json_value);
  const pretty_json = JSON.stringify(json_value, null, 2);
  const tile = encodeJsonToTile(json_value, options);

  return {
    compact_json_chars: compact_json.length,
    pretty_json_chars: pretty_json.length,
    tile_chars: tile.length,
    estimated_compact_json_tokens: estimateTokenCount(compact_json),
    estimated_pretty_json_tokens: estimateTokenCount(pretty_json),
    estimated_tile_tokens: estimateTokenCount(tile),
    tile_vs_compact_json_ratio: tile.length / compact_json.length,
    tile_vs_pretty_json_ratio: tile.length / pretty_json.length
  };
}
