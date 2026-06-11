import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type PathStats = {
  path: string;
  occurrences: number;
  types: Set<string>;
  scalar_examples: string[];
  object_key_sets: Map<string, number>;
  array_lengths: number[];
};

type CliOptions = {
  input_path: string;
  output_path: string;
  max_sample_chars: number;
  call_model: boolean;
};

const DEFAULT_MAX_SAMPLE_CHARS = 24_000;
const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

function loadDotEnvLocal(): void {
  const env_path = new URL('../.env.local', import.meta.url);
  if (!existsSync(env_path)) {
    return;
  }

  const text = readFileSync(env_path, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      return;
    }

    const separator_index = trimmed.indexOf('=');
    if (separator_index === -1) {
      return;
    }

    const key = trimmed.slice(0, separator_index).trim();
    const raw_value = trimmed.slice(separator_index + 1).trim();
    if (!key || process.env[key]) {
      return;
    }

    process.env[key] = raw_value.replace(/^['"]|['"]$/g, '');
  });
}

function envString(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return Math.floor(parsed);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const input_path = args.shift();
  if (!input_path || input_path.startsWith('-')) {
    throw new Error(
      [
        'Usage: pnpm harness:design <sample.json> [--out <design.md>]',
        '       [--max-sample-chars <chars>] [--call-model]'
      ].join('\n')
    );
  }

  let output_path = `artifacts/tile-harness/${basename(input_path, '.json')}.md`;
  let max_sample_chars = DEFAULT_MAX_SAMPLE_CHARS;
  let call_model = false;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === '--out') {
      const value = args.shift();
      if (!value) {
        throw new Error('--out requires a path');
      }
      output_path = value;
    } else if (flag === '--max-sample-chars') {
      const value = args.shift();
      if (!value) {
        throw new Error('--max-sample-chars requires a number');
      }
      max_sample_chars = parsePositiveInt(value, '--max-sample-chars');
    } else if (flag === '--call-model') {
      call_model = true;
    } else {
      throw new Error(`Unknown argument: ${String(flag)}`);
    }
  }

  return {
    input_path,
    output_path,
    max_sample_chars,
    call_model
  };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value: JsonValue): string {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function scalarPreview(value: JsonValue): string | null {
  if (Array.isArray(value) || isJsonObject(value)) {
    return null;
  }

  return JSON.stringify(value);
}

function statsForPath(stats_by_path: Map<string, PathStats>, path: string): PathStats {
  const existing = stats_by_path.get(path);
  if (existing) {
    return existing;
  }

  const created: PathStats = {
    path,
    occurrences: 0,
    types: new Set<string>(),
    scalar_examples: [],
    object_key_sets: new Map<string, number>(),
    array_lengths: []
  };
  stats_by_path.set(path, created);
  return created;
}

function observeValue(
  stats_by_path: Map<string, PathStats>,
  path: string,
  value: JsonValue
): void {
  const stats = statsForPath(stats_by_path, path);
  stats.occurrences += 1;
  stats.types.add(valueType(value));

  const preview = scalarPreview(value);
  if (preview !== null && stats.scalar_examples.length < 4) {
    stats.scalar_examples.push(preview);
  }

  if (Array.isArray(value)) {
    stats.array_lengths.push(value.length);
    value.forEach((entry, index) => {
      const child_path = isJsonObject(entry)
        ? `${path}[]`
        : `${path}[${String(index)}]`;
      observeValue(stats_by_path, child_path, entry);
    });
  } else if (isJsonObject(value)) {
    const keys = Object.keys(value).sort();
    const signature = keys.join(',');
    stats.object_key_sets.set(
      signature,
      (stats.object_key_sets.get(signature) ?? 0) + 1
    );
    Object.entries(value).forEach(([key, child]) => {
      observeValue(stats_by_path, `${path}.${key}`, child);
    });
  }
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio))
  );
  return sorted[index] ?? 0;
}

function topStats(stats_by_path: Map<string, PathStats>): PathStats[] {
  return [...stats_by_path.values()]
    .filter((stats) => stats.path !== '$')
    .sort((left, right) => {
      const occurrence_delta = right.occurrences - left.occurrences;
      if (occurrence_delta !== 0) {
        return occurrence_delta;
      }

      return left.path.localeCompare(right.path);
    })
    .slice(0, 80);
}

function renderStats(stats_by_path: Map<string, PathStats>): string {
  const rows = topStats(stats_by_path).map((stats) => {
    const types = [...stats.types].sort().join('|');
    const array_summary =
      stats.array_lengths.length > 0
        ? ` arrays n=${stats.array_lengths.length} p50=${percentile(
            stats.array_lengths,
            0.5
          )} p95=${percentile(stats.array_lengths, 0.95)} max=${Math.max(
            ...stats.array_lengths
          )}`
        : '';
    const object_shapes =
      stats.object_key_sets.size > 0
        ? ` shapes=${[...stats.object_key_sets.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([shape, count]) => `${count}x{${shape}}`)
            .join(' ')}`
        : '';
    const examples =
      stats.scalar_examples.length > 0
        ? ` examples=${stats.scalar_examples.join(', ')}`
        : '';

    return `- ${stats.path}: ${stats.occurrences}x ${types}${array_summary}${object_shapes}${examples}`;
  });

  return rows.join('\n');
}

function truncateSample(text: string, max_chars: number): string {
  if (text.length <= max_chars) {
    return text;
  }

  return `${text.slice(0, max_chars)}\n/* truncated: ${String(
    text.length - max_chars
  )} chars omitted */`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildHarnessPrompt(input: {
  input_path: string;
  json_text: string;
  compact_chars: number;
  pretty_chars: number;
  stats_markdown: string;
  max_sample_chars: number;
}): string {
  return [
    '# TILE First-Class Projection Design Harness',
    '',
    'You are designing a TILE projection for a user-owned JSON dataset.',
    'TILE supports two important modes:',
    '',
    '- `encodeJsonToTile(value, options?)` for lossless path-like JSON-to-TILE output. It can use `path_rules` such as `{ "root.events[].metadata": "inline_json" }` or `{ "root.events[].actor": "reference_table" }` when caller knowledge should override the automatic planner.',
    '- `encodeFirstClassTablesToTile({ tables, delimiter })` for caller-designed tables. A table column can be an embedded child group using `{ embedded_columns: [...] }`; subsequent rows can leave parent cells blank to visually keep repeated child rows local to the parent. Supported delimiters are `tab`, `pipe`, `comma`, and `space`; `tab` is the default, but `pipe` can be worth benchmarking for short, dense first-class rows.',
    '',
    'Your job is not to write final production code yet. Your job is to design the projection that a developer should implement for this specific data shape.',
    '',
    '## Dataset',
    '',
    `- Path: ${input.input_path}`,
    `- Compact JSON chars: ${input.compact_chars.toLocaleString()}`,
    `- Pretty JSON chars: ${input.pretty_chars.toLocaleString()}`,
    '',
    '## Observed Shape Profile',
    '',
    input.stats_markdown,
    '',
    '## Sample JSON',
    '',
    '```json',
    truncateSample(input.json_text, input.max_sample_chars),
    '```',
    '',
    '## Design Tasks',
    '',
    'Return a concise design document with these sections:',
    '',
    '1. **Question Families**: What user questions should this projection optimize for? Include broad lookup, grouping, joins, local adjacency, sibling ordering, and anti-goals. Treat these questions as the contract the first-class projection must satisfy.',
    '2. **Recommended Encoding**: Choose path TILE, normalized TILE, first-class relational TILE, first-class embedded TILE, automatic TILE with path rules, or a hybrid. Explain why.',
    '3. **Automatic TILE Path Rules**: Propose `path_rules` for `inline_json` vs `reference_table`. Use inline JSON for small/dynamic leaf maps that should stay local, such as metadata or tag bags. Use referenced tables for stable entities, nested structures, or relation-heavy objects.',
    '4. **Properties Table vs Inline JSON**: Identify wrapper or dynamic-key objects. Explain which should remain key/value properties rows and which should become a single inline JSON cell.',
    '5. **First-Class Tables**: Propose table ids, columns, row grain, source paths, and stable original ids. For each table, name the question families it supports and the evidence path it preserves. Never replace user-visible ids with internal row ids when questions ask for original ids.',
    '6. **Embedded Child Groups**: Identify child arrays or edge lists that should be embedded under parent rows. Explain the local jump each embedded group enables, such as parent tags plus ordered child rows or consecutive refs.',
    '7. **Delimiter Plan**: Recommend delimiter variants to test for the proposed first-class tables. Include `tab` and `pipe` unless there is a dataset-specific reason not to.',
    '8. **Projection Pseudocode**: Sketch TypeScript-style code for both automatic TILE options and `JsonTileFirstClassTable[]` where relevant, including delimiter variants to benchmark.',
    '9. **Semantic Answer Benchmarks**: Propose 6-10 questions a model should naturally answer from structured context, such as classification, labeling, thematic grouping, or interpreting tags/claims/titles/package roles. For each, describe the exact evidence path and which proposed projection preserves it. Do not benchmark a first-class projection on questions it was not designed to answer.',
    '10. **Function-Generation Benchmarks**: Propose deterministic retrieval/scoring tasks where the model should write a function instead of mentally scanning the data. Include graph traversal, extrema, numeric tie-breakers, geospatial math, adjacency scans, or exact joins when relevant. Explain how to execute and grade the generated function against an oracle.',
    '11. **Benchmark Method**: Explain how to compare compact JSON, path TILE, path-rules TILE, first-class relational, first-class embedded, and delimiter variants on prompt size and answer quality. Keep exact-answer semantic grading separate from executable function grading, and keep question/projection pairs aligned.',
    '12. **Risk Checks**: List information that must not be dropped, including labels, ids, ordering columns, counts, tie-breakers, null handling, and provenance.',
    '',
    'Be specific to this dataset. Prefer simple tables over clever compression unless the question family clearly benefits.'
  ].join('\n');
}

function extractResponseText(response_json: unknown): string {
  const response = asRecord(response_json);
  const output_text = response.output_text;
  if (typeof output_text === 'string') {
    return output_text.trim();
  }

  return asArray(response.output)
    .flatMap((item) => asArray(asRecord(item).content))
    .map((content) => {
      const text = asRecord(content).text;
      return typeof text === 'string' ? text : '';
    })
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();
}

async function callModel(input: {
  api_key: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const response = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.api_key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      max_output_tokens: 2400,
      store: false
    })
  });
  const response_text = await response.text();
  let response_json: unknown;

  try {
    response_json = JSON.parse(response_text) as unknown;
  } catch {
    throw new Error(`OpenAI returned non-JSON response: ${response_text}`);
  }

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response_text}`);
  }

  const output_text = extractResponseText(response_json);
  if (!output_text) {
    throw new Error(`OpenAI returned an empty response: ${response_text}`);
  }

  return output_text;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const options = parseArgs(process.argv.slice(2));
  const input_path = resolve(options.input_path);
  const output_path = resolve(options.output_path);
  const json_text = await readFile(input_path, 'utf8');
  const value = JSON.parse(json_text) as JsonValue;
  const compact_text = JSON.stringify(value);
  const pretty_text = JSON.stringify(value, null, 2);
  const stats_by_path = new Map<string, PathStats>();
  observeValue(stats_by_path, '$', value);

  const prompt = buildHarnessPrompt({
    input_path,
    json_text: pretty_text,
    compact_chars: compact_text.length,
    pretty_chars: pretty_text.length,
    stats_markdown: renderStats(stats_by_path),
    max_sample_chars: options.max_sample_chars
  });

  let model_output = '';
  if (options.call_model) {
    const api_key = envString('OPENAI_API_KEY') ?? envString('OPEN_AI_KEY');
    const model = envString('TILE_HARNESS_MODEL');
    if (!api_key || !model) {
      throw new Error(
        '--call-model requires OPENAI_API_KEY or OPEN_AI_KEY and TILE_HARNESS_MODEL'
      );
    }

    model_output = await callModel({ api_key, model, prompt });
  }

  const document = [
    '# TILE Projection Harness Output',
    '',
    model_output
      ? '## Model Design'
      : '## Prompt',
    '',
    model_output || prompt,
    '',
    model_output ? '## Prompt Used' : '',
    model_output ? '' : '',
    model_output ? prompt : ''
  ]
    .filter((part) => part.length > 0)
    .join('\n');

  await mkdir(dirname(output_path), { recursive: true });
  await writeFile(output_path, `${document}\n`);
  console.log(`Wrote ${output_path}`);
}

await main();
