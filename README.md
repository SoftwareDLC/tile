# TILE

TILE (Tabular Interlinked Local Encoding) is a compact tabular encoding for JSON values. It preserves JSON round trips while representing repeated object and array structure as readable tables, which can be useful for prompt payloads, diffs, and inspection.

## Why TILE?

In recorded `gpt-5.4-mini` semantic-list benchmarks with question-aligned
first-class embedded projections, TILE reduced API input tokens from
34,611-67,012 to 813-4,142 while preserving or improving average list F1.

Those numbers are not universal constants. The useful signal is that
projection-aware tables can make large structured prompt payloads much smaller
when the projection preserves the ids, labels, ordering fields, and local
evidence needed for the question family.

## Install

```sh
pnpm add @software-dlc/tile
```

## Usage

This repeated-record example is 855 compact JSON characters as JSON and 599
characters as TILE.

JSON input:

```json
{
  "audit_events": [
    {
      "event_id": "evt_001",
      "actor_display_name": "Ada Lovelace",
      "actor_organization_slug": "software-dlc",
      "repository_full_name": "SoftwareDLC/tile",
      "event_type": "pull_request_opened",
      "resource_identifier": "PR-42"
    },
    {
      "event_id": "evt_002",
      "actor_display_name": "Grace Hopper",
      "actor_organization_slug": "software-dlc",
      "repository_full_name": "SoftwareDLC/tile",
      "event_type": "issue_comment_created",
      "resource_identifier": "ISSUE-17"
    },
    {
      "event_id": "evt_003",
      "actor_display_name": "Ada Lovelace",
      "actor_organization_slug": "software-dlc",
      "repository_full_name": "SoftwareDLC/tile",
      "event_type": "pull_request_merged",
      "resource_identifier": "PR-42"
    },
    {
      "event_id": "evt_004",
      "actor_display_name": "Katherine Johnson",
      "actor_organization_slug": "software-dlc",
      "repository_full_name": "SoftwareDLC/tile",
      "event_type": "release_published",
      "resource_identifier": "v0.2.2"
    }
  ]
}
```

TILE output:

```text
TILE/5
root@t0	r0

t0	object	root
$id	audit_events@t1
r0	a0

t1	array	root.audit_events
$id	value@t2
a0
	r1
	r2
	r3
	r4

t2	object	root.audit_events[]
$id	event_id:s	actor_display_name:s	actor_organization_slug:s	repository_full_name:s	event_type:s	resource_identifier:s
r1	evt_001	Ada Lovelace	software-dlc	SoftwareDLC/tile	pull_request_opened	PR-42
r2	evt_002	Grace Hopper	software-dlc	SoftwareDLC/tile	issue_comment_created	ISSUE-17
r3	evt_003	Ada Lovelace	software-dlc	SoftwareDLC/tile	pull_request_merged	PR-42
r4	evt_004	Katherine Johnson	software-dlc	SoftwareDLC/tile	release_published	v0.2.2
```

```ts
import { decodeTileToJson, encodeJsonToTile } from '@software-dlc/tile';

const tile = encodeJsonToTile({
  users: [
    { id: 'u1', name: 'Ada' },
    { id: 'u2', name: 'Grace' }
  ]
});

const json = decodeTileToJson(tile);
```

## CLI

The npm package also installs a `tile` command:

```sh
pnpm exec tile encode data.json --out data.tile
pnpm exec tile decode data.tile --pretty --out data.json
pnpm exec tile size data.json
```

The CLI reads from stdin when no input path is provided, so it can be used in
shell pipelines:

```sh
cat data.json | pnpm exec tile encode > data.tile
pnpm exec tile decode data.tile --pretty
pnpm exec tile encode data.json --strategy normalized_shape
```

You can also run it without adding the package to a project first:

```sh
pnpm dlx @software-dlc/tile encode data.json
npx @software-dlc/tile size data.json
```

## API

- `encodeJsonToTile(value, options?)` encodes a JSON-compatible value as TILE text.
- `decodeTileToJson(tile)` decodes TILE text back into JSON.
- `compareJsonTileSize(value, options?)` compares compact JSON, pretty JSON, and TILE sizes.
- `encodeFirstClassTablesToTile(document)` writes caller-provided projection tables directly for LLM/context use. First-class projections are intentionally user-designed and are not decoded by `decodeTileToJson`.
- `escapeTileText(value, delimiter?)` and `unescapeTileText(value)` expose TILE text escaping.

`encodeJsonToTile` automatically keeps small schemaless leaf objects inline as
typed JSON cells when that is clearer than creating another referenced object
table. Callers can override object-path decisions when they know the data model:

```ts
const tile = encodeJsonToTile(value, {
  path_rules: {
    'root.events[].metadata': 'inline_json',
    'root.events[].actor': 'reference_table'
  }
});
```

The default planner stays conservative: roots, repeated schema-like objects,
objects with identity keys, and objects containing nested arrays or objects stay
table-backed unless a caller rule says otherwise.

First-class TILE documents can also choose a delimiter:

```ts
const tile = encodeFirstClassTablesToTile({
  delimiter: 'pipe',
  tables
});
```

Supported delimiters are `tab`, `pipe`, `comma`, and `space`. `tab` is the default, but delimiter choice can affect tokenizer behavior. In our local testing, `pipe` can be worth trying for some first-class projections, especially when the table cells are short and pipe boundaries make rows easier for the model to scan.

## Benchmarks

The repo includes reproducible benchmark fixtures derived from real public datasets:

- OpenStreetMap node, way, and tag extracts
- Wikidata direct-claim triples
- MusicBrainz artist and release-group metadata
- npm package and dependency metadata

Run them with:

```sh
pnpm benchmark
```

The default fixture profile targets larger structured samples around 100k-200k compact JSON characters. For a quick local smoke run, regenerate the smaller profile with:

```sh
TILE_BENCHMARK_PROFILE=small pnpm benchmark
```

To run model-backed reasoning performance comparisons, first generate the
benchmark artifacts with `pnpm benchmark`, then run a narrow slice:

```sh
OPENAI_API_KEY=... pnpm benchmark:reasoning -- \
  --model gpt-5.4-mini \
  --variant-ids compact_json,tile_normalized,tile_first_class_embedded \
  --task-ids osm_east_asian_food_and_tea_venues,osm_coffee_or_tea_cafes \
  --max-output-tokens 512
```

Avoid running every generated fixture, question, and encoding variant in a single
API-backed sweep unless you have a large token-per-minute quota. The large
fixtures produce prompts in the tens of thousands of tokens; broad sweeps mostly
measure API throughput and retry behavior. Prefer a staged workflow:

1. Start with one fixture and one question family.
2. Compare two or three variants, such as compact JSON, the automatic TILE
   candidate, and one first-class projection.
3. Use enough `--max-output-tokens` for the answer shape. Long list answers need
   more than terse scalar answers.
4. Expand to more variants only after the first slice shows useful signal.

Useful filters:

```sh
OPENAI_API_KEY=... pnpm benchmark:reasoning -- \
  --model gpt-5.4-mini \
  --variant-ids tile_normalized,tile_first_class_embedded \
  --task-ids osm_east_asian_food_and_tea_venues,osm_person_named_ways
```

That optional step assembles prompts from the normalized benchmark artifacts and
writes `benchmarks/results/reasoning-performance.md` with accuracy, latency, and
API token usage for each JSON/TILE variant.

Current size summary, generated on Node 20. Percentage columns are **characters as a percentage of compact JSON**, so lower is better. `100%` means the same size as compact JSON; `7.0%` means a 93.0% reduction; `131.6%` means 31.6% larger than compact JSON.

| Fixture | Compact JSON chars | Est. compact JSON tokens | Automatic TILE path chars vs compact JSON | TILE normalized chars vs compact JSON | First-class relational chars vs compact JSON | First-class embedded chars vs compact JSON |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenStreetMap extract | 133,692 | 33,423 | 131.6% | 89.4% | 7.0% | 9.2% |
| Wikidata truthy triples | 213,753 | 53,439 | 41.5% | 41.5% | 1.8% | 0.9% |
| MusicBrainz release groups | 171,855 | 42,964 | 63.8% | 63.8% | 5.5% | 4.1% |
| npm dependency metadata | 114,892 | 28,723 | 52.1% | 52.1% | 1.7% | 2.3% |

Recorded `gpt-5.4-mini` semantic-list benchmark on question-aligned projections:

| Fixture | Compact JSON avg list F1 | First-class embedded avg list F1 | Compact JSON avg API input tokens | First-class embedded avg API input tokens |
| --- | ---: | ---: | ---: | ---: |
| OpenStreetMap extract | 85.5% | 94.7% | 50,626 | 4,142 |
| Wikidata truthy triples | 78.2% | 100.0% | 58,149 | 813 |
| MusicBrainz release groups | 49.1% | 61.2% | 67,012 | 2,324 |
| npm dependency metadata | 94.1% | 95.8% | 34,611 | 917 |

These are stochastic model-backed results, not universal constants. The useful
signal is the pattern: when the first-class projection is designed around the
question family, it can reduce prompt size by one to two orders of magnitude
while preserving or improving answer quality.

Benchmark results are not meant to pick one universal best encoding. Different TILE projections are optimal for different lines of questioning:

- **Compact JSON** remains the broadest baseline when full original structure and familiar JSON semantics matter most.
- **TILE path** is lossless JSON-to-TILE output. It can help broad structured prompts, but it is not automatically smaller for every data shape.
- **TILE normalized** can reduce repeated shapes while preserving round trips, and path rules such as inline JSON cells can keep local metadata bags readable.
- **First-class relational TILE** is a deliberate projection into domain tables. It fits questions that naturally use entity lists, filtered edge tables, or joins across clearly named ids.
- **First-class embedded TILE** keeps the evidence for a question family local: subject-to-claims, artist-to-titles, package-to-relevant-dependencies, or OSM feature-to-tags. It is the strongest compression path when the user knows what kinds of questions they plan to ask.

First-class benchmark questions and first-class projections should be designed
together. The question set is the contract for the projection. If a projection
is built for way-node adjacency, it should not be used to judge venue-tag
questions; if the questions ask about OSM cafes, cuisines, or street names, the
projection must preserve POI tags and way names locally.

The benchmark compares character counts, estimated token budgets, and recorded reasoning accuracy across JSON and TILE variants. Generated benchmark artifacts are normalized to avoid repeating the large encoded datasets in every question prompt:

- `benchmarks/results/size-summary.md`
- `benchmarks/results/reasoning-context-summary.md`
- `benchmarks/results/reasoning-tasks.json` for the canonical question and expected-answer set
- `benchmarks/results/reasoning-contexts.json` for each fixture/encoding context stored once
- `benchmarks/results/reasoning-cases.json` for the lightweight task/context cross-product and prompt metrics
- `benchmarks/results/reasoning-performance.md` after `pnpm benchmark:reasoning`
- `benchmarks/results/subagent-reasoning-performance.md` after a recorded Codex subagent run

To benchmark your own data, use the included fixtures as a template:

1. Pick representative structured JSON near the size of the prompts you actually send.
2. Define the question families and evidence paths you care about.
3. Generate automatic TILE with `encodeJsonToTile(value)` and question-aligned first-class variants with `encodeFirstClassTablesToTile({ tables, delimiter })`.
4. Try at least `delimiter: 'tab'` and `delimiter: 'pipe'` for first-class variants.
5. Compare compact JSON, path TILE, relational TILE, embedded TILE, and delimiter variants on the same question set, but do it in small API-backed batches.
6. Score both prompt size and answer quality. A smaller projection is only better when it preserves the ids, labels, ordering fields, and local evidence your questions need.

## LLM Projection Harness

First-class TILE works best when the projection matches the user’s data and question family. The repo includes a harness that profiles representative JSON and writes an LLM-ready design prompt for choosing path, relational, embedded, or hybrid TILE:

```sh
pnpm harness:design sample.json --out artifacts/tile-harness/sample.md
```

With `TILE_HARNESS_MODEL` and `OPENAI_API_KEY` or `OPEN_AI_KEY`, the same command can call a model:

```sh
TILE_HARNESS_MODEL=gpt-5.4-mini pnpm harness:design sample.json --call-model
```

See `docs/llm-harness.md` for the projection workflow and guidance.

## Development

```sh
pnpm install
pnpm check
```

Before publishing, run the package smoke test. It builds the package, creates an
npm tarball, installs that tarball into a temporary consumer project, and checks
ESM import, CommonJS require, and the installed `tile` binary:

```sh
pnpm test:package
```

The repo also includes an incubating Python package for first-class TILE prompt
tables under `packages/python`. It shares conformance cases with the TypeScript
encoder and can be checked with:

```sh
pnpm test:python
```

Release publishing is maintainer-only. Local coding agents may prepare and
verify release artifacts, but a human maintainer runs all `git push`,
`npm publish`, `twine upload`, PyPI, npm, and GitHub release commands. See
`CONTRIBUTING.md` for the release checklist.

## License

Code and documentation are MIT licensed. Benchmark fixture data is derived from third-party public datasets and is not relicensed under MIT; see `benchmarks/fixtures/SOURCES.md` for source and license notes.
