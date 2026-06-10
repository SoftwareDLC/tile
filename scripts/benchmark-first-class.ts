import type { JsonTileFirstClassTable, JsonValue } from '../src/index.js';
import {
  asArray,
  asNumber,
  asObject,
  asString,
  continuationCell,
  firstClassCell,
  type JsonObject
} from './benchmark-utils.js';

function osmFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const ways = asArray(asObject(value).ways);
  const way_rows = ways.map((way) => {
    const object = asObject(way);
    const node_refs = asArray(object.nodes);
    return [
      firstClassCell(object.id),
      node_refs.length,
      firstClassCell(asObject(object.tags).highway),
      firstClassCell(asObject(object.tags).name)
    ];
  });
  const way_node_rows = ways.flatMap((way) => {
    const object = asObject(way);
    return asArray(object.nodes).map((node_ref, index) => [
      firstClassCell(object.id),
      index,
      firstClassCell(node_ref)
    ]);
  });

  return [
    {
      id: 'osm_ways',
      kind: 'way_summary',
      path: 'osm.ways.summary',
      columns: ['id', 'node_count', 'highway', 'name'],
      rows: way_rows
    },
    {
      id: 'osm_way_nodes',
      kind: 'way_nodes',
      path: 'osm.ways.nodes',
      columns: ['way_id', 'node_index', 'node_ref'],
      rows: way_node_rows
    }
  ];
}

function osmFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const nodes_by_id = new Map(
    asArray(asObject(value).nodes)
      .map((node) => asObject(node))
      .map((node) => [asNumber(node.id), node] as const)
      .filter((entry): entry is readonly [number, JsonObject] => entry[0] !== null)
  );
  const rows = asArray(asObject(value).ways).flatMap((way) => {
    const object = asObject(way);
    const tags = asObject(object.tags);
    const node_refs = asArray(object.nodes);

    return node_refs.map((node_ref, index) => {
      const node_ref_id = asNumber(node_ref);
      const node = node_ref_id === null ? undefined : nodes_by_id.get(node_ref_id);
      const node_tags = asObject(node?.tags);

      return [
        continuationCell(index, object.id),
        continuationCell(index, node_refs.length),
        continuationCell(index, tags.highway),
        continuationCell(index, tags.name),
        index,
        firstClassCell(node_ref),
        node_tags.amenity ? 'yes' : 'no',
        firstClassCell(node_tags.amenity),
        firstClassCell(node_tags.name)
      ];
    });
  });

  return [
    {
      id: 'osm_way_nodes_embedded',
      kind: 'way_nodes',
      path: 'osm.ways.nodes',
      columns: [
        'way_id',
        'node_count',
        'highway',
        'way_name',
        {
          embedded_columns: [
            'node_index',
            'node_ref',
            'node_has_tags',
            'node_amenity',
            'node_name'
          ]
        }
      ],
      rows
    }
  ];
}

function wikidataFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const triple_rows = asArray(asObject(value).triples).map((triple) => {
    const object = asObject(triple);
    return [
      firstClassCell(object.subject_id),
      firstClassCell(object.subject_label),
      firstClassCell(object.property_id),
      firstClassCell(object.property_label),
      firstClassCell(object.object_id),
      firstClassCell(object.object_label)
    ];
  });

  return [
    {
      id: 'wikidata_triples',
      kind: 'triples',
      path: 'wikidata.triples',
      columns: [
        'subject_id',
        'subject_label',
        'property_id',
        'property_label',
        'object_id',
        'object_label'
      ],
      rows: triple_rows
    }
  ];
}

function wikidataFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const triples_by_subject = new Map<string, JsonObject[]>();
  for (const triple of asArray(asObject(value).triples).map((entry) => asObject(entry))) {
    const subject_id = asString(triple.subject_id);
    if (!subject_id) {
      continue;
    }

    const triples = triples_by_subject.get(subject_id) ?? [];
    triples.push(triple);
    triples_by_subject.set(subject_id, triples);
  }

  const rows = [...triples_by_subject.entries()].flatMap(([, triples]) => {
    const first_triple = triples[0];

    return triples.map((triple, index) => [
      continuationCell(index, first_triple?.subject_id),
      continuationCell(index, first_triple?.subject_label),
      firstClassCell(triple.property_id),
      firstClassCell(triple.property_label),
      firstClassCell(triple.object_id),
      firstClassCell(triple.object_label)
    ]);
  });

  return [
    {
      id: 'wikidata_subject_claims_embedded',
      kind: 'subject_claims',
      path: 'wikidata.subjects.claims',
      columns: [
        'subject_id',
        'subject_label',
        {
          embedded_columns: [
            'property_id',
            'property_label',
            'object_id',
            'object_label'
          ]
        }
      ],
      rows
    }
  ];
}

function musicBrainzFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const artist_rows = asArray(asObject(value).artists).map((artist) => {
    const object = asObject(artist);
    return [firstClassCell(object.id), firstClassCell(object.name)];
  });
  const release_group_rows = asArray(asObject(value).release_groups).map(
    (release_group) => {
      const object = asObject(release_group);
      return [
        firstClassCell(object.id),
        firstClassCell(object.artist_id),
        firstClassCell(object.artist_name),
        firstClassCell(object.title),
        firstClassCell(object.first_release_date),
        firstClassCell(object.primary_type)
      ];
    }
  );

  return [
    {
      id: 'musicbrainz_artists',
      kind: 'artists',
      path: 'musicbrainz.artists',
      columns: ['id', 'name'],
      rows: artist_rows
    },
    {
      id: 'musicbrainz_release_groups',
      kind: 'release_groups',
      path: 'musicbrainz.release_groups',
      columns: [
        'id',
        'artist_id',
        'artist_name',
        'title',
        'first_release_date',
        'primary_type'
      ],
      rows: release_group_rows
    }
  ];
}

function musicBrainzFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const release_groups_by_artist = new Map<string, JsonObject[]>();
  for (const release_group of asArray(asObject(value).release_groups).map((entry) =>
    asObject(entry)
  )) {
    const artist_id = asString(release_group.artist_id);
    if (!artist_id) {
      continue;
    }

    const release_groups = release_groups_by_artist.get(artist_id) ?? [];
    release_groups.push(release_group);
    release_groups_by_artist.set(artist_id, release_groups);
  }

  const rows = asArray(asObject(value).artists).flatMap((artist) => {
    const object = asObject(artist);
    const artist_id = asString(object.id);
    const release_groups = release_groups_by_artist.get(artist_id ?? '') ?? [];

    return release_groups.map((release_group, index) => [
      continuationCell(index, object.id),
      continuationCell(index, object.name),
      firstClassCell(release_group.id),
      firstClassCell(release_group.title),
      firstClassCell(release_group.first_release_date),
      firstClassCell(release_group.primary_type)
    ]);
  });

  return [
    {
      id: 'musicbrainz_artist_release_groups_embedded',
      kind: 'artist_release_groups',
      path: 'musicbrainz.artists.release_groups',
      columns: [
        'artist_id',
        'artist_name',
        {
          embedded_columns: [
            'release_group_id',
            'title',
            'first_release_date',
            'primary_type'
          ]
        }
      ],
      rows
    }
  ];
}

function npmFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const package_rows = asArray(asObject(value).packages).map((pkg) => {
    const object = asObject(pkg);
    return [
      firstClassCell(object.name),
      firstClassCell(object.version),
      firstClassCell(object.license),
      firstClassCell(object.dependency_count),
      firstClassCell(object.peer_dependency_count)
    ];
  });
  const dependency_rows = asArray(asObject(value).dependencies).map((dependency) => {
    const object = asObject(dependency);
    return [
      firstClassCell(object.package),
      firstClassCell(object.version),
      firstClassCell(object.type),
      firstClassCell(object.dependency),
      firstClassCell(object.range)
    ];
  });

  return [
    {
      id: 'npm_packages',
      kind: 'packages',
      path: 'npm.packages',
      columns: [
        'name',
        'version',
        'license',
        'dependency_count',
        'peer_dependency_count'
      ],
      rows: package_rows
    },
    {
      id: 'npm_dependencies',
      kind: 'dependencies',
      path: 'npm.dependencies',
      columns: ['package', 'version', 'type', 'dependency', 'range'],
      rows: dependency_rows
    }
  ];
}

function npmFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const dependencies_by_package = new Map<string, JsonObject[]>();
  for (const dependency of asArray(asObject(value).dependencies).map((entry) =>
    asObject(entry)
  )) {
    const package_name = asString(dependency.package);
    if (!package_name) {
      continue;
    }

    const dependencies = dependencies_by_package.get(package_name) ?? [];
    dependencies.push(dependency);
    dependencies_by_package.set(package_name, dependencies);
  }

  const rows = asArray(asObject(value).packages).flatMap((pkg) => {
    const object = asObject(pkg);
    const package_name = asString(object.name);
    const dependencies = dependencies_by_package.get(package_name ?? '') ?? [];
    const embedded_rows = dependencies.length > 0 ? dependencies : [{}];

    return embedded_rows.map((dependency, index) => [
      continuationCell(index, object.name),
      continuationCell(index, object.version),
      continuationCell(index, object.license),
      continuationCell(index, object.dependency_count),
      continuationCell(index, object.peer_dependency_count),
      firstClassCell(dependency.type),
      firstClassCell(dependency.dependency),
      firstClassCell(dependency.range)
    ]);
  });

  return [
    {
      id: 'npm_package_dependencies_embedded',
      kind: 'package_dependencies',
      path: 'npm.packages.dependencies',
      columns: [
        'package',
        'version',
        'license',
        'dependency_count',
        'peer_dependency_count',
        {
          embedded_columns: ['dependency_type', 'dependency', 'range']
        }
      ],
      rows
    }
  ];
}

export function firstClassTablesForFixture(
  fixture_id: string,
  value: JsonValue
): JsonTileFirstClassTable[] {
  if (fixture_id === 'openstreetmap_extract') {
    return osmFirstClassTables(value);
  }

  if (fixture_id === 'wikidata_truthy_triples') {
    return wikidataFirstClassTables(value);
  }

  if (fixture_id === 'musicbrainz_release_groups') {
    return musicBrainzFirstClassTables(value);
  }

  if (fixture_id === 'npm_dependency_metadata') {
    return npmFirstClassTables(value);
  }

  throw new Error(`No first-class table builder for ${fixture_id}`);
}

export function firstClassEmbeddedTablesForFixture(
  fixture_id: string,
  value: JsonValue
): JsonTileFirstClassTable[] {
  if (fixture_id === 'openstreetmap_extract') {
    return osmFirstClassEmbeddedTables(value);
  }

  if (fixture_id === 'wikidata_truthy_triples') {
    return wikidataFirstClassEmbeddedTables(value);
  }

  if (fixture_id === 'musicbrainz_release_groups') {
    return musicBrainzFirstClassEmbeddedTables(value);
  }

  if (fixture_id === 'npm_dependency_metadata') {
    return npmFirstClassEmbeddedTables(value);
  }

  throw new Error(`No first-class embedded table builder for ${fixture_id}`);
}
