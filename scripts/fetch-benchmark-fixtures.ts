import { mkdir, readFile, writeFile } from 'node:fs/promises';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const FIXTURE_DIR = new URL('../benchmarks/fixtures/', import.meta.url);

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const WIKIDATA_ENTITY_BASE_URL = 'https://www.wikidata.org/wiki/Special:EntityData';
const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const NPM_REGISTRY_BASE_URL = 'https://registry.npmjs.org';

const MUSICBRAINZ_ARTISTS = [
  {
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    name: 'Radiohead'
  },
  {
    id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',
    name: 'The Beatles'
  },
  {
    id: '83d91898-7763-47d7-b03b-b92132375c47',
    name: 'Pink Floyd'
  }
] as const;

const LARGE_MUSICBRAINZ_ARTISTS = [
  ...MUSICBRAINZ_ARTISTS,
  {
    id: '5b11f4ce-a62d-471e-81fc-a69a8278c7da',
    name: 'Nirvana'
  },
  {
    id: '65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab',
    name: 'Metallica'
  },
  {
    id: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3',
    name: 'Queen'
  },
  {
    id: 'b071f9fa-14b0-4217-8e97-eb41da73f598',
    name: 'The Rolling Stones'
  },
  {
    id: '5441c29d-3602-4898-b1a1-b77fa23b8e50',
    name: 'David Bowie'
  }
] as const;

const NPM_PACKAGES = [
  'express',
  'react',
  'vite',
  'typescript',
  '@vitejs/plugin-react'
] as const;

const LARGE_NPM_PACKAGES = [
  ...NPM_PACKAGES,
  'next',
  'vue',
  'svelte',
  '@sveltejs/kit',
  '@angular/core',
  'webpack',
  'rollup',
  'esbuild',
  'eslint',
  'prettier',
  'typescript-eslint',
  'vitest',
  'jest',
  'playwright',
  '@storybook/react-vite',
  'tailwindcss',
  'postcss',
  'sass',
  'lodash',
  'axios',
  'commander',
  'chalk',
  'debug',
  'dotenv',
  'zod',
  'yup',
  'react-dom',
  '@types/node',
  'fastify',
  'koa',
  'hono',
  '@nestjs/core',
  'rxjs',
  'date-fns',
  'dayjs',
  'uuid',
  'mongoose',
  'pg',
  'mysql2',
  'redis',
  'ioredis',
  'graphql',
  '@apollo/server',
  'yaml',
  'execa',
  'tsx',
  'tsup',
  'vitepress',
  'astro',
  'remix',
  'react-router',
  '@reduxjs/toolkit',
  'redux',
  'zustand',
  '@tanstack/react-query',
  '@tanstack/react-table',
  'framer-motion',
  'lucide-react',
  'classnames',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'radix-ui',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-select',
  '@radix-ui/react-tooltip',
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'd3',
  'chart.js',
  'recharts',
  'prisma',
  '@prisma/client',
  'drizzle-orm',
  'better-sqlite3',
  'socket.io',
  'ws',
  'bullmq',
  'minio',
  'sharp',
  'jimp',
  'pdf-lib',
  'puppeteer',
  'cypress',
  'mocha',
  'chai',
  'sinon',
  'msw',
  'nock',
  'supertest',
  'jsonwebtoken',
  'bcrypt',
  'bcryptjs',
  'passport',
  'helmet',
  'cors',
  'morgan',
  'winston',
  'pino',
  'nodemailer',
  'openai',
  'stripe'
] as const;

const SMALL_WIKIDATA_ENTITY_IDS = ['Q42', 'Q937', 'Q64', 'Q90', 'Q183'] as const;
const LARGE_WIKIDATA_ENTITY_IDS = [
  ...SMALL_WIKIDATA_ENTITY_IDS,
  'Q30',
  'Q145',
  'Q142',
  'Q38',
  'Q39',
  'Q148',
  'Q17',
  'Q155',
  'Q408',
  'Q60',
  'Q84',
  'Q65',
  'Q220',
  'Q1741',
  'Q76',
  'Q37181',
  'Q22686',
  'Q7186',
  'Q7259',
  'Q80',
  'Q762',
  'Q2831',
  'Q251',
  'Q392',
  'Q5582',
  'Q1035',
  'Q16475',
  'Q9372',
  'Q34660',
  'Q345'
] as const;

const SMALL_WIKIDATA_PROPERTY_IDS = [
  'P31',
  'P17',
  'P19',
  'P20',
  'P27',
  'P106',
  'P131',
  'P69',
  'P108'
] as const;
const LARGE_WIKIDATA_PROPERTY_IDS = [
  ...SMALL_WIKIDATA_PROPERTY_IDS,
  'P21',
  'P22',
  'P25',
  'P26',
  'P40',
  'P36',
  'P47',
  'P138',
  'P150',
  'P279',
  'P361',
  'P463',
  'P495',
  'P527',
  'P551',
  'P749',
  'P1376',
  'P1412'
] as const;

type BenchmarkProfile = {
  name: 'small' | 'large';
  osm_bbox: string;
  osm_node_limit: number;
  osm_way_limit: number;
  wikidata_entity_ids: readonly string[];
  wikidata_property_ids: readonly string[];
  wikidata_object_label_limit: number;
  musicbrainz_artists: readonly { id: string; name: string }[];
  musicbrainz_release_group_limit: number;
  npm_packages: readonly string[];
};

const PROFILE_NAME = process.env.TILE_BENCHMARK_PROFILE === 'small' ? 'small' : 'large';
const PROFILE: BenchmarkProfile =
  PROFILE_NAME === 'small'
    ? {
        name: 'small',
        osm_bbox: '40.729,-73.999,40.733,-73.994',
        osm_node_limit: 120,
        osm_way_limit: 40,
        wikidata_entity_ids: SMALL_WIKIDATA_ENTITY_IDS,
        wikidata_property_ids: SMALL_WIKIDATA_PROPERTY_IDS,
        wikidata_object_label_limit: 80,
        musicbrainz_artists: MUSICBRAINZ_ARTISTS,
        musicbrainz_release_group_limit: 25,
        npm_packages: NPM_PACKAGES
      }
    : {
        name: 'large',
        osm_bbox: '40.729,-73.999,40.733,-73.994',
        osm_node_limit: 900,
        osm_way_limit: 260,
        wikidata_entity_ids: LARGE_WIKIDATA_ENTITY_IDS,
        wikidata_property_ids: LARGE_WIKIDATA_PROPERTY_IDS,
        wikidata_object_label_limit: 360,
        musicbrainz_artists: LARGE_MUSICBRAINZ_ARTISTS,
        musicbrainz_release_group_limit: 100,
        npm_packages: LARGE_NPM_PACKAGES
      };

async function fetchText(
  url: string,
  init: RequestInit = {}
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'user-agent': '@software-dlc/tile benchmark fixture builder',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${String(response.status)}`);
  }

  return response.text();
}

async function fetchJson(
  url: string,
  init: RequestInit = {}
): Promise<JsonValue> {
  return JSON.parse(await fetchText(url, init)) as JsonValue;
}

function asObject(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactTags(tags: JsonValue | undefined): JsonObject {
  return Object.fromEntries(
    Object.entries(asObject(tags))
      .filter(([, value]) => typeof value === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

async function buildOsmFixture(): Promise<JsonObject> {
  const query = [
    '[out:json][timeout:60];',
    '(',
    `  node["amenity"~"cafe|restaurant|library"](${PROFILE.osm_bbox});`,
    `  way["highway"](${PROFILE.osm_bbox});`,
    ');',
    'out body;',
    '>;',
    'out skel qt;'
  ].join('\n');
  const document = asObject(
    await fetchJson(OVERPASS_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: query })
    })
  );
  const elements = asArray(document.elements);
  const nodes = elements
    .filter((element) => asString(asObject(element).type) === 'node')
    .slice(0, PROFILE.osm_node_limit)
    .map((element) => {
      const object = asObject(element);
      return {
        id: asNumber(object.id),
        lat: asNumber(object.lat),
        lon: asNumber(object.lon),
        tags: compactTags(object.tags)
      };
    });
  const ways = elements
    .filter((element) => asString(asObject(element).type) === 'way')
    .slice(0, PROFILE.osm_way_limit)
    .map((element) => {
      const object = asObject(element);
      return {
        id: asNumber(object.id),
        nodes: asArray(object.nodes).filter(
          (node): node is number => typeof node === 'number'
        ),
        tags: compactTags(object.tags)
      };
    });

  return {
    fixture: 'openstreetmap_extract',
    source: OVERPASS_URL,
    description:
      `${PROFILE.name} OpenStreetMap node/way/tag extract around Washington Square Park and Greenwich Village in New York City.`,
    profile: PROFILE.name,
    query,
    nodes,
    ways
  };
}

async function buildWikidataFixture(): Promise<JsonObject> {
  const entity_ids = [...PROFILE.wikidata_entity_ids];
  const property_ids = [...PROFILE.wikidata_property_ids];
  const label_by_id = new Map<string, string>();
  const triples: JsonObject[] = [];

  for (const entity_id of entity_ids) {
    let document: JsonObject;
    try {
      document = asObject(
        await fetchJson(`${WIKIDATA_ENTITY_BASE_URL}/${entity_id}.json`)
      );
    } catch (error) {
      console.warn(`Skipping Wikidata entity ${entity_id}: ${String(error)}`);
      continue;
    }
    const entity = asObject(asObject(document.entities)[entity_id]);
    const subject_label = asString(asObject(asObject(entity.labels).en).value);
    if (subject_label) {
      label_by_id.set(entity_id, subject_label);
    }

    const claims = asObject(entity.claims);
    property_ids.forEach((property_id) => {
      const property_claims = asArray(claims[property_id]);
      const preferred_claims = property_claims.filter(
        (claim) => asString(asObject(claim).rank) === 'preferred'
      );
      const selected_claims =
        preferred_claims.length > 0
          ? preferred_claims
          : property_claims.filter(
              (claim) => asString(asObject(claim).rank) !== 'deprecated'
            );

      selected_claims.forEach((claim) => {
        const mainsnak = asObject(asObject(claim).mainsnak);
        const datavalue = asObject(mainsnak.datavalue);
        const value = asObject(datavalue.value);
        const object_id = asString(value.id);
        if (!object_id) {
          return;
        }

        triples.push({
          subject_id: entity_id,
          subject_label,
          property_id,
          object_id,
          object_label: object_id
        });
      });
    });
  }

  const missing_object_ids = [
    ...new Set(
      triples
        .map((triple) => asString(triple.object_id))
        .filter((object_id): object_id is string => Boolean(object_id))
    )
  ].filter((object_id) => !label_by_id.has(object_id));
  for (const object_id of missing_object_ids.slice(0, PROFILE.wikidata_object_label_limit)) {
    let document: JsonObject;
    try {
      document = asObject(
        await fetchJson(`${WIKIDATA_ENTITY_BASE_URL}/${object_id}.json`)
      );
    } catch (error) {
      console.warn(`Skipping Wikidata label ${object_id}: ${String(error)}`);
      continue;
    }
    const entity = asObject(asObject(document.entities)[object_id]);
    const label = asString(asObject(asObject(entity.labels).en).value);
    if (label) {
      label_by_id.set(object_id, label);
    }
  }

  return {
    fixture: 'wikidata_truthy_triples',
    source: WIKIDATA_ENTITY_BASE_URL,
    description:
      `${PROFILE.name} truthy-style direct-claim Wikidata triples for selected people, places, and countries.`,
    profile: PROFILE.name,
    entity_ids,
    property_ids,
    triples: triples.map((triple) => ({
      ...triple,
      object_label:
        label_by_id.get(asString(triple.object_id) ?? '') ??
        asString(triple.object_label) ??
        null
    }))
  };
}

async function buildMusicBrainzFixture(): Promise<JsonObject> {
  const artists: JsonObject[] = [];
  const release_groups: JsonObject[] = [];

  for (const artist of PROFILE.musicbrainz_artists) {
    artists.push({
      id: artist.id,
      name: artist.name
    });

    const url = `${MUSICBRAINZ_BASE_URL}/release-group?${new URLSearchParams({
      artist: artist.id,
      type: 'album',
      limit: String(PROFILE.musicbrainz_release_group_limit),
      fmt: 'json'
    }).toString()}`;
    const document = asObject(await fetchJson(url));
    asArray(document['release-groups']).forEach((release_group) => {
      const object = asObject(release_group);
      release_groups.push({
        id: asString(object.id),
        artist_id: artist.id,
        artist_name: artist.name,
        title: asString(object.title),
        first_release_date: asString(object['first-release-date']),
        primary_type: asString(object['primary-type'])
      });
    });
  }

  return {
    fixture: 'musicbrainz_release_groups',
    source: MUSICBRAINZ_BASE_URL,
    description:
      `${PROFILE.name} MusicBrainz artist and album release-group rows for selected artists.`,
    profile: PROFILE.name,
    artists,
    release_groups
  };
}

async function buildNpmFixture(): Promise<JsonObject> {
  const packages: JsonObject[] = [];
  const dependencies: JsonObject[] = [];

  for (const package_name of PROFILE.npm_packages) {
    const encoded_name = package_name.replace('/', '%2F');
    let document: JsonObject;
    try {
      document = asObject(
        await fetchJson(`${NPM_REGISTRY_BASE_URL}/${encoded_name}/latest`)
      );
    } catch (error) {
      console.warn(`Skipping npm package ${package_name}: ${String(error)}`);
      continue;
    }
    const version = asString(document.version);
    packages.push({
      name: package_name,
      version,
      license: asString(document.license),
      dependency_count: Object.keys(asObject(document.dependencies)).length,
      peer_dependency_count: Object.keys(asObject(document.peerDependencies)).length
    });

    Object.entries(asObject(document.dependencies)).forEach(([dependency, range]) => {
      dependencies.push({
        package: package_name,
        version,
        type: 'dependency',
        dependency,
        range: asString(range)
      });
    });
    Object.entries(asObject(document.peerDependencies)).forEach(
      ([dependency, range]) => {
        dependencies.push({
          package: package_name,
          version,
          type: 'peerDependency',
          dependency,
          range: asString(range)
        });
      }
    );
  }

  return {
    fixture: 'npm_dependency_metadata',
    source: NPM_REGISTRY_BASE_URL,
    description:
      `${PROFILE.name} npm latest-version package metadata and dependency edges for selected packages.`,
    profile: PROFILE.name,
    packages,
    dependencies
  };
}

async function writeFixture(file_name: string, value: JsonValue): Promise<void> {
  await writeFile(new URL(file_name, FIXTURE_DIR), `${JSON.stringify(value, null, 2)}\n`);
}

async function buildOrReadExisting(
  file_name: string,
  builder: () => Promise<JsonObject>
): Promise<JsonObject> {
  try {
    return await builder();
  } catch (error) {
    console.warn(`Falling back to existing ${file_name}: ${String(error)}`);
    const existing_url = new URL(file_name, FIXTURE_DIR);
    try {
      return JSON.parse(await readFile(existing_url, 'utf8')) as JsonObject;
    } catch {
      throw error;
    }
  }
}

async function main(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  await writeFixture(
    'openstreetmap-extract.json',
    await buildOrReadExisting('openstreetmap-extract.json', buildOsmFixture)
  );
  await writeFixture(
    'wikidata-triples.json',
    await buildOrReadExisting('wikidata-triples.json', buildWikidataFixture)
  );
  await writeFixture(
    'musicbrainz-release-groups.json',
    await buildOrReadExisting(
      'musicbrainz-release-groups.json',
      buildMusicBrainzFixture
    )
  );
  await writeFixture(
    'npm-dependencies.json',
    await buildOrReadExisting('npm-dependencies.json', buildNpmFixture)
  );
}

await main();
