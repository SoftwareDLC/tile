import { readFile, writeFile } from 'node:fs/promises';

type ExpectedCase = {
  fixture_id: string;
  fixture: string;
  task: string;
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
  expected_answer: string;
  perceived_difficulty: number;
  difficulty_label: string;
};

type ReasoningCase = {
  fixture_id: string;
  fixture: string;
  task: string;
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
  perceived_difficulty: number;
  difficulty_label: string;
  prompt_chars: number;
  estimated_prompt_tokens: number;
};

type SummaryRow = {
  fixture: string | undefined;
  variant: string | undefined;
  model: string | undefined;
  cases: number;
  correct: number;
  accuracy: number;
};

type DifficultySummaryRow = {
  perceived_difficulty: number | undefined;
  difficulty_label: string | undefined;
  variant: string | undefined;
  model: string | undefined;
  cases: number;
  correct: number;
  accuracy: number;
};

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
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
      perceived_difficulty: asNumber(expected.perceived_difficulty),
      difficulty_label: asString(expected.difficulty_label),
      prompt_chars: asNumber(expected.prompt_chars),
      estimated_prompt_tokens: asNumber(expected.estimated_prompt_tokens)
    };
  });

  const summary: SummaryRow[] = Object.values(
    graded.reduce<Record<string, { key: string; total: number; correct: number }>>(
      (accumulator, row) => {
        const key = [row.fixture, row.variant, row.model].join('\u0000');
        const existing = accumulator[key] ?? {
          key,
          total: 0,
          correct: 0
        };
        existing.total += 1;
        existing.correct += row.correct ? 1 : 0;
        accumulator[key] = existing;
        return accumulator;
      },
      {}
    )
  ).map((entry) => {
    const [fixture, variant, model] = entry.key.split('\u0000');
    return {
      fixture,
      variant,
      model,
      cases: entry.total,
      correct: entry.correct,
      accuracy: entry.correct / entry.total
    };
  });
  const difficulty_summary: DifficultySummaryRow[] = Object.values(
    graded.reduce<Record<string, { key: string; total: number; correct: number }>>(
      (accumulator, row) => {
        const key = [
          row.perceived_difficulty,
          row.difficulty_label,
          row.variant,
          row.model
        ].join('\u0000');
        const existing = accumulator[key] ?? {
          key,
          total: 0,
          correct: 0
        };
        existing.total += 1;
        existing.correct += row.correct ? 1 : 0;
        accumulator[key] = existing;
        return accumulator;
      },
      {}
    )
  ).map((entry) => {
    const [perceived_difficulty, difficulty_label, variant, model] =
      entry.key.split('\u0000');
    return {
      perceived_difficulty: Number(perceived_difficulty),
      difficulty_label,
      variant,
      model,
      cases: entry.total,
      correct: entry.correct,
      accuracy: entry.correct / entry.total
    };
  });
  const summary_markdown = [
    '## Accuracy by fixture and variant',
    '',
    '| Fixture | Variant | Model | Cases | Correct | Accuracy |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...summary.map((row) =>
      [
        row.fixture ?? '',
        row.variant ?? '',
        row.model ?? '',
        row.cases.toLocaleString(),
        row.correct.toLocaleString(),
        `${(row.accuracy * 100).toFixed(1)}%`
      ].join(' | ')
    ),
    '',
    '## Accuracy by perceived difficulty',
    '',
    '| Difficulty | Variant | Model | Cases | Correct | Accuracy |',
    '| ---: | --- | --- | ---: | ---: | ---: |',
    ...difficulty_summary.map((row) =>
      [
        `${row.perceived_difficulty ?? ''} (${row.difficulty_label ?? ''})`,
        row.variant ?? '',
        row.model ?? '',
        row.cases.toLocaleString(),
        row.correct.toLocaleString(),
        `${(row.accuracy * 100).toFixed(1)}%`
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
