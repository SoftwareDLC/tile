# Benchmark Fixture Sources

Fixtures are derived subsets used to compare JSON and TILE encodings. The default profile targets larger structured samples around 100k-200k compact JSON characters. Regenerate them with:

Benchmark fixture data is not relicensed under the repository MIT license. It remains subject to the upstream source terms noted below.

```sh
pnpm benchmark:fixtures
```

For the smaller smoke-test profile, run:

```sh
TILE_BENCHMARK_PROFILE=small pnpm benchmark:fixtures
```

## Sources

- OpenStreetMap Overpass API extract: `https://overpass-api.de/api/interpreter`
- Wikidata entity JSON converted to direct-claim triples: `https://www.wikidata.org/wiki/Special:EntityData`
- MusicBrainz web service release-group metadata: `https://musicbrainz.org/ws/2`
- npm registry package metadata: `https://registry.npmjs.org`

The fixtures are derived subsets, not complete source datasets.

## License Notes

- OpenStreetMap data is distributed under the Open Data Commons Open Database License 1.0. Attribute OpenStreetMap contributors when using or redistributing OSM-derived fixtures.
- Wikidata structured data is published under Creative Commons CC0.
- MusicBrainz core database data is published under Creative Commons CC0; avoid adding non-core user annotation/moderation content to fixtures unless its license has been reviewed.
- npm package metadata includes package-specific license fields. These fixtures keep only selected registry metadata for benchmarking and should not be treated as license advice for downstream package use.

These notes are included for open-source hygiene, not legal advice. Re-check upstream licensing before expanding fixture scope.
