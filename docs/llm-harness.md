# LLM Projection Harness

TILE can encode arbitrary JSON losslessly, but the strongest token reductions come from first-class projections that understand the user’s data model. The harness in this repo helps an LLM design those projections before a developer implements them.

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

Use **first-class relational TILE** when the data naturally behaves like tables and the questions are joins, grouping, or filtering over stable ids.

Use **first-class embedded TILE** when the questions require local adjacency:

- parent row to child rows
- child row back to parent fields
- ordered sibling rows
- edge lists grouped under entities
- claims, dependencies, releases, events, or path segments that are meaningful only near their parent

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
2. Encode compact JSON, automatic path TILE, and each first-class projection.
3. Include delimiter variants for first-class TILE, such as relational-tab, relational-pipe, embedded-tab, and embedded-pipe.
4. Measure prompt characters/tokens and model answer quality on the same questions.
5. Keep variants that preserve the evidence path: stable ids, labels, ordering fields, counts, tie-breakers, and parent-child adjacency.

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
