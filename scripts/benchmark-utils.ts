import type {
  JsonTileEncodeOptions,
  JsonTileFirstClassCell,
  JsonValue
} from '../src/index.js';

export type JsonObject = { [key: string]: JsonValue };

export type Fixture = {
  id: string;
  label: string;
  path: string;
};

export type EncodedVariant = {
  id: string;
  label: string;
  text: string;
};

export type SizeRow = {
  fixture: string;
  variant: string;
  chars: number;
  estimated_tokens: number;
  chars_vs_compact_json: number;
};

export type ReasoningTask = {
  fixture: string;
  id: string;
  question: string;
  expected_answer: string;
  perceived_difficulty: 1 | 2 | 3 | 4 | 5;
  difficulty_label: string;
  difficulty_reason: string;
};

export type ReasoningRow = {
  fixture_id: string;
  fixture: string;
  task: string;
  perceived_difficulty: number;
  difficulty_label: string;
  variant_id: string;
  variant: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  prompt_chars_vs_compact_json: number;
};

export type ReasoningContext = {
  fixture_id: string;
  fixture: string;
  variant_id: string;
  variant: string;
  text: string;
  chars: number;
  estimated_tokens: number;
  chars_vs_compact_json: number;
};

export type ReasoningCase = ReasoningRow;

export type ReasoningPromptCase = ReasoningCase & {
  question: string;
  expected_answer: string;
  prompt: string;
};

export const FIXTURES: Fixture[] = [
  {
    id: 'openstreetmap_extract',
    label: 'OpenStreetMap extract',
    path: 'openstreetmap-extract.json'
  },
  {
    id: 'wikidata_truthy_triples',
    label: 'Wikidata truthy triples',
    path: 'wikidata-triples.json'
  },
  {
    id: 'musicbrainz_release_groups',
    label: 'MusicBrainz release groups',
    path: 'musicbrainz-release-groups.json'
  },
  {
    id: 'npm_dependency_metadata',
    label: 'npm dependency metadata',
    path: 'npm-dependencies.json'
  }
];


export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function asObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

export function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function normalizedTileOptions(fixture_id: string): JsonTileEncodeOptions {
  if (fixture_id === 'openstreetmap_extract') {
    return {
      object_table_strategy: 'normalized_shape',
      path_rules: {
        'root.nodes[].tags': 'inline_json',
        'root.ways[].tags': 'inline_json'
      },
      normalized_min_shared_keys: 2,
      normalized_min_overlap_ratio: 0.3
    };
  }

  return {
    object_table_strategy: 'normalized_shape'
  };
}

export function firstClassCell(value: JsonValue | undefined): JsonTileFirstClassCell {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    typeof value === 'undefined'
  ) {
    return value;
  }

  return JSON.stringify(value);
}

export function continuationCell(index: number, value: JsonValue | undefined): JsonTileFirstClassCell {
  return index === 0 ? firstClassCell(value) : undefined;
}

export function joinAnswer(values: readonly (string | number)[]): string {
  return values.map((value) => String(value)).join('|');
}

export function sortStrings(values: string[]): string[] {
  return values.sort((left, right) => left.localeCompare(right));
}
