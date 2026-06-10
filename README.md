# TILE

TILE (Tabular Interlinked Local Encoding) is a compact tabular encoding for JSON values. It preserves JSON round trips while representing repeated object and array structure as readable tables, which can be useful for prompt payloads, diffs, and inspection.

## Install

```sh
pnpm add @software-dlc/tile
```

## Usage

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

## API

- `encodeJsonToTile(value, options?)` encodes a JSON-compatible value as TILE text.
- `decodeTileToJson(tile)` decodes TILE text back into JSON.
- `compareJsonTileSize(value, options?)` compares compact JSON, pretty JSON, and TILE sizes.
- `encodeFirstClassTablesToTile(document)` writes caller-provided projection tables directly for LLM/context use. First-class projections are intentionally user-designed and are not decoded by `decodeTileToJson`.
- `escapeTileText(value, delimiter?)` and `unescapeTileText(value)` expose TILE text escaping.

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

To run model-backed reasoning performance comparisons, first generate the benchmark prompts with `pnpm benchmark`, then run:

```sh
OPENAI_API_KEY=... TILE_REASONING_MODEL=... pnpm benchmark:reasoning
```

That optional step writes `benchmarks/results/reasoning-performance.md` with accuracy, latency, and API token usage for each JSON/TILE variant.

Current size summary, generated on Node 20. Percentage columns are **characters as a percentage of compact JSON**, so lower is better. `100%` means the same size as compact JSON; `31.4%` means a 68.6% reduction; `131.6%` means 31.6% larger than compact JSON.

| Fixture | Compact JSON chars | Est. compact JSON tokens | Automatic TILE path chars vs compact JSON | TILE normalized chars vs compact JSON | First-class relational chars vs compact JSON | First-class embedded chars vs compact JSON |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenStreetMap extract | 133,692 | 33,423 | 131.6% | 134.2% | 31.4% | 29.4% |
| Wikidata truthy triples | 213,753 | 53,439 | 41.5% | 41.5% | 32.4% | 20.8% |
| MusicBrainz release groups | 171,855 | 42,964 | 63.8% | 63.8% | 58.5% | 37.0% |
| npm dependency metadata | 114,892 | 28,723 | 52.1% | 52.1% | 43.7% | 34.0% |

Recorded blind `gpt-5.4-mini` reasoning run on the large adjacency-heavy prompts:

| Variant | Cases | Correct | Accuracy | Avg. prompt tokens |
| --- | ---: | ---: | ---: | ---: |
| Compact JSON | 12 | 12 | 100.0% | 39,734 |
| Pretty JSON | 12 | 10 | 83.3% | 56,838 |
| TILE path | 12 | 12 | 100.0% | 27,221 |
| TILE normalized | 12 | 9 | 75.0% | 27,438 |
| TILE first-class relational | 12 | 9 | 75.0% | 16,466 |
| TILE first-class embedded | 12 | 11 | 91.7% | 11,756 |

These results are not meant to pick one universal best encoding. Different TILE projections are optimal for different lines of questioning:

- **Compact JSON** remains the broadest baseline when full original structure and familiar JSON semantics matter most.
- **TILE path** is lossless JSON-to-TILE output. In this run it preserved compact JSON reasoning accuracy while using fewer prompt tokens on average, which makes it a strong default for broad questions over large structured JSON.
- **TILE normalized** can reduce repeated shapes, but the current normalized representation exposes internal row ids. That helped size on some fixtures but hurt questions that asked for original OSM ids.
- **First-class relational TILE** is a deliberate projection into domain tables. It is compact, but it makes the model perform explicit joins across tables, so it fits questions that naturally use relational joins and clearly named ids.
- **First-class embedded TILE** keeps repeated local child rows under parent rows. It is the smallest high-performing variant here and fits adjacency-heavy questions where the answer depends on nearby child rows, sibling rows, or parent-child evidence. Its miss in this run came from one Wikidata grouped-claim question, which suggests that first-class projections need to preserve enough labels and local context for the intended question family.

The benchmark compares character counts, estimated token budgets, and recorded reasoning accuracy across JSON and TILE variants. Full generated tables live in:

- `benchmarks/results/size-summary.md`
- `benchmarks/results/reasoning-context-summary.md`
- `benchmarks/results/reasoning-performance.md` after `pnpm benchmark:reasoning`
- `benchmarks/results/subagent-reasoning-performance.md` after a recorded Codex subagent run

To benchmark your own data, use the included fixtures as a template:

1. Pick representative structured JSON near the size of the prompts you actually send.
2. Generate automatic TILE with `encodeJsonToTile(value)` and first-class variants with `encodeFirstClassTablesToTile({ tables, delimiter })`.
3. Try at least `delimiter: 'tab'` and `delimiter: 'pipe'` for first-class variants.
4. Compare compact JSON, path TILE, relational TILE, embedded TILE, and delimiter variants on the same question set.
5. Score both prompt size and answer quality. A smaller projection is only better when it preserves the ids, labels, ordering fields, and local evidence your questions need.

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

## License

Code and documentation are MIT licensed. Benchmark fixture data is derived from third-party public datasets and is not relicensed under MIT; see `benchmarks/fixtures/SOURCES.md` for source and license notes.
