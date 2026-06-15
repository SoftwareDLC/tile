import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
  decodeTileToJson,
  encodeFirstClassTablesToTile,
  encodeJsonToTile,
  type JsonValue
} from '../src/index.js';
import {
  FIXTURES,
  estimateTokens,
  formatRatio,
  normalizedTileOptions,
  type EncodedVariant,
  type Fixture,
  type ReasoningCase,
  type ReasoningContext,
  type ReasoningRow,
  type ReasoningTask,
  type SizeRow
} from './benchmark-utils.js';
import {
  firstClassEmbeddedTablesForFixture,
  firstClassTablesForFixture
} from './benchmark-first-class.js';
import { buildReasoningTasks } from './benchmark-reasoning-tasks.js';

const RESULTS_DIR = new URL('../benchmarks/results/', import.meta.url);
const FIXTURE_DIR = new URL('../benchmarks/fixtures/', import.meta.url);

function encodeVariants(fixture_id: string, value: JsonValue): EncodedVariant[] {
  return [
    {
      id: 'compact_json',
      label: 'Compact JSON',
      text: JSON.stringify(value)
    },
    {
      id: 'pretty_json',
      label: 'Pretty JSON',
      text: JSON.stringify(value, null, 2)
    },
    {
      id: 'tile_path',
      label: 'TILE path',
      text: encodeJsonToTile(value)
    },
    {
      id: 'tile_normalized',
      label: 'TILE normalized',
      text: encodeJsonToTile(value, normalizedTileOptions(fixture_id))
    },
    {
      id: 'tile_first_class',
      label: 'TILE first-class relational',
      text: encodeFirstClassTablesToTile({
        tables: firstClassTablesForFixture(fixture_id, value)
      })
    },
    {
      id: 'tile_first_class_embedded',
      label: 'TILE first-class embedded',
      text: encodeFirstClassTablesToTile({
        tables: firstClassEmbeddedTablesForFixture(fixture_id, value)
      })
    }
  ];
}

async function readFixture(fixture: Fixture): Promise<JsonValue> {
  return JSON.parse(
    await readFile(new URL(fixture.path, FIXTURE_DIR), 'utf8')
  ) as JsonValue;
}

function buildSizeRows(input: {
  fixture: Fixture;
  variants: EncodedVariant[];
}): SizeRow[] {
  const compact_json = input.variants.find(
    (variant) => variant.id === 'compact_json'
  );
  if (!compact_json) {
    throw new Error(`Missing compact JSON variant for ${input.fixture.id}`);
  }

  const compact_chars = compact_json.text.length;

  return input.variants.map((variant) => ({
    fixture: input.fixture.label,
    variant: variant.label,
    chars: variant.text.length,
    estimated_tokens: estimateTokens(variant.text),
    chars_vs_compact_json: variant.text.length / compact_chars
  }));
}

function buildReasoningContexts(input: {
  fixture: Fixture;
  variants: EncodedVariant[];
}): ReasoningContext[] {
  const compact_json = input.variants.find(
    (variant) => variant.id === 'compact_json'
  );
  if (!compact_json) {
    throw new Error(`Missing compact JSON variant for ${input.fixture.id}`);
  }

  const compact_chars = compact_json.text.length;

  return input.variants.map((variant) => ({
    fixture_id: input.fixture.id,
    fixture: input.fixture.label,
    variant_id: variant.id,
    variant: variant.label,
    text: variant.text,
    chars: variant.text.length,
    estimated_tokens: estimateTokens(variant.text),
    chars_vs_compact_json: variant.text.length / compact_chars
  }));
}

function buildPrompt(input: {
  context: Pick<ReasoningContext, 'variant' | 'text'>;
  task: ReasoningTask;
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

function buildReasoningCases(input: {
  fixture: Fixture;
  contexts: ReasoningContext[];
  tasks: ReasoningTask[];
}): ReasoningCase[] {
  const fixture_tasks = input.tasks.filter(
    (task) => task.fixture === input.fixture.id
  );
  const compact_context = input.contexts.find(
    (context) => context.variant_id === 'compact_json'
  );
  if (!compact_context) {
    throw new Error(`Missing compact JSON variant for ${input.fixture.id}`);
  }

  return fixture_tasks.flatMap((task) => {
    const compact_prompt_chars = buildPrompt({
      context: compact_context,
      task
    }).length;

    return input.contexts.map((context) => {
      const prompt = buildPrompt({ context, task });

      return {
        fixture_id: input.fixture.id,
        fixture: input.fixture.label,
        task: task.id,
        task_kind: task.task_kind,
        evaluation_mode: task.evaluation_mode,
        perceived_difficulty: task.perceived_difficulty,
        difficulty_label: task.difficulty_label,
        variant_id: context.variant_id,
        variant: context.variant,
        prompt_chars: prompt.length,
        estimated_prompt_tokens: estimateTokens(prompt),
        prompt_chars_vs_compact_json: prompt.length / compact_prompt_chars
      };
    });
  });
}

function markdownSizeTable(rows: SizeRow[]): string {
  return [
    '| Fixture | Variant | Chars | Est. tokens | Chars vs compact JSON |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows.map((row) =>
      [
        row.fixture,
        row.variant,
        row.chars.toLocaleString(),
        row.estimated_tokens.toLocaleString(),
        formatRatio(row.chars_vs_compact_json)
      ].join(' | ')
    )
  ].join('\n');
}

function markdownReasoningTable(rows: ReasoningRow[]): string {
  return [
    '| Fixture | Task | Task kind | Evaluation mode | Difficulty | Variant | Prompt chars | Est. prompt tokens | Prompt chars vs compact JSON |',
    '| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |',
    ...rows.map((row) =>
      [
        row.fixture,
        row.task,
        row.task_kind,
        row.evaluation_mode,
        `${row.perceived_difficulty} (${row.difficulty_label})`,
        row.variant,
        row.prompt_chars.toLocaleString(),
        row.estimated_prompt_tokens.toLocaleString(),
        formatRatio(row.prompt_chars_vs_compact_json)
      ].join(' | ')
    )
  ].join('\n');
}

function summarizeReasoningContext(
  context: ReasoningContext
): Omit<ReasoningContext, 'text'> {
  return {
    fixture_id: context.fixture_id,
    fixture: context.fixture,
    variant_id: context.variant_id,
    variant: context.variant,
    chars: context.chars,
    estimated_tokens: context.estimated_tokens,
    chars_vs_compact_json: context.chars_vs_compact_json
  };
}

async function main(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });

  const values = new Map<string, JsonValue>();
  const contexts_by_fixture = new Map<string, ReasoningContext[]>();
  const size_rows: SizeRow[] = [];
  const reasoning_contexts: ReasoningContext[] = [];

  for (const fixture of FIXTURES) {
    const value = await readFixture(fixture);
    const variants = encodeVariants(fixture.id, value);
    const contexts = buildReasoningContexts({ fixture, variants });

    variants
      .filter((variant) => variant.id === 'tile_path' || variant.id === 'tile_normalized')
      .forEach((variant) => {
        const decoded = decodeTileToJson(variant.text);
        assert.deepStrictEqual(
          decoded,
          value,
          `${fixture.id} ${variant.id} did not round trip`
        );
      });

    values.set(fixture.id, value);
    contexts_by_fixture.set(fixture.id, contexts);
    reasoning_contexts.push(...contexts);
    size_rows.push(...buildSizeRows({ fixture, variants }));
  }

  const tasks = buildReasoningTasks(values);
  const reasoning_cases = FIXTURES.flatMap((fixture) => {
    const contexts = contexts_by_fixture.get(fixture.id);
    if (!contexts) {
      throw new Error(`Missing contexts for ${fixture.id}`);
    }

    return buildReasoningCases({ fixture, contexts, tasks });
  });
  const reasoning_rows: ReasoningRow[] = reasoning_cases.map((row) => ({
    fixture_id: row.fixture_id,
    fixture: row.fixture,
    task: row.task,
    task_kind: row.task_kind,
    evaluation_mode: row.evaluation_mode,
    perceived_difficulty: row.perceived_difficulty,
    difficulty_label: row.difficulty_label,
    variant_id: row.variant_id,
    variant: row.variant,
    prompt_chars: row.prompt_chars,
    estimated_prompt_tokens: row.estimated_prompt_tokens,
    prompt_chars_vs_compact_json: row.prompt_chars_vs_compact_json
  }));

  await writeFile(
    new URL('size-summary.json', RESULTS_DIR),
    `${JSON.stringify(size_rows, null, 2)}\n`
  );
  await writeFile(
    new URL('size-summary.md', RESULTS_DIR),
    `${markdownSizeTable(size_rows)}\n`
  );
  await writeFile(
    new URL('reasoning-context-summary.json', RESULTS_DIR),
    `${JSON.stringify(
      {
        tasks,
        contexts: reasoning_contexts.map((context) =>
          summarizeReasoningContext(context)
        ),
        rows: reasoning_rows
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    new URL('reasoning-tasks.json', RESULTS_DIR),
    `${JSON.stringify(tasks, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-contexts.json', RESULTS_DIR),
    `${JSON.stringify(reasoning_contexts, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-cases.json', RESULTS_DIR),
    `${JSON.stringify(reasoning_cases, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-context-summary.md', RESULTS_DIR),
    `${markdownReasoningTable(reasoning_rows)}\n`
  );
}

await main();
