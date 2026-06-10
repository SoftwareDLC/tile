import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

type ReasoningPromptCase = {
  fixture: string;
  task: string;
  variant: string;
  question: string;
  expected_answer: string;
  prompt: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  prompt_chars_vs_compact_json: number;
};

type ReasoningEvalRow = {
  fixture: string;
  task: string;
  variant: string;
  model: string;
  repeat: number;
  correct: boolean;
  exact_match: boolean;
  contains_expected: boolean;
  latency_ms: number;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  api_input_tokens: number | null;
  api_output_tokens: number | null;
  api_total_tokens: number | null;
  expected_answer: string;
  output_text: string;
};

type ReasoningEvalSummaryRow = {
  fixture: string;
  variant: string;
  model: string;
  cases: number;
  correct: number;
  accuracy: number;
  average_latency_ms: number;
  average_prompt_chars: number;
  average_estimated_prompt_tokens: number;
  average_api_input_tokens: number | null;
  average_api_output_tokens: number | null;
  average_api_total_tokens: number | null;
};

const RESULTS_DIR = new URL('../benchmarks/results/', import.meta.url);
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

function envList(name: string): string[] {
  const value = envString(name);
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function envNumber(name: string, fallback: number): number {
  const value = envString(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive number`);
  }

  return Math.floor(parsed);
}

function envSet(name: string): Set<string> | null {
  const value = envString(name);
  if (!value) {
    return null;
  }

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractResponseText(response_json: unknown): string {
  const response = asRecord(response_json);
  const output_text = asString(response.output_text);
  if (output_text !== null) {
    return output_text.trim();
  }

  return asArray(response.output)
    .flatMap((item) => asArray(asRecord(item).content))
    .map((content) => asString(asRecord(content).text))
    .filter((text): text is string => text !== null)
    .join('\n')
    .trim();
}

function extractUsage(response_json: unknown): {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
} {
  const usage = asRecord(asRecord(response_json).usage);

  return {
    input_tokens: asNumber(usage.input_tokens),
    output_tokens: asNumber(usage.output_tokens),
    total_tokens: asNumber(usage.total_tokens)
  };
}

async function readPromptCases(): Promise<ReasoningPromptCase[]> {
  const text = await readFile(new URL('reasoning-prompts.json', RESULTS_DIR), 'utf8');
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value)) {
    throw new Error('benchmarks/results/reasoning-prompts.json must be an array');
  }

  return value.map((entry) => {
    const row = asRecord(entry);
    const fixture = asString(row.fixture);
    const task = asString(row.task);
    const variant = asString(row.variant);
    const question = asString(row.question);
    const expected_answer = asString(row.expected_answer);
    const prompt = asString(row.prompt);
    const prompt_chars = asNumber(row.prompt_chars);
    const estimated_prompt_tokens = asNumber(row.estimated_prompt_tokens);
    const prompt_chars_vs_compact_json = asNumber(row.prompt_chars_vs_compact_json);

    if (
      !fixture ||
      !task ||
      !variant ||
      !question ||
      !expected_answer ||
      !prompt ||
      prompt_chars === null ||
      estimated_prompt_tokens === null ||
      prompt_chars_vs_compact_json === null
    ) {
      throw new Error('Invalid reasoning prompt case');
    }

    return {
      fixture,
      task,
      variant,
      question,
      expected_answer,
      prompt,
      prompt_chars,
      estimated_prompt_tokens,
      prompt_chars_vs_compact_json
    };
  });
}

function filterPromptCases(cases: ReasoningPromptCase[]): ReasoningPromptCase[] {
  const variants = envSet('TILE_REASONING_VARIANTS');
  const tasks = envSet('TILE_REASONING_TASKS');
  const max_cases = envNumber('TILE_REASONING_MAX_CASES', cases.length);

  return cases
    .filter((entry) => !variants || variants.has(entry.variant))
    .filter((entry) => !tasks || tasks.has(entry.task))
    .slice(0, max_cases);
}

async function callOpenAI(input: {
  api_key: string;
  model: string;
  prompt: string;
}): Promise<{ output_text: string; usage: ReturnType<typeof extractUsage> }> {
  const response = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.api_key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      max_output_tokens: 64,
      store: false
    })
  });

  const response_text = await response.text();
  let response_json: unknown;
  try {
    response_json = JSON.parse(response_text) as unknown;
  } catch {
    response_json = { raw: response_text };
  }

  if (!response.ok) {
    throw new Error(
      `OpenAI response failed with ${String(response.status)}: ${response_text}`
    );
  }

  return {
    output_text: extractResponseText(response_json),
    usage: extractUsage(response_json)
  };
}

async function evaluateCase(input: {
  api_key: string;
  model: string;
  repeat: number;
  prompt_case: ReasoningPromptCase;
}): Promise<ReasoningEvalRow> {
  const started_at = performance.now();
  const result = await callOpenAI({
    api_key: input.api_key,
    model: input.model,
    prompt: input.prompt_case.prompt
  });
  const latency_ms = Math.round(performance.now() - started_at);
  const normalized_output = normalizeAnswer(result.output_text);
  const normalized_expected = normalizeAnswer(input.prompt_case.expected_answer);
  const exact_match = normalized_output === normalized_expected;
  const contains_expected = normalized_output.includes(normalized_expected);

  return {
    fixture: input.prompt_case.fixture,
    task: input.prompt_case.task,
    variant: input.prompt_case.variant,
    model: input.model,
    repeat: input.repeat,
    correct: exact_match || contains_expected,
    exact_match,
    contains_expected,
    latency_ms,
    prompt_chars: input.prompt_case.prompt_chars,
    estimated_prompt_tokens: input.prompt_case.estimated_prompt_tokens,
    api_input_tokens: result.usage.input_tokens,
    api_output_tokens: result.usage.output_tokens,
    api_total_tokens: result.usage.total_tokens,
    expected_answer: input.prompt_case.expected_answer,
    output_text: result.output_text
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeRows(rows: ReasoningEvalRow[]): ReasoningEvalSummaryRow[] {
  const groups = new Map<string, ReasoningEvalRow[]>();
  rows.forEach((row) => {
    const key = [row.fixture, row.variant, row.model].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  });

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) {
      throw new Error('Unexpected empty reasoning eval group');
    }

    return {
      fixture: first.fixture,
      variant: first.variant,
      model: first.model,
      cases: group.length,
      correct: group.filter((row) => row.correct).length,
      accuracy: group.filter((row) => row.correct).length / group.length,
      average_latency_ms: Math.round(average(group.map((row) => row.latency_ms)) ?? 0),
      average_prompt_chars: Math.round(average(group.map((row) => row.prompt_chars)) ?? 0),
      average_estimated_prompt_tokens: Math.round(
        average(group.map((row) => row.estimated_prompt_tokens)) ?? 0
      ),
      average_api_input_tokens: average(
        group
          .map((row) => row.api_input_tokens)
          .filter((value): value is number => value !== null)
      ),
      average_api_output_tokens: average(
        group
          .map((row) => row.api_output_tokens)
          .filter((value): value is number => value !== null)
      ),
      average_api_total_tokens: average(
        group
          .map((row) => row.api_total_tokens)
          .filter((value): value is number => value !== null)
      )
    };
  });
}

function formatNumber(value: number | null): string {
  return value === null ? '' : Math.round(value).toLocaleString();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function markdownSummary(rows: ReasoningEvalSummaryRow[]): string {
  return [
    '| Fixture | Variant | Model | Cases | Accuracy | Avg latency ms | Avg API input tokens | Avg API output tokens |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) =>
      [
        row.fixture,
        row.variant,
        row.model,
        row.cases.toLocaleString(),
        formatPercent(row.accuracy),
        row.average_latency_ms.toLocaleString(),
        formatNumber(row.average_api_input_tokens),
        formatNumber(row.average_api_output_tokens)
      ].join(' | ')
    )
  ].join('\n');
}

async function main(): Promise<void> {
  loadDotEnvLocal();

  const api_key = envString('OPENAI_API_KEY') ?? envString('OPEN_AI_KEY');
  const models = [
    ...envList('TILE_REASONING_MODELS'),
    ...envList('TILE_REASONING_MODEL')
  ];
  if (!api_key) {
    throw new Error(
      'OPENAI_API_KEY or OPEN_AI_KEY is required for benchmark:reasoning'
    );
  }

  if (models.length === 0) {
    throw new Error(
      'TILE_REASONING_MODEL or TILE_REASONING_MODELS is required for benchmark:reasoning'
    );
  }

  const repeats = envNumber('TILE_REASONING_REPEATS', 1);
  const prompt_cases = filterPromptCases(await readPromptCases());
  const rows: ReasoningEvalRow[] = [];

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (const model of models) {
      for (const prompt_case of prompt_cases) {
        rows.push(
          await evaluateCase({
            api_key,
            model,
            repeat,
            prompt_case
          })
        );
      }
    }
  }

  const summary = summarizeRows(rows);
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    new URL('reasoning-performance.json', RESULTS_DIR),
    `${JSON.stringify({ rows, summary }, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-performance.md', RESULTS_DIR),
    `${markdownSummary(summary)}\n`
  );
}

await main();
