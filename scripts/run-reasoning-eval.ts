import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

type ReasoningPromptCase = {
  fixture_id: string;
  fixture: string;
  task: string;
  task_kind: string;
  evaluation_mode: string;
  variant_id: string;
  variant: string;
  question: string;
  expected_answer: string;
  prompt: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  prompt_chars_vs_compact_json: number;
};

type ReasoningTask = {
  fixture: string;
  id: string;
  task_kind: string;
  evaluation_mode: string;
  question: string;
  expected_answer: string;
  perceived_difficulty: number;
  difficulty_label: string;
};

type ReasoningContext = {
  fixture_id: string;
  fixture: string;
  variant_id: string;
  variant: string;
  text: string;
};

type ReasoningCase = {
  fixture_id: string;
  fixture: string;
  task: string;
  task_kind: string;
  evaluation_mode: string;
  variant_id: string;
  variant: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  prompt_chars_vs_compact_json: number;
};

type ReasoningEvalRow = {
  fixture: string;
  task: string;
  task_kind: string;
  evaluation_mode: string;
  variant_id: string;
  variant: string;
  model: string;
  repeat: number;
  correct: boolean;
  exact_match: boolean;
  contains_expected: boolean;
  list_precision: number | null;
  list_recall: number | null;
  list_f1: number | null;
  latency_ms: number;
  prompt_chars: number;
  estimated_prompt_tokens: number;
  prompt_chars_vs_compact_json: number;
  api_input_tokens: number | null;
  api_output_tokens: number | null;
  api_total_tokens: number | null;
  expected_answer: string;
  output_text: string;
};

type ReasoningEvalSummaryRow = {
  fixture: string;
  task_kind: string;
  evaluation_mode: string;
  variant_id: string;
  variant: string;
  model: string;
  cases: number;
  correct: number;
  accuracy: number;
  exact_matches: number;
  exact_match_rate: number;
  average_latency_ms: number;
  average_prompt_chars: number;
  average_estimated_prompt_tokens: number;
  average_prompt_chars_vs_compact_json: number;
  average_list_f1: number | null;
  list_f1_points_per_1k_input_tokens: number | null;
  average_api_input_tokens: number | null;
  api_input_tokens_vs_compact_json: number | null;
  average_api_output_tokens: number | null;
  average_api_total_tokens: number | null;
};

type CliOptions = {
  help: boolean;
  models: string[];
  variant_ids: string[];
  variants: string[];
  task_ids: string[];
  max_cases: number | null;
  repeats: number | null;
  max_output_tokens: number | null;
};

const RESULTS_DIR = new URL('../benchmarks/results/', import.meta.url);
const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_TASK_KIND = 'semantic_answer';
const DEFAULT_EVALUATION_MODE = 'list_f1_exact_answer';
const USAGE = `Usage:
  pnpm benchmark:reasoning -- --model <model> [options]

Recommended:
  Run narrow slices with --variant-ids and --task-ids first. Large fixtures can
  hit API token-per-minute limits when every generated case is evaluated at once.

Options:
  --model <id>          Model id to evaluate. Can be repeated or comma-separated.
  --models <ids>        Comma-separated model ids.
  --variant-ids <ids>   Variant ids to include, e.g. tile_normalized.
  --variant-id <id>     Single variant id. Can be repeated.
  --variants <labels>   Variant labels to include, e.g. "TILE normalized".
  --task-ids <ids>      Task ids to include. Can be comma-separated.
  --task-id <id>        Single task id. Can be repeated.
  --max-cases <n>       Limit evaluated prompt cases after filtering.
  --repeats <n>         Number of repeats per selected case.
  --max-output-tokens <n>
                       Maximum response tokens per case. Defaults to 512.
  --help                Show this help text.

Environment fallback:
  OPENAI_API_KEY or OPEN_AI_KEY is still required.
  TILE_REASONING_MODEL(S), TILE_REASONING_VARIANT_IDS, TILE_REASONING_VARIANTS,
  TILE_REASONING_TASKS, TILE_REASONING_MAX_CASES, TILE_REASONING_REPEATS, and
  TILE_REASONING_MAX_OUTPUT_TOKENS are used only when the corresponding flag is
  omitted.
`;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePositiveInteger(input: {
  name: string;
  value: string;
}): number {
  const parsed = Number(input.value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${input.name} must be a positive number`);
  }

  return Math.floor(parsed);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    models: [],
    variant_ids: [],
    variants: [],
    task_ids: [],
    max_cases: null,
    repeats: null,
    max_output_tokens: null
  };
  const args = [...argv];

  function readValue(flag: string): string {
    const value = args.shift();
    if (!value) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  }

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      continue;
    }

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--model' || arg === '--models') {
      options.models.push(...splitList(readValue(arg)));
      continue;
    }

    if (arg === '--variant-id' || arg === '--variant-ids') {
      options.variant_ids.push(...splitList(readValue(arg)));
      continue;
    }

    if (arg === '--variant' || arg === '--variants') {
      options.variants.push(...splitList(readValue(arg)));
      continue;
    }

    if (arg === '--task-id' || arg === '--task-ids') {
      options.task_ids.push(...splitList(readValue(arg)));
      continue;
    }

    if (arg === '--max-cases') {
      options.max_cases = parsePositiveInteger({
        name: arg,
        value: readValue(arg)
      });
      continue;
    }

    if (arg === '--repeats') {
      options.repeats = parsePositiveInteger({
        name: arg,
        value: readValue(arg)
      });
      continue;
    }

    if (arg === '--max-output-tokens') {
      options.max_output_tokens = parsePositiveInteger({
        name: arg,
        value: readValue(arg)
      });
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

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

  return splitList(value);
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

  return new Set(splitList(value));
}

function listSet(values: readonly string[]): Set<string> | null {
  return values.length > 0 ? new Set(values) : null;
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

function splitLineAnswer(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => normalizeAnswer(entry))
    .filter((entry) => entry.length > 0);
}

function listMetrics(input: {
  expected_answer: string;
  output_text: string;
}): {
  precision: number;
  recall: number;
  f1: number;
} | null {
  if (!input.expected_answer.includes('\n')) {
    return null;
  }

  const expected = new Set(splitLineAnswer(input.expected_answer));
  const output = new Set(splitLineAnswer(input.output_text));
  const true_positive_count = [...output].filter((entry) =>
    expected.has(entry)
  ).length;
  const precision =
    output.size > 0 ? true_positive_count / output.size : 0;
  const recall =
    expected.size > 0 ? true_positive_count / expected.size : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  return { precision, recall, f1 };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(input: {
  response_status: number;
  response_text: string;
  attempt: number;
}): number | null {
  if (input.response_status !== 429 && input.response_status < 500) {
    return null;
  }

  const retry_seconds = input.response_text.match(/try again in ([\d.]+)s/i);
  if (retry_seconds?.[1]) {
    return Math.ceil(Number(retry_seconds[1]) * 1000) + 1000;
  }

  return Math.min(30_000, 2 ** input.attempt * 1000);
}

function buildPrompt(input: {
  context: Pick<ReasoningContext, 'variant' | 'text'>;
  task: Pick<ReasoningTask, 'question'>;
}): string {
  return [
    'Answer the question using only the structured dataset below.',
    `Dataset format: ${input.context.variant}`,
    '',
    input.context.text,
    '',
    `Question: ${input.task.question}`,
    'Answer with the shortest exact answer.'
  ].join('\n');
}

async function readJsonArray(input: {
  filename: string;
}): Promise<unknown[]> {
  const text = await readFile(new URL(input.filename, RESULTS_DIR), 'utf8');
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value)) {
    throw new Error(`benchmarks/results/${input.filename} must be an array`);
  }

  return value as unknown[];
}

async function readTasks(): Promise<ReasoningTask[]> {
  return (await readJsonArray({
    filename: 'reasoning-tasks.json'
  })).map((entry) => {
    const row = asRecord(entry);
    const fixture = asString(row.fixture);
    const id = asString(row.id);
    const task_kind = asString(row.task_kind) ?? DEFAULT_TASK_KIND;
    const evaluation_mode =
      asString(row.evaluation_mode) ?? DEFAULT_EVALUATION_MODE;
    const question = asString(row.question);
    const expected_answer = asString(row.expected_answer);
    const perceived_difficulty = asNumber(row.perceived_difficulty);
    const difficulty_label = asString(row.difficulty_label);

    if (
      !fixture ||
      !id ||
      question === null ||
      expected_answer === null ||
      perceived_difficulty === null ||
      difficulty_label === null
    ) {
      throw new Error('Invalid reasoning task');
    }

    return {
      fixture,
      id,
      task_kind,
      evaluation_mode,
      question,
      expected_answer,
      perceived_difficulty,
      difficulty_label
    };
  });
}

async function readContexts(): Promise<ReasoningContext[]> {
  return (await readJsonArray({
    filename: 'reasoning-contexts.json'
  })).map((entry) => {
    const row = asRecord(entry);
    const fixture_id = asString(row.fixture_id);
    const fixture = asString(row.fixture);
    const variant_id = asString(row.variant_id);
    const variant = asString(row.variant);
    const text = asString(row.text);

    if (!fixture_id || !fixture || !variant_id || !variant || text === null) {
      throw new Error('Invalid reasoning context');
    }

    return {
      fixture_id,
      fixture,
      variant_id,
      variant,
      text
    };
  });
}

async function readCases(): Promise<ReasoningCase[]> {
  return (await readJsonArray({
    filename: 'reasoning-cases.json'
  })).map((entry) => {
    const row = asRecord(entry);
    const fixture_id = asString(row.fixture_id);
    const fixture = asString(row.fixture);
    const task = asString(row.task);
    const task_kind = asString(row.task_kind) ?? DEFAULT_TASK_KIND;
    const evaluation_mode =
      asString(row.evaluation_mode) ?? DEFAULT_EVALUATION_MODE;
    const variant_id = asString(row.variant_id);
    const variant = asString(row.variant);
    const prompt_chars = asNumber(row.prompt_chars);
    const estimated_prompt_tokens = asNumber(row.estimated_prompt_tokens);
    const prompt_chars_vs_compact_json = asNumber(row.prompt_chars_vs_compact_json);

    if (
      !fixture_id ||
      !fixture ||
      !task ||
      !variant_id ||
      !variant ||
      prompt_chars === null ||
      estimated_prompt_tokens === null ||
      prompt_chars_vs_compact_json === null
    ) {
      throw new Error('Invalid reasoning case');
    }

    return {
      fixture_id,
      fixture,
      task,
      task_kind,
      evaluation_mode,
      variant_id,
      variant,
      prompt_chars,
      estimated_prompt_tokens,
      prompt_chars_vs_compact_json
    };
  });
}

async function readPromptCases(): Promise<ReasoningPromptCase[]> {
  const [tasks, contexts, cases] = await Promise.all([
    readTasks(),
    readContexts(),
    readCases()
  ]);
  const tasks_by_key = new Map(
    tasks.map((task) => [[task.fixture, task.id].join('\u0000'), task])
  );
  const contexts_by_key = new Map(
    contexts.map((context) => [
      [context.fixture_id, context.variant_id].join('\u0000'),
      context
    ])
  );

  return cases.map((prompt_case) => {
    const task = tasks_by_key.get(
      [prompt_case.fixture_id, prompt_case.task].join('\u0000')
    );
    if (!task) {
      throw new Error(
        `Missing task ${prompt_case.fixture_id} / ${prompt_case.task}`
      );
    }

    const context = contexts_by_key.get(
      [prompt_case.fixture_id, prompt_case.variant_id].join('\u0000')
    );
    if (!context) {
      throw new Error(
        `Missing context ${prompt_case.fixture_id} / ${prompt_case.variant_id}`
      );
    }

    return {
      ...prompt_case,
      task_kind: prompt_case.task_kind || task.task_kind,
      evaluation_mode: prompt_case.evaluation_mode || task.evaluation_mode,
      question: task.question,
      expected_answer: task.expected_answer,
      prompt: buildPrompt({ context, task })
    };
  });
}

function filterPromptCases(
  cases: ReasoningPromptCase[],
  options: CliOptions
): ReasoningPromptCase[] {
  const variant_ids =
    listSet(options.variant_ids) ?? envSet('TILE_REASONING_VARIANT_IDS');
  const variants = listSet(options.variants) ?? envSet('TILE_REASONING_VARIANTS');
  const tasks = listSet(options.task_ids) ?? envSet('TILE_REASONING_TASKS');
  const max_cases =
    options.max_cases ?? envNumber('TILE_REASONING_MAX_CASES', cases.length);

  return cases
    .filter((entry) => !variant_ids || variant_ids.has(entry.variant_id))
    .filter((entry) => !variants || variants.has(entry.variant))
    .filter((entry) => !tasks || tasks.has(entry.task))
    .slice(0, max_cases);
}

async function callOpenAI(input: {
  api_key: string;
  model: string;
  prompt: string;
  max_output_tokens: number;
}): Promise<{ output_text: string; usage: ReturnType<typeof extractUsage> }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.api_key}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: input.model,
        input: input.prompt,
        max_output_tokens: input.max_output_tokens,
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

    if (response.ok) {
      return {
        output_text: extractResponseText(response_json),
        usage: extractUsage(response_json)
      };
    }

    const delay_ms = retryDelayMs({
      response_status: response.status,
      response_text,
      attempt
    });
    if (delay_ms === null || attempt === 5) {
      throw new Error(
        `OpenAI response failed with ${String(response.status)}: ${response_text}`
      );
    }

    await sleep(delay_ms);
  }

  throw new Error('OpenAI response failed after retries');
}

async function evaluateCase(input: {
  api_key: string;
  model: string;
  repeat: number;
  prompt_case: ReasoningPromptCase;
  max_output_tokens: number;
}): Promise<ReasoningEvalRow> {
  const started_at = performance.now();
  const result = await callOpenAI({
    api_key: input.api_key,
    model: input.model,
    prompt: input.prompt_case.prompt,
    max_output_tokens: input.max_output_tokens
  });
  const latency_ms = Math.round(performance.now() - started_at);
  const normalized_output = normalizeAnswer(result.output_text);
  const normalized_expected = normalizeAnswer(input.prompt_case.expected_answer);
  const exact_match = normalized_output === normalized_expected;
  const contains_expected = normalized_output.includes(normalized_expected);
  const list_metrics = listMetrics({
    expected_answer: input.prompt_case.expected_answer,
    output_text: result.output_text
  });

  return {
    fixture: input.prompt_case.fixture,
    task: input.prompt_case.task,
    task_kind: input.prompt_case.task_kind,
    evaluation_mode: input.prompt_case.evaluation_mode,
    variant_id: input.prompt_case.variant_id,
    variant: input.prompt_case.variant,
    model: input.model,
    repeat: input.repeat,
    correct: exact_match || contains_expected,
    exact_match,
    contains_expected,
    list_precision: list_metrics?.precision ?? null,
    list_recall: list_metrics?.recall ?? null,
    list_f1: list_metrics?.f1 ?? null,
    latency_ms,
    prompt_chars: input.prompt_case.prompt_chars,
    estimated_prompt_tokens: input.prompt_case.estimated_prompt_tokens,
    prompt_chars_vs_compact_json: input.prompt_case.prompt_chars_vs_compact_json,
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
    const key = [
      row.fixture,
      row.task_kind,
      row.evaluation_mode,
      row.variant_id,
      row.variant,
      row.model
    ].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  });

  const summary = [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) {
      throw new Error('Unexpected empty reasoning eval group');
    }

    const average_api_input_tokens = average(
      group
        .map((row) => row.api_input_tokens)
        .filter((value): value is number => value !== null)
    );
    const average_list_f1 = average(
      group
        .map((row) => row.list_f1)
        .filter((value): value is number => value !== null)
    );

    return {
      fixture: first.fixture,
      task_kind: first.task_kind,
      evaluation_mode: first.evaluation_mode,
      variant_id: first.variant_id,
      variant: first.variant,
      model: first.model,
      cases: group.length,
      correct: group.filter((row) => row.correct).length,
      accuracy: group.filter((row) => row.correct).length / group.length,
      exact_matches: group.filter((row) => row.exact_match).length,
      exact_match_rate:
        group.filter((row) => row.exact_match).length / group.length,
      average_latency_ms: Math.round(average(group.map((row) => row.latency_ms)) ?? 0),
      average_prompt_chars: Math.round(average(group.map((row) => row.prompt_chars)) ?? 0),
      average_estimated_prompt_tokens: Math.round(
        average(group.map((row) => row.estimated_prompt_tokens)) ?? 0
      ),
      average_prompt_chars_vs_compact_json:
        average(group.map((row) => row.prompt_chars_vs_compact_json)) ?? 0,
      average_list_f1,
      list_f1_points_per_1k_input_tokens:
        average_list_f1 !== null && average_api_input_tokens !== null
          ? (average_list_f1 * 100 * 1000) / average_api_input_tokens
          : null,
      average_api_input_tokens,
      api_input_tokens_vs_compact_json: null,
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

  const compact_input_tokens_by_key = new Map<string, number>();
  summary.forEach((row) => {
    if (row.variant_id !== 'compact_json' || row.average_api_input_tokens === null) {
      return;
    }

    compact_input_tokens_by_key.set(
      [row.fixture, row.task_kind, row.evaluation_mode, row.model].join('\u0000'),
      row.average_api_input_tokens
    );
  });

  return summary.map((row) => {
    const compact_input_tokens = compact_input_tokens_by_key.get(
      [row.fixture, row.task_kind, row.evaluation_mode, row.model].join('\u0000')
    );

    return {
      ...row,
      api_input_tokens_vs_compact_json:
        compact_input_tokens && row.average_api_input_tokens !== null
          ? row.average_api_input_tokens / compact_input_tokens
          : null
    };
  });
}

function formatNumber(value: number | null): string {
  return value === null ? '' : Math.round(value).toLocaleString();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatOptionalPercent(value: number | null): string {
  return value === null ? '' : formatPercent(value);
}

function formatOptionalRatio(value: number | null): string {
  return value === null ? '' : `${(value * 100).toFixed(1)}%`;
}

function formatOptionalFixed(value: number | null, fraction_digits = 1): string {
  return value === null ? '' : value.toFixed(fraction_digits);
}

function markdownSummary(rows: ReasoningEvalSummaryRow[]): string {
  return [
    '## Semantic answer evaluation',
    '',
    'These rows grade direct model answers over structured context. Deterministic retrieval or generated-function benchmarks should be reported separately with an executable oracle.',
    '',
    '| Fixture | Task kind | Evaluation mode | Variant | Model | Cases | Answer acc. | Exact match | Avg list F1 | F1 pts / 1K input tok | Avg API input tok | API input vs compact JSON | Prompt chars vs compact JSON | Avg latency ms |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) =>
      [
        row.fixture,
        row.task_kind,
        row.evaluation_mode,
        row.variant,
        row.model,
        row.cases.toLocaleString(),
        formatPercent(row.accuracy),
        formatPercent(row.exact_match_rate),
        formatOptionalPercent(row.average_list_f1),
        formatOptionalFixed(row.list_f1_points_per_1k_input_tokens),
        formatNumber(row.average_api_input_tokens),
        formatOptionalRatio(row.api_input_tokens_vs_compact_json),
        formatOptionalRatio(row.average_prompt_chars_vs_compact_json),
        row.average_latency_ms.toLocaleString()
      ].join(' | ')
    )
  ].join('\n');
}

async function main(): Promise<void> {
  const cli_options = parseArgs(process.argv.slice(2));
  if (cli_options.help) {
    console.log(USAGE);
    return;
  }

  loadDotEnvLocal();

  const api_key = envString('OPENAI_API_KEY') ?? envString('OPEN_AI_KEY');
  const models =
    cli_options.models.length > 0
      ? cli_options.models
      : [...envList('TILE_REASONING_MODELS'), ...envList('TILE_REASONING_MODEL')];
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

  const repeats = cli_options.repeats ?? envNumber('TILE_REASONING_REPEATS', 1);
  const max_output_tokens =
    cli_options.max_output_tokens ??
    envNumber('TILE_REASONING_MAX_OUTPUT_TOKENS', 512);
  const prompt_cases = filterPromptCases(await readPromptCases(), cli_options);
  const rows: ReasoningEvalRow[] = [];

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (const model of models) {
      for (const prompt_case of prompt_cases) {
        rows.push(
          await evaluateCase({
            api_key,
            model,
            repeat,
            prompt_case,
            max_output_tokens
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
