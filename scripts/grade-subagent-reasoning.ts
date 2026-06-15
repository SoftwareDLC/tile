import { readFile, writeFile } from 'node:fs/promises';

type ExpectedCase = {
  fixture_id: string;
  fixture: string;
  task: string;
  task_kind: string;
  evaluation_mode: string;
  variant_id: string;
  variant: string;
  expected_answer: string;
  perceived_difficulty: number;
  difficulty_label: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
};

type ReasoningTask = {
  fixture: string;
  id: string;
  task_kind?: string;
  evaluation_mode?: string;
  expected_answer: string;
  perceived_difficulty: number;
  difficulty_label: string;
};

type ReasoningCase = {
  fixture_id: string;
  fixture: string;
  task: string;
  task_kind?: string;
  evaluation_mode?: string;
  variant_id: string;
  variant: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
};

type SubagentAnswer = {
  id: string;
  fixture: string;
  task: string;
  variant: string;
  answer: string;
};

type SubagentResult = {
  model: string;
  answers: SubagentAnswer[];
};

type GradedAnswer = SubagentAnswer & {
  model: string;
  expected_answer: string;
  correct: boolean;
  exact_match: boolean;
  contains_expected: boolean;
  list_precision: number | null;
  list_recall: number | null;
  list_f1: number | null;
  task_kind: string;
  evaluation_mode: string;
  perceived_difficulty: number;
  difficulty_label: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
};

type SummaryRow = {
  fixture: string | undefined;
  task_kind: string | undefined;
  evaluation_mode: string | undefined;
  variant: string | undefined;
  model: string | undefined;
  cases: number;
  correct: number;
  accuracy: number;
  average_list_f1: number | null;
  list_f1_points_per_1k_est_prompt_tokens: number | null;
};

type DifficultySummaryRow = {
  perceived_difficulty: number | undefined;
  difficulty_label: string | undefined;
  task_kind: string | undefined;
  evaluation_mode: string | undefined;
  variant: string | undefined;
  model: string | undefined;
  cases: number;
  correct: number;
  accuracy: number;
  average_list_f1: number | null;
};

const DEFAULT_TASK_KIND = 'semantic_answer';
const DEFAULT_EVALUATION_MODE = 'list_f1_exact_answer';

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
  const precision = output.size > 0 ? true_positive_count / output.size : 0;
  const recall = expected.size > 0 ? true_positive_count / expected.size : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  return { precision, recall, f1 };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function readExpectedCases(): Promise<ExpectedCase[]> {
  const tasks = JSON.parse(
    await readFile('benchmarks/results/reasoning-tasks.json', 'utf8')
  ) as ReasoningTask[];
  const cases = JSON.parse(
    await readFile('benchmarks/results/reasoning-cases.json', 'utf8')
  ) as ReasoningCase[];
  const tasks_by_key = new Map(
    tasks.map((task) => [[task.fixture, task.id].join('\u0000'), task])
  );

  return cases.map((entry) => {
    const task = tasks_by_key.get([entry.fixture_id, entry.task].join('\u0000'));
    if (!task) {
      throw new Error(`Missing expected task ${entry.fixture_id} / ${entry.task}`);
    }

    return {
      fixture_id: entry.fixture_id,
      fixture: entry.fixture,
      task: entry.task,
      task_kind: entry.task_kind ?? task.task_kind ?? DEFAULT_TASK_KIND,
      evaluation_mode:
        entry.evaluation_mode ?? task.evaluation_mode ?? DEFAULT_EVALUATION_MODE,
      variant_id: entry.variant_id,
      variant: entry.variant,
      expected_answer: task.expected_answer,
      perceived_difficulty: task.perceived_difficulty,
      difficulty_label: task.difficulty_label,
      prompt_chars: entry.prompt_chars,
      estimated_prompt_tokens: entry.estimated_prompt_tokens
    };
  });
}

async function main(): Promise<void> {
  const answer_path = process.argv[2];
  if (!answer_path) {
    throw new Error('Usage: tsx scripts/grade-subagent-reasoning.ts <answers.json>');
  }

  const expected_cases = await readExpectedCases();
  const subagent_result = JSON.parse(
    await readFile(answer_path, 'utf8')
  ) as SubagentResult;

  const expected_by_key = new Map(
    expected_cases.map((entry) => [
      [entry.fixture, entry.task, entry.variant].join('\u0000'),
      entry
    ])
  );

  const graded: GradedAnswer[] = subagent_result.answers.map((answer) => {
    const answer_record = asRecord(answer);
    const fixture = asString(answer_record.fixture);
    const task = asString(answer_record.task);
    const variant = asString(answer_record.variant);
    const expected = expected_by_key.get([fixture, task, variant].join('\u0000'));
    if (!expected) {
      throw new Error(`No expected case for ${fixture} / ${task} / ${variant}`);
    }

    const output = asString(answer_record.answer);
    const normalized_output = normalizeAnswer(output);
    const normalized_expected = normalizeAnswer(expected.expected_answer);
    const exact_match = normalized_output === normalized_expected;
    const contains_expected = normalized_output.includes(normalized_expected);
    const list_metrics = listMetrics({
      expected_answer: expected.expected_answer,
      output_text: output
    });

    return {
      id: asString(answer_record.id),
      fixture,
      task,
      variant,
      answer: output,
      model: subagent_result.model,
      expected_answer: expected.expected_answer,
      correct: exact_match || contains_expected,
      exact_match,
      contains_expected,
      list_precision: list_metrics?.precision ?? null,
      list_recall: list_metrics?.recall ?? null,
      list_f1: list_metrics?.f1 ?? null,
      task_kind: expected.task_kind,
      evaluation_mode: expected.evaluation_mode,
      perceived_difficulty: asNumber(expected.perceived_difficulty),
      difficulty_label: asString(expected.difficulty_label),
      prompt_chars: asNumber(expected.prompt_chars),
      estimated_prompt_tokens: asNumber(expected.estimated_prompt_tokens)
    };
  });

  const summary: SummaryRow[] = Object.values(
    graded.reduce<
      Record<string, { key: string; rows: GradedAnswer[]; total: number; correct: number }>
    >(
      (accumulator, row) => {
        const key = [
          row.fixture,
          row.task_kind,
          row.evaluation_mode,
          row.variant,
          row.model
        ].join('\u0000');
        const existing = accumulator[key] ?? {
          key,
          rows: [],
          total: 0,
          correct: 0
        };
        existing.rows.push(row);
        existing.total += 1;
        existing.correct += row.correct ? 1 : 0;
        accumulator[key] = existing;
        return accumulator;
      },
      {}
    )
  ).map((entry) => {
    const [fixture, task_kind, evaluation_mode, variant, model] =
      entry.key.split('\u0000');
    const average_list_f1 = average(
      entry.rows
        .map((row) => row.list_f1)
        .filter((value): value is number => value !== null)
    );
    const average_estimated_prompt_tokens = average(
      entry.rows.map((row) => row.estimated_prompt_tokens)
    );

    return {
      fixture,
      task_kind,
      evaluation_mode,
      variant,
      model,
      cases: entry.total,
      correct: entry.correct,
      accuracy: entry.correct / entry.total,
      average_list_f1,
      list_f1_points_per_1k_est_prompt_tokens:
        average_list_f1 !== null && average_estimated_prompt_tokens !== null
          ? (average_list_f1 * 100 * 1000) / average_estimated_prompt_tokens
          : null
    };
  });
  const difficulty_summary: DifficultySummaryRow[] = Object.values(
    graded.reduce<
      Record<string, { key: string; rows: GradedAnswer[]; total: number; correct: number }>
    >(
      (accumulator, row) => {
        const key = [
          row.perceived_difficulty,
          row.difficulty_label,
          row.task_kind,
          row.evaluation_mode,
          row.variant,
          row.model
        ].join('\u0000');
        const existing = accumulator[key] ?? {
          key,
          rows: [],
          total: 0,
          correct: 0
        };
        existing.rows.push(row);
        existing.total += 1;
        existing.correct += row.correct ? 1 : 0;
        accumulator[key] = existing;
        return accumulator;
      },
      {}
    )
  ).map((entry) => {
    const [
      perceived_difficulty,
      difficulty_label,
      task_kind,
      evaluation_mode,
      variant,
      model
    ] = entry.key.split('\u0000');
    return {
      perceived_difficulty: Number(perceived_difficulty),
      difficulty_label,
      task_kind,
      evaluation_mode,
      variant,
      model,
      cases: entry.total,
      correct: entry.correct,
      accuracy: entry.correct / entry.total,
      average_list_f1: average(
        entry.rows
          .map((row) => row.list_f1)
          .filter((value): value is number => value !== null)
      )
    };
  });

  const format_optional_percent = (value: number | null): string =>
    value === null ? '' : `${(value * 100).toFixed(1)}%`;
  const format_optional_fixed = (value: number | null): string =>
    value === null ? '' : value.toFixed(1);
  const summary_markdown = [
    '## Semantic answer evaluation by fixture and variant',
    '',
    'These rows grade direct answers. Executable retrieval or generated-function benchmarks should be reported separately with an oracle that runs the generated code.',
    '',
    '| Fixture | Task kind | Evaluation mode | Variant | Model | Cases | Correct | Answer acc. | Avg list F1 | F1 pts / 1K est. prompt tok |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...summary.map((row) =>
      [
        row.fixture ?? '',
        row.task_kind ?? '',
        row.evaluation_mode ?? '',
        row.variant ?? '',
        row.model ?? '',
        row.cases.toLocaleString(),
        row.correct.toLocaleString(),
        `${(row.accuracy * 100).toFixed(1)}%`,
        format_optional_percent(row.average_list_f1),
        format_optional_fixed(row.list_f1_points_per_1k_est_prompt_tokens)
      ].join(' | ')
    ),
    '',
    '## Semantic answer evaluation by perceived difficulty',
    '',
    '| Difficulty | Task kind | Evaluation mode | Variant | Model | Cases | Correct | Answer acc. | Avg list F1 |',
    '| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...difficulty_summary.map((row) =>
      [
        `${row.perceived_difficulty ?? ''} (${row.difficulty_label ?? ''})`,
        row.task_kind ?? '',
        row.evaluation_mode ?? '',
        row.variant ?? '',
        row.model ?? '',
        row.cases.toLocaleString(),
        row.correct.toLocaleString(),
        `${(row.accuracy * 100).toFixed(1)}%`,
        format_optional_percent(row.average_list_f1)
      ].join(' | ')
    )
  ].join('\n');

  await writeFile(
    'benchmarks/results/subagent-reasoning-performance.json',
    `${JSON.stringify({ rows: graded, summary, difficulty_summary }, null, 2)}\n`
  );
  await writeFile(
    'benchmarks/results/subagent-reasoning-performance.md',
    `${summary_markdown}\n`
  );
}

await main();
