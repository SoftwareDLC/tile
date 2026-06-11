import type { JsonTileFirstClassTable, JsonValue } from '../src/index.js';
import {
  asArray,
  asObject,
  asString,
  continuationCell,
  firstClassCell,
  type JsonObject
} from './benchmark-utils.js';

function osmFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const node_rows = asArray(asObject(value).nodes)
    .map((node) => asObject(node))
    .map((node) => {
      const tags = asObject(node.tags);

      return [
        firstClassCell(node.id),
        firstClassCell(tags.name),
        firstClassCell(tags.amenity),
        firstClassCell(tags.cuisine),
        firstClassCell(tags.brand),
        firstClassCell(tags.shop),
        firstClassCell(tags.tourism)
      ];
    })
    .filter((row) => row.some((cell, index) => index > 0 && cell !== undefined));
  const way_rows = asArray(asObject(value).ways)
    .map((way) => asObject(way))
    .map((way) => {
      const tags = asObject(way.tags);

      return [
        firstClassCell(way.id),
        firstClassCell(tags.name),
        firstClassCell(tags.highway)
      ];
    })
    .filter((row) => row.some((cell, index) => index > 0 && cell !== undefined));

  return [
    {
      id: 'osm_named_nodes',
      kind: 'named_nodes',
      path: 'osm.nodes.tags',
      columns: ['node_id', 'name', 'amenity', 'cuisine', 'brand', 'shop', 'tourism'],
      rows: node_rows
    },
    {
      id: 'osm_named_ways',
      kind: 'named_ways',
      path: 'osm.ways.tags',
      columns: ['way_id', 'name', 'highway'],
      rows: way_rows
    }
  ];
}

function osmFeatureRows(value: JsonValue): JsonTileFirstClassTable['rows'] {
  const node_rows = asArray(asObject(value).nodes)
    .map((node) => asObject(node))
    .map((node) => {
      const tags = asObject(node.tags);

      return [
        'node',
        firstClassCell(node.id),
        firstClassCell(tags.name),
        firstClassCell(tags.highway),
        firstClassCell(tags.amenity),
        firstClassCell(tags.cuisine),
        firstClassCell(tags.brand),
        firstClassCell(tags.shop),
        firstClassCell(tags.tourism)
      ];
    })
    .filter((row) => row.some((cell, index) => index > 1 && cell !== undefined));
  const way_rows = asArray(asObject(value).ways)
    .map((way) => asObject(way))
    .map((way) => {
      const tags = asObject(way.tags);

      return [
        'way',
        firstClassCell(way.id),
        firstClassCell(tags.name),
        firstClassCell(tags.highway),
        firstClassCell(tags.amenity),
        firstClassCell(tags.cuisine),
        firstClassCell(tags.brand),
        firstClassCell(tags.shop),
        firstClassCell(tags.tourism)
      ];
    })
    .filter((row) => row.some((cell, index) => index > 1 && cell !== undefined));

  return [...node_rows, ...way_rows];
}

function osmFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const rows = osmFeatureRows(value).map((row, index) => [
    continuationCell(index, 'all'),
    ...row
  ]);

  return [
    {
      id: 'osm_named_features_embedded',
      kind: 'named_features',
      path: 'osm.features.tags',
      columns: [
        'feature_group',
        {
          embedded_columns: [
            'feature_type',
            'id',
            'name',
            'highway',
            'amenity',
            'cuisine',
            'brand',
            'shop',
            'tourism'
          ]
        }
      ],
      rows
    }
  ];
}

function wikidataFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const occupation_rows = asArray(asObject(value).triples)
    .map((triple) => asObject(triple))
    .filter((triple) => asString(triple.property_id) === 'P106')
    .map((triple) => [
      firstClassCell(triple.subject_label),
      firstClassCell(triple.object_label)
    ])
    .filter((row) => row.every((cell) => cell !== undefined));

  return [
    {
      id: 'wikidata_subject_occupations',
      kind: 'subject_occupations',
      path: 'wikidata.triples.P106',
      columns: ['subject_label', 'occupation_label'],
      rows: occupation_rows
    }
  ];
}

function wikidataFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const occupations_by_subject = new Map<string, string[]>();
  for (const triple of asArray(asObject(value).triples).map((entry) => asObject(entry))) {
    if (asString(triple.property_id) !== 'P106') {
      continue;
    }

    const subject_id = asString(triple.subject_id);
    const subject_label = asString(triple.subject_label);
    const occupation_label = asString(triple.object_label);
    if (!subject_id || !subject_label || !occupation_label) {
      continue;
    }

    const key = `${subject_id}\u0000${subject_label}`;
    const occupations = occupations_by_subject.get(key) ?? [];
    occupations.push(occupation_label);
    occupations_by_subject.set(key, occupations);
  }

  const rows = [...occupations_by_subject.entries()].flatMap(([key, occupations]) => {
    const [, subject_label] = key.split('\u0000');
    const unique_occupations = [...new Set(occupations)].sort((left, right) =>
      left.localeCompare(right)
    );

    return unique_occupations.map((occupation_label, index) => [
      continuationCell(index, subject_label),
      firstClassCell(occupation_label)
    ]);
  });

  return [
    {
      id: 'wikidata_subject_occupations_embedded',
      kind: 'subject_occupations',
      path: 'wikidata.subjects.occupations',
      columns: [
        'subject_label',
        {
          embedded_columns: ['occupation_label']
        }
      ],
      rows
    }
  ];
}

function musicBrainzFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const target_artists = new Set(['David Bowie', 'Queen', 'Radiohead']);
  const release_group_rows = asArray(asObject(value).release_groups).map(
    (release_group) => {
      const object = asObject(release_group);
      return [
        firstClassCell(object.artist_name),
        firstClassCell(object.title)
      ];
    }
  ).filter((row) => typeof row[0] === 'string' && target_artists.has(row[0]));

  return [
    {
      id: 'musicbrainz_release_titles',
      kind: 'release_titles',
      path: 'musicbrainz.release_groups.titles',
      columns: ['artist_name', 'title'],
      rows: release_group_rows
    }
  ];
}

function musicBrainzFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const target_artists = new Set(['David Bowie', 'Queen', 'Radiohead']);
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
    const artist_name = asString(object.name);
    if (!artist_name || !target_artists.has(artist_name)) {
      return [];
    }

    const release_groups = release_groups_by_artist.get(artist_id ?? '') ?? [];

    return release_groups.map((release_group, index) => [
      continuationCell(index, artist_name),
      firstClassCell(release_group.title)
    ]);
  });

  return [
    {
      id: 'musicbrainz_artist_titles_embedded',
      kind: 'artist_titles',
      path: 'musicbrainz.artists.titles',
      columns: [
        'artist_name',
        {
          embedded_columns: ['title']
        }
      ],
      rows
    }
  ];
}

function npmFirstClassTables(value: JsonValue): JsonTileFirstClassTable[] {
  const package_rows = asArray(asObject(value).packages).map((pkg) => {
    const object = asObject(pkg);
    return [firstClassCell(object.name)];
  });
  const dependency_rows = asArray(asObject(value).dependencies)
    .map((dependency) => asObject(dependency))
    .filter((dependency) => {
      const dependency_name = asString(dependency.dependency);
      return dependency_name === 'react' || dependency_name === 'react-dom';
    })
    .map((dependency) => [
      firstClassCell(dependency.package),
      firstClassCell(dependency.dependency)
    ]);

  return [
    {
      id: 'npm_packages',
      kind: 'packages',
      path: 'npm.packages',
      columns: ['package_name'],
      rows: package_rows
    },
    {
      id: 'npm_dependencies',
      kind: 'dependencies',
      path: 'npm.dependencies',
      columns: ['package_name', 'dependency_name'],
      rows: dependency_rows
    }
  ];
}

function npmFirstClassEmbeddedTables(value: JsonValue): JsonTileFirstClassTable[] {
  const package_rows = asArray(asObject(value).packages).map((pkg) => {
    const object = asObject(pkg);
    return [firstClassCell(object.name)];
  });
  const dependencies_by_package = new Map<string, JsonObject[]>();
  for (const dependency of asArray(asObject(value).dependencies).map((entry) =>
    asObject(entry)
  )) {
    const package_name = asString(dependency.package);
    if (!package_name) {
      continue;
    }

    if (
      asString(dependency.dependency) !== 'react' &&
      asString(dependency.dependency) !== 'react-dom'
    ) {
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
      firstClassCell(dependency.dependency)
    ]);
  });

  return [
    {
      id: 'npm_selected_packages',
      kind: 'selected_packages',
      path: 'npm.packages',
      columns: ['package_name'],
      rows: package_rows
    },
    {
      id: 'npm_package_dependencies_embedded',
      kind: 'package_dependencies',
      path: 'npm.packages.dependencies',
      columns: [
        'package_name',
        {
          embedded_columns: ['dependency_name']
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
