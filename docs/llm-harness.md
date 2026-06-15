# LLM Projection Harness

TILE can encode arbitrary JSON losslessly, but the strongest token reductions come from first-class projections that understand the user’s data model. The harness in this repo helps an LLM design those projections before a developer implements them.

The core workflow is question-driven compression. Decide what kinds of questions
the user or downstream model needs to ask, preserve the evidence paths for those
questions, and drop or separate structure that does not help that workload.
First-class TILE is most useful when it turns a large general-purpose JSON
document into a small, readable projection tailored to a known question family.

## Workflow

1. Start with representative JSON from the user’s real data shape.
2. Generate a projection-design prompt:

```sh
pnpm harness:design sample.json --out artifacts/tile-harness/sample.md
```

3. Review the generated prompt or send it to a model:

```sh
TILE_HARNESS_MODEL=gpt-5.4-mini pnpm harness:design sample.json --call-model
```

The script also reads `OPENAI_API_KEY` or `OPEN_AI_KEY` from `.env.local` when `--call-model` is used.

4. Implement the recommended tables with `encodeFirstClassTablesToTile({ tables })`.
5. Benchmark the projection against compact JSON and automatic TILE on the user’s target questions.
6. Try delimiter variants for first-class TILE, especially `tab` and `pipe`, and keep the one that gives the best token budget without hurting answer quality.

## What The Harness Asks For

The generated prompt asks the model to produce:

- Question families the projection should optimize for.
- A recommendation between path TILE, normalized TILE, first-class relational TILE, first-class embedded TILE, or a hybrid.
- First-class table definitions with stable original ids.
- Embedded child groups for local adjacency jumps.
- TypeScript-style projection pseudocode.
- Difficult benchmark questions and the evidence paths they exercise.
- Risk checks for dropped ids, labels, ordering fields, tie-breakers, nulls, and provenance.
- Delimiter experiments to run, including whether `pipe` may be better than the default `tab` for the proposed tables.

## Projection Guidance

Use **path TILE** when the questions are broad and need the full original structure.

Design benchmark questions and first-class projections together. The question set
defines the evidence paths the projection must preserve; a benchmark that asks
questions unsupported by the projection mostly measures a bad projection choice,
not the encoding. For example, OSM venue questions need a POI/tag table with
`name`, `amenity`, `cuisine`, and `brand`, while way-adjacency questions need
ordered way-node refs near the parent way.

This also means question-aligned first-class projections may be intentionally
lossy. Use lossless path or normalized TILE when the model needs arbitrary
original JSON. Use first-class relational or embedded TILE when the workload is
known and compression around that workload is the goal.

Use **inline JSON cells** for small or dynamic leaf objects that are more useful
as local context than as separate tables. This is a good fit for metadata bags,
tag maps, option maps, and sparse key/value annotations where the keys vary by
row and the object has little relational meaning. In automatic TILE, callers can
force this with `path_rules`, for example:

```ts
encodeJsonToTile(value, {
  path_rules: {
    'root.events[].metadata': 'inline_json'
  }
});
```

Do not inline objects that have stable entity fields, nested arrays, nested
objects, or ids that later questions need to join against.

Use the **properties table** for wrapper objects or dynamic property bags that
must still preserve individual keys as rows. Prefer inline JSON when the entire
small object is normally read as one local cell; prefer the properties table when
questions inspect arbitrary individual keys across many objects.

Use **first-class relational TILE** when the data naturally behaves like tables and the questions are joins, grouping, or filtering over stable ids.

Use **first-class embedded TILE** when the questions require local adjacency:

- parent row to child rows
- child row back to parent fields
- ordered sibling rows
- edge lists grouped under entities
- claims, dependencies, releases, events, or path segments that are meaningful only near their parent

For embedded child groups, keep parent fields blank after the first child row so
the model visually reads the children as belonging to the same parent. Choose
embedded groups when the answer depends on a local scan such as sibling order,
consecutive refs, parent tags plus child rows, or nearby evidence windows.
Choose a separate referenced table when the child object is relation-heavy,
shared by many parents, or queried independently.

Avoid replacing user-visible ids with internal row ids when answers need original ids. Keep labels near ids when the model must answer in human-readable form.

Delimiter choice is part of the projection. `encodeFirstClassTablesToTile` defaults to tab-delimited output, but also supports `pipe`, `comma`, and `space`:

```ts
const tile = encodeFirstClassTablesToTile({
  delimiter: 'pipe',
  tables
});
```

Benchmark `tab` and `pipe` at minimum. Pipe-delimited first-class tables can sometimes tokenize or scan better for short, dense rows, but the winning delimiter depends on the data, cell contents, and question style.

## Benchmarking Your Projection

Use the repo benchmark scripts as a reference implementation rather than a universal answer. For your own data:

1. Select representative structured JSON and target questions.
2. Separate **semantic answer tasks** from **deterministic function tasks**.
3. Design first-class projections for those exact question families.
4. Encode compact JSON, automatic path TILE, and each question-aligned first-class projection.
5. Include delimiter variants for first-class TILE, such as relational-tab, relational-pipe, embedded-tab, and embedded-pipe.
6. Measure prompt characters/tokens and model answer quality on the same questions, but run API-backed model benchmarks in small batches.
7. Keep variants that preserve the evidence path: stable ids, labels, ordering fields, counts, tie-breakers, and parent-child adjacency.

## Metric Taxonomy

Keep benchmark metrics aligned with the task type:

- **Structural comprehension** checks whether a model can read the format: field lookup, row counts, declared columns, malformed rows, and basic extraction. These are useful smoke tests, but they are not the strongest evidence for large structured workflows.
- **Semantic answer evaluation** asks the model to answer directly from a structured context. Use exact match for scalar answers, list precision/recall/F1 for multi-item answers, and report quality per 1K input tokens so compression and answer quality are visible together.
- **Executable retrieval evaluation** asks the model to write a retrieval, filtering, scoring, or traversal function instead of mentally scanning the whole dataset. Grade it by running the generated function against the fixture and comparing output to an oracle. Do not mix this score with direct-answer list F1.
- **Reasoning over refined evidence** starts after retrieval or projection has reduced the data. Measure final answer quality, the reduced evidence size, and the total prompt/API cost across the pipeline.

The generated benchmark artifacts carry `task_kind` and `evaluation_mode` fields
so these tracks can live in the same fixture set without collapsing into one
ambiguous "accuracy" number.

Large structured fixtures can produce prompts in the tens of thousands of input
tokens. Do not start by running every fixture, every task, and every variant
against the model at once; that often measures token-per-minute limits more than
encoding quality. Start with a narrow slice:

```sh
OPENAI_API_KEY=... pnpm benchmark:reasoning -- \
  --model gpt-5.4-mini \
  --variant-ids compact_json,tile_normalized,tile_first_class_embedded \
  --task-ids osm_east_asian_food_and_tea_venues,osm_coffee_or_tea_cafes \
  --max-output-tokens 512
```

Use one fixture or question family first, compare two or three variants, and
then expand only when the first slice shows a meaningful difference. Size tables
and generated prompt metrics are cheap to produce for all variants; model calls
should be batched around the hypothesis you are testing.

Semantic answer tasks are questions a model should naturally answer after reading
structured context, such as classifying venue cuisines, release-title themes,
package roles, or claims that imply a human-readable category.

Deterministic function tasks are different. For graph traversals, extrema,
numeric tie-breakers, geospatial math, or exact adjacency scans, ask the model to
write a small retrieval/scoring function instead of asking it to do the whole
scan mentally. Then evaluate the generated function by executing it against the
fixture and comparing the function output to an oracle. For example:

```text
Write a TypeScript function that receives this OSM JSON and returns:
way_id|highway|node_count|previous_middle_node_index|previous_middle_node_ref|middle_node_index|middle_node_ref
for the way with the most node references, where middle_node_index is
floor(node_count / 2).
```

This tests whether TILE gives the model enough schema and locality context to
write the right tool. It should not be graded with the exact-answer text grader.

## Implementation Shape

The model should eventually guide code like this:

```ts
import { encodeFirstClassTablesToTile, type JsonTileFirstClassTable } from '@software-dlc/tile';

const tables: JsonTileFirstClassTable[] = [
  {
    id: 'entities_with_edges',
    kind: 'entity_edges',
    path: 'root.entities.edges',
    columns: [
      'entity_id',
      'entity_label',
      { embedded_columns: ['edge_type', 'target_id', 'target_label'] }
    ],
    rows: [
      ['e1', 'Ada', 'created', 'p1', 'Compiler notes'],
      [undefined, undefined, 'used', 'p2', 'Analytical engine notes']
    ]
  }
];

const tile = encodeFirstClassTablesToTile({ tables });
```

The exact tables should be specific to the user’s data and the questions they need answered.
