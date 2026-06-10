import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  compareJsonTileSize,
  decodeTileToJson,
  encodeFirstClassTablesToTile,
  encodeJsonToTile,
  escapeTileText,
  unescapeTileText
} from './index.js';

describe('jsonTile', () => {
  const fixture_names = [
    'openstreetmap-extract.json',
    'wikidata-triples.json',
    'musicbrainz-release-groups.json',
    'npm-dependencies.json'
  ];

  it('round trips nested objects and arrays through tab-delimited tables', () => {
    const value = {
      users: [
        {
          id: 'u1',
          name: 'Ada',
          tags: ['admin', 'founder'],
          profile: {
            bio: 'compiler person',
            active: true
          }
        },
        {
          id: 'u2',
          name: 'Grace',
          tags: [],
          profile: {
            bio: null,
            active: false
          }
        }
      ],
      count: 2
    };

    const tile = encodeJsonToTile(value);

    expect(tile).toContain('TILE/5');
    expect(tile).toContain('root@t0\tr0');
    expect(tile).toContain('t0\tobject\troot');
    expect(tile).toContain('$id\tusers@t1\tcount:n');
    expect(tile).toContain('t1\tarray\troot.users');
    expect(tile).toContain('$id\tvalue@');
    expect(tile).toContain('\na0\n\t');
    expect(tile).toContain('$id\tid:s\tname:s');
    expect(tile).toContain('r0\ta0\t2');
    expect(tile).not.toContain('s:u1');
    expect(tile).not.toContain('s:Ada');
    expect(tile).not.toContain('r:t');
    expect(tile).not.toContain('$idx');
    expect(tile).not.toContain('\ntable\t');
    expect(tile).not.toContain('\ncols\t');
    expect(tile).not.toContain('\nrow\t');
    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('escapes tabs, newlines, carriage returns, and backslashes in cells and headers', () => {
    const value = {
      'odd\tkey': 'line 1\nline 2\r\npath\\file',
      plain: 'literal \\t stays distinct from a tab:\t'
    };

    const tile = encodeJsonToTile(value);

    expect(tile).toContain('odd\\tkey');
    expect(tile).toContain('line 1\\nline 2\\r\\npath\\\\file');
    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('decodes legacy TDT version headers for existing artifacts', () => {
    const value = {
      user: {
        id: 'u1',
        name: 'Ada'
      }
    };
    const tile = encodeJsonToTile(value);
    const legacy_tdt = tile.replace('TILE/5', 'TDT/5');

    expect(decodeTileToJson(legacy_tdt)).toEqual(value);
  });

  it('encodes caller-provided first-class tables', () => {
    const tile = encodeFirstClassTablesToTile({
      tables: [
        {
          id: 'nodes',
          kind: 'graph',
          path: 'root.nodes',
          columns: [
            'id',
            'label',
            { embedded_columns: ['edge_id', 'relationship'] }
          ],
          rows: [
            ['n1', 'Ada\tLovelace', 'e1', 'uses'],
            ['', undefined, 'e2', 'reads\nfrom']
          ]
        }
      ]
    });

    expect(tile).toBe(
      [
        'nodes\tgraph\troot.nodes',
        'id\tlabel\t[edge_id,relationship]',
        'n1\tAda\\tLovelace\te1\tuses',
        '\t\te2\treads\\nfrom'
      ].join('\n')
    );
  });

  it('encodes caller-provided first-class tables with alternate delimiters', () => {
    const document = {
      tables: [
        {
          id: 'nodes',
          columns: [
            'id',
            'label',
            { embedded_columns: ['edge_id', 'relationship'] }
          ],
          rows: [['n1', 'Ada Lovelace, pioneer|math', 'e1', 'uses']]
        }
      ]
    };

    expect(
      encodeFirstClassTablesToTile({
        ...document,
        delimiter: 'comma'
      })
    ).toBe(
      [
        'nodes',
        'id,label,[edge_id;relationship]',
        'n1,Ada Lovelace\\, pioneer|math,e1,uses'
      ].join('\n')
    );

    expect(
      encodeFirstClassTablesToTile({
        ...document,
        delimiter: 'pipe'
      })
    ).toBe(
      [
        'nodes',
        'id|label|[edge_id,relationship]',
        'n1|Ada Lovelace, pioneer\\|math|e1|uses'
      ].join('\n')
    );

    expect(
      encodeFirstClassTablesToTile({
        ...document,
        delimiter: 'space'
      })
    ).toBe(
      [
        'nodes',
        'id label [edge_id,relationship]',
        'n1 Ada\\sLovelace,\\spioneer|math e1 uses'
      ].join('\n')
    );
  });

  it('rejects ambiguous embedded column names', () => {
    expect(() =>
      encodeFirstClassTablesToTile({
        tables: [
          {
            id: 'nodes',
            columns: [{ embedded_columns: ['edge,id'] }],
            rows: []
          }
        ]
      })
    ).toThrow('embedded column names cannot contain comma or brackets');
  });

  it('keeps empty objects and arrays distinct from missing object fields', () => {
    const value = {
      empty_object: {},
      empty_array: [],
      sparse_shapes: [{ only_a: 1 }, { only_b: 2 }]
    };

    const tile = encodeJsonToTile(value);

    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('can normalize similar nested object shapes into one table', () => {
    const value = {
      primary_contact: {
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com'
      },
      billing_contact: {
        id: 'u2',
        name: 'Grace',
        phone: '+1-555-0100'
      },
      audit_actor: {
        id: 'u3',
        display_name: 'Audit Bot'
      }
    };

    const path_tile = encodeJsonToTile(value);
    const normalized_tile = encodeJsonToTile(value, {
      object_table_strategy: 'normalized_shape'
    });

    expect(path_tile).toContain('t1\tobject\troot.primary_contact');
    expect(path_tile).toContain('t2\tobject\troot.billing_contact');
    expect(path_tile).not.toContain(
      'root.primary_contact|root.billing_contact'
    );

    expect(normalized_tile).toContain(
      't1\tobject\troot.primary_contact|root.billing_contact'
    );
    expect(normalized_tile).toContain('$id\tid:s\tname:s\temail:s\tphone:s');
    expect(normalized_tile).toContain('t2\tobject\troot.audit_actor');
    expect(decodeTileToJson(normalized_tile)).toEqual(value);
  });

  it('does not merge normalized tables past the configured column limit', () => {
    const value = {
      first: {
        id: 'one',
        name: 'Ada',
        email: 'ada@example.com'
      },
      second: {
        id: 'two',
        name: 'Grace',
        phone: '+1-555-0100'
      }
    };

    const tile = encodeJsonToTile(value, {
      object_table_strategy: 'normalized_shape',
      normalized_max_columns: 3
    });

    expect(tile).toContain('t1\tobject\troot.first');
    expect(tile).toContain('t2\tobject\troot.second');
    expect(tile).not.toContain('root.first|root.second');
    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('routes single-key wrapper objects through a trailing properties table', () => {
    const value = {
      first: {
        slot: {
          user_id: 'u1',
          name: 'Ada'
        }
      },
      second: {
        slot: {
          team_id: 't1',
          title: 'Core Team'
        }
      }
    };

    const tile = encodeJsonToTile(value, {
      object_table_strategy: 'normalized_shape',
      normalized_min_shared_keys: 1
    });

    expect(tile).toContain('properties\t$properties');
    expect(tile).toContain('$id\tkey:s\tvalue');
    expect(tile).toContain('p0\tslot\tr:t2:r1');
    expect(tile).toContain('p1\tslot\tr:t3:r2');
    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('round trips a primitive root value without creating data tables', () => {
    const tile = encodeJsonToTile('hello\tworld');

    expect(tile).toBe('TILE/5\nroot:s\thello\\tworld');
    expect(decodeTileToJson(tile)).toBe('hello\tworld');
  });

  it('uses ordered marker rows instead of explicit indexes for arrays', () => {
    const value = {
      lists: [['a', 'b'], [], ['c']]
    };

    const tile = encodeJsonToTile(value);

    expect(tile).toContain('t2\tarray\troot.lists[]');
    expect(tile).toContain('$id\tvalue:s');
    expect(tile).toContain('a1\n\ta\n\tb\na2\na3\n\tc');
    expect(tile).not.toContain('$idx');
    expect(decodeTileToJson(tile)).toEqual(value);
  });

  it('decodes TILE/4 indexed arrays with primitive-typed columns', () => {
    const tile_v4 = [
      'TILE/4',
      'root@t0\ta0',
      '',
      't0\tarray\troot',
      '$id\t$idx:n\tvalue:s',
      'a0\t0\tone',
      'a0\t1\ttwo'
    ].join('\n');

    expect(decodeTileToJson(tile_v4)).toEqual(['one', 'two']);
  });

  it('decodes TILE/3 block output with reference-typed columns', () => {
    const tile_v3 = [
      'TILE/3',
      'root@t0\tr0',
      '',
      't0\tobject\troot',
      '$id\tname',
      'r0\ts:Ada'
    ].join('\n');

    expect(decodeTileToJson(tile_v3)).toEqual({ name: 'Ada' });
  });

  it('decodes TILE/2 block output with cell-level references', () => {
    const tile_v2 = [
      'TILE/2',
      'root\tr:t0:r0',
      '',
      't0\tobject\troot',
      '$id\tname',
      'r0\ts:Ada'
    ].join('\n');

    expect(decodeTileToJson(tile_v2)).toEqual({ name: 'Ada' });
  });

  it('decodes legacy TILE/1 row-labeled output', () => {
    const legacy_tile = [
      'TILE/1',
      'root\tr:t0:r0',
      'table\tt0\tobject\troot',
      'cols\t$id\tname',
      'row\tr0\ts:Ada'
    ].join('\n');

    expect(decodeTileToJson(legacy_tile)).toEqual({ name: 'Ada' });
  });

  it('reports compact json, pretty json, and tile size measurements', () => {
    const metrics = compareJsonTileSize({
      rows: Array.from({ length: 3 }, (_, index) => ({
        id: `row-${index}`,
        status: 'active'
      }))
    });
    const normalized_metrics = compareJsonTileSize(
      {
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
        actor: { id: 'u2', name: 'Grace', role: 'admin' }
      },
      { object_table_strategy: 'normalized_shape' }
    );

    expect(metrics.compact_json_chars).toBeGreaterThan(0);
    expect(metrics.pretty_json_chars).toBeGreaterThan(metrics.compact_json_chars);
    expect(metrics.tile_chars).toBeGreaterThan(0);
    expect(metrics.estimated_tile_tokens).toBe(Math.ceil(metrics.tile_chars / 4));
    expect(normalized_metrics.tile_chars).toBeGreaterThan(0);
  });

  it.each(fixture_names)(
    'round trips benchmark fixture %s through automatic TILE variants',
    (fixture_name) => {
      const fixture_json = JSON.parse(
        readFileSync(
          new URL(`../benchmarks/fixtures/${fixture_name}`, import.meta.url),
          'utf8'
        )
      ) as unknown;

      expect(decodeTileToJson(encodeJsonToTile(fixture_json))).toEqual(
        fixture_json
      );
      expect(
        decodeTileToJson(
          encodeJsonToTile(fixture_json, {
            object_table_strategy: 'normalized_shape'
          })
        )
      ).toEqual(fixture_json);
    }
  );

  it('rejects non-json values before encoding', () => {
    expect(() => encodeJsonToTile({ nope: undefined })).toThrow(
      'TILE only supports JSON values'
    );
    expect(() => encodeJsonToTile(Number.NaN)).toThrow(
      'TILE only supports finite JSON numbers'
    );
    const sparse_array = Array<number>(3);
    sparse_array[0] = 1;
    sparse_array[2] = 3;
    expect(() => encodeJsonToTile(sparse_array)).toThrow(
      'TILE only supports dense JSON arrays'
    );
  });

  it('rejects malformed escape sequences when decoding', () => {
    expect(escapeTileText('a\tb\nc\\d')).toBe('a\\tb\\nc\\\\d');
    expect(unescapeTileText('a\\tb\\nc\\\\d')).toBe('a\tb\nc\\d');
    expect(() => unescapeTileText('bad\\x')).toThrow('Invalid TILE escape');
  });
});
