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
  type ReasoningPromptCase,
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

function buildPrompt(input: {
  variant: EncodedVariant;
  task: ReasoningTask;
}): string {
  return [
    'Answer the question using only the structured dataset below.',
    `Dataset format: ${input.variant.label}`,
    '',
    input.variant.text,
    '',
    `Question: ${input.task.question}`,
    'Answer with the shortest exact answer.'
  ].join('\n');
}

function buildReasoningCases(input: {
  fixture: Fixture;
  variants: EncodedVariant[];
  tasks: ReasoningTask[];
}): ReasoningPromptCase[] {
  const fixture_tasks = input.tasks.filter(
    (task) => task.fixture === input.fixture.id
  );
  const compact_variant = input.variants.find(
    (variant) => variant.id === 'compact_json'
  );
  if (!compact_variant) {
    throw new Error(`Missing compact JSON variant for ${input.fixture.id}`);
  }

  return fixture_tasks.flatMap((task) => {
    const compact_prompt_chars = buildPrompt({
      variant: compact_variant,
      task
    }).length;

    return input.variants.map((variant) => {
      const prompt = buildPrompt({ variant, task });

      return {
        fixture: input.fixture.label,
        task: task.id,
        perceived_difficulty: task.perceived_difficulty,
        difficulty_label: task.difficulty_label,
        variant_id: variant.id,
        variant: variant.label,
        question: task.question,
        expected_answer: task.expected_answer,
        prompt,
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
    '| Fixture | Task | Difficulty | Variant | Prompt chars | Est. prompt tokens | Prompt chars vs compact JSON |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: |',
    ...rows.map((row) =>
      [
        row.fixture,
        row.task,
        `${row.perceived_difficulty} (${row.difficulty_label})`,
        row.variant,
        row.prompt_chars.toLocaleString(),
        row.estimated_prompt_tokens.toLocaleString(),
        formatRatio(row.prompt_chars_vs_compact_json)
      ].join(' | ')
    )
  ].join('\n');
}

async function main(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });

  const values = new Map<string, JsonValue>();
  const variants_by_fixture = new Map<string, EncodedVariant[]>();
  const size_rows: SizeRow[] = [];

  for (const fixture of FIXTURES) {
    const value = await readFixture(fixture);
    const variants = encodeVariants(fixture.id, value);

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
    variants_by_fixture.set(fixture.id, variants);
    size_rows.push(...buildSizeRows({ fixture, variants }));
  }

  const tasks = buildReasoningTasks(values);
  const reasoning_cases = FIXTURES.flatMap((fixture) => {
    const variants = variants_by_fixture.get(fixture.id);
    if (!variants) {
      throw new Error(`Missing variants for ${fixture.id}`);
    }

    return buildReasoningCases({ fixture, variants, tasks });
  });
  const reasoning_rows: ReasoningRow[] = reasoning_cases.map((row) => ({
    fixture: row.fixture,
    task: row.task,
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
    `${JSON.stringify({ tasks, rows: reasoning_rows }, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-prompts.json', RESULTS_DIR),
    `${JSON.stringify(reasoning_cases, null, 2)}\n`
  );
  await writeFile(
    new URL('reasoning-prompts-blind.json', RESULTS_DIR),
    `${JSON.stringify(
      reasoning_cases.map((prompt_case) => ({
        fixture: prompt_case.fixture,
        task: prompt_case.task,
        perceived_difficulty: prompt_case.perceived_difficulty,
        difficulty_label: prompt_case.difficulty_label,
        variant_id: prompt_case.variant_id,
        variant: prompt_case.variant,
        prompt_chars: prompt_case.prompt_chars,
        estimated_prompt_tokens: prompt_case.estimated_prompt_tokens,
        prompt_chars_vs_compact_json: prompt_case.prompt_chars_vs_compact_json,
        prompt: prompt_case.prompt
      })),
      null,
      2
    )}\n`
  );
  for (const variant of [
    ...new Map(
      reasoning_cases.map((prompt_case) => [
        prompt_case.variant_id,
        { id: prompt_case.variant_id, label: prompt_case.variant }
      ])
    ).values()
  ]) {
    await writeFile(
      new URL(`reasoning-prompts-blind-${variant.id}.json`, RESULTS_DIR),
      `${JSON.stringify(
        reasoning_cases
          .filter((prompt_case) => prompt_case.variant_id === variant.id)
          .map((prompt_case) => ({
            fixture: prompt_case.fixture,
            task: prompt_case.task,
            perceived_difficulty: prompt_case.perceived_difficulty,
            difficulty_label: prompt_case.difficulty_label,
            variant_id: prompt_case.variant_id,
            variant: prompt_case.variant,
            prompt_chars: prompt_case.prompt_chars,
            estimated_prompt_tokens: prompt_case.estimated_prompt_tokens,
            prompt_chars_vs_compact_json: prompt_case.prompt_chars_vs_compact_json,
            prompt: prompt_case.prompt
          })),
        null,
        2
      )}\n`
    );
  }
  await writeFile(
    new URL('reasoning-context-summary.md', RESULTS_DIR),
    `${markdownReasoningTable(reasoning_rows)}\n`
  );
}

await main();
