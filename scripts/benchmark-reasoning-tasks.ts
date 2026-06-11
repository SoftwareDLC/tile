import type { JsonValue } from '../src/index.js';
import {
  asArray,
  asObject,
  asString,
  sortStrings,
  type JsonObject,
  type ReasoningTask
} from './benchmark-utils.js';

function uniqueSorted(values: readonly string[]): string[] {
  return sortStrings([...new Set(values.filter((value) => value.length > 0))]);
}

function joinList(values: readonly string[]): string {
  return values.join('\n');
}

function cuisineTokens(value: JsonValue | undefined): string[] {
  return (asString(value) ?? '')
    .split(';')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function namedOsmNodes(value: JsonValue): JsonObject[] {
  return asArray(asObject(value).nodes)
    .map((entry) => asObject(entry))
    .filter((node) => Boolean(asString(asObject(node.tags).name)));
}

function namedOsmWays(value: JsonValue): JsonObject[] {
  return asArray(asObject(value).ways)
    .map((entry) => asObject(entry))
    .filter((way) => Boolean(asString(asObject(way.tags).name)));
}

function osmEastAsianFoodAndTeaVenues(value: JsonValue): string {
  const east_asian_cuisines = new Set([
    'bubble_tea',
    'chinese',
    'indonesian',
    'japanese',
    'korean',
    'malaysian',
    'ramen',
    'sushi',
    'thai'
  ]);

  return joinList(
    uniqueSorted(
      namedOsmNodes(value)
        .map((node) => asObject(node.tags))
        .filter((tags) => {
          const amenity = asString(tags.amenity);
          return amenity === 'cafe' || amenity === 'restaurant';
        })
        .filter((tags) =>
          cuisineTokens(tags.cuisine).some((token) => east_asian_cuisines.has(token))
        )
        .map((tags) => `${asString(tags.name) ?? ''}|${asString(tags.cuisine) ?? ''}`)
    )
  );
}

function osmCoffeeOrTeaCafes(value: JsonValue): string {
  return joinList(
    uniqueSorted(
      namedOsmNodes(value)
        .map((node) => asObject(node.tags))
        .filter((tags) => asString(tags.amenity) === 'cafe')
        .filter((tags) => {
          const name = (asString(tags.name) ?? '').toLowerCase();
          const brand = (asString(tags.brand) ?? '').toLowerCase();
          const tokens = cuisineTokens(tags.cuisine);
          return (
            tokens.includes('coffee_shop') ||
            tokens.includes('bubble_tea') ||
            name.includes('coffee') ||
            name.includes('tea') ||
            brand.includes('coffee') ||
            brand.includes('tea')
          );
        })
        .map((tags) => asString(tags.name) ?? '')
    )
  );
}

function osmPersonNamedWays(value: JsonValue): string {
  const person_name_terms = [
    'greene',
    'laguardia',
    'macdougal',
    'mercer',
    'schwartz',
    'sullivan',
    'thompson',
    'washington'
  ];

  return joinList(
    uniqueSorted(
      namedOsmWays(value)
        .map((way) => asObject(way.tags))
        .map((tags) => asString(tags.name) ?? '')
        .filter((name) => {
          const normalized = name.toLowerCase();
          return person_name_terms.some((term) => normalized.includes(term));
        })
    )
  );
}

function occupationsBySubject(value: JsonValue): Map<string, Set<string>> {
  const occupations = new Map<string, Set<string>>();
  asArray(asObject(value).triples)
    .map((entry) => asObject(entry))
    .filter((triple) => asString(triple.property_id) === 'P106')
    .forEach((triple) => {
      const subject = asString(triple.subject_label);
      const occupation = asString(triple.object_label);
      if (!subject || !occupation || occupation.startsWith('Q')) {
        return;
      }

      const subject_occupations = occupations.get(subject) ?? new Set<string>();
      subject_occupations.add(occupation);
      occupations.set(subject, subject_occupations);
    });

  return occupations;
}

function wikidataWriterMusicians(value: JsonValue): string {
  return joinList(
    uniqueSorted(
      [...occupationsBySubject(value).entries()]
        .filter(([, occupations]) => occupations.has('writer') && occupations.has('musician'))
        .map(([subject]) => subject)
    )
  );
}

function wikidataInventorMathematicianWriters(value: JsonValue): string {
  return joinList(
    uniqueSorted(
      [...occupationsBySubject(value).entries()]
        .filter(
          ([, occupations]) =>
            occupations.has('inventor') &&
            occupations.has('mathematician') &&
            occupations.has('writer')
        )
        .map(([subject]) => subject)
    )
  );
}

function wikidataDouglasAdamsCreativeOccupations(value: JsonValue): string {
  const creative_occupations = new Set([
    "children's writer",
    'comedian',
    'musician',
    'novelist',
    'playwright',
    'science fiction writer',
    'screenwriter',
    'writer'
  ]);
  const occupations = occupationsBySubject(value).get('Douglas Adams') ?? new Set();

  return joinList(
    uniqueSorted([...occupations].filter((occupation) => creative_occupations.has(occupation)))
  );
}

function releaseGroups(value: JsonValue): JsonObject[] {
  return asArray(asObject(value).release_groups).map((entry) => asObject(entry));
}

function musicBrainzDavidBowieSpaceStarTitles(value: JsonValue): string {
  const terms = [
    'moon',
    'space',
    'star',
    'starman',
    'ziggy'
  ];

  return joinList(
    uniqueSorted(
      releaseGroups(value)
        .filter((group) => asString(group.artist_name) === 'David Bowie')
        .filter((group) => {
          const title = (asString(group.title) ?? '').toLowerCase();
          return terms.some((term) => title.includes(term));
        })
        .map((group) => asString(group.title) ?? '')
    )
  );
}

function musicBrainzQueenBestCollectionTitles(value: JsonValue): string {
  const collection_terms = ['best', 'collection', 'greatest'];

  return joinList(
    uniqueSorted(
      releaseGroups(value)
        .filter((group) => asString(group.artist_name) === 'Queen')
        .filter((group) => {
          const title = (asString(group.title) ?? '').toLowerCase();
          return collection_terms.some((term) => title.includes(term));
        })
        .map((group) => asString(group.title) ?? '')
    )
  );
}

function musicBrainzLiveOrBroadcastRadioheadTitles(value: JsonValue): string {
  const live_terms = [
    'bbc',
    'broadcast',
    'concert',
    'festival',
    'from the basement',
    'glastonbury',
    'live',
    'session',
    'unplugged'
  ];

  return joinList(
    uniqueSorted(
      releaseGroups(value)
        .filter((group) => asString(group.artist_name) === 'Radiohead')
        .filter((group) => {
          const title = (asString(group.title) ?? '').toLowerCase();
          return live_terms.some((term) => title.includes(term)) || /^\d{4}/.test(title);
        })
        .map((group) => asString(group.title) ?? '')
    )
  );
}

function packageNames(value: JsonValue): string[] {
  return asArray(asObject(value).packages)
    .map((entry) => asString(asObject(entry).name) ?? '')
    .filter((name) => name.length > 0);
}

function npmReactEcosystemPackages(value: JsonValue): string {
  const react_packages = new Set<string>();

  asArray(asObject(value).dependencies)
    .map((entry) => asObject(entry))
    .forEach((dependency) => {
      const package_name = asString(dependency.package);
      const dependency_name = asString(dependency.dependency);
      if (
        package_name &&
        (package_name.includes('react') ||
          dependency_name === 'react' ||
          dependency_name === 'react-dom')
      ) {
        react_packages.add(package_name);
      }
    });

  packageNames(value)
    .filter((name) => name.includes('react'))
    .forEach((name) => react_packages.add(name));

  return joinList(uniqueSorted([...react_packages]));
}

function npmDatabaseAndStoragePackages(value: JsonValue): string {
  const terms = [
    'drizzle',
    'ioredis',
    'minio',
    'mongoose',
    'mysql',
    'pg',
    'prisma',
    'redis',
    'sqlite'
  ];

  return joinList(
    uniqueSorted(
      packageNames(value).filter((name) =>
        terms.some((term) => name.toLowerCase().includes(term))
      )
    )
  );
}

function npmTestingAndMockingPackages(value: JsonValue): string {
  const testing_packages = new Set([
    'chai',
    'cypress',
    'jest',
    'mocha',
    'msw',
    'nock',
    'playwright',
    'sinon',
    'supertest',
    'vitest'
  ]);

  return joinList(uniqueSorted(packageNames(value).filter((name) => testing_packages.has(name))));
}

export function buildReasoningTasks(values: Map<string, JsonValue>): ReasoningTask[] {
  const osm_value = values.get('openstreetmap_extract');
  const wikidata_value = values.get('wikidata_truthy_triples');
  const musicbrainz_value = values.get('musicbrainz_release_groups');
  const npm_value = values.get('npm_dependency_metadata');

  if (!osm_value || !wikidata_value || !musicbrainz_value || !npm_value) {
    throw new Error('Missing one or more fixtures');
  }

  return [
    {
      fixture: 'openstreetmap_extract',
      id: 'osm_east_asian_food_and_tea_venues',
      question:
        'Using venue names plus amenity/cuisine tags, list cafes or restaurants whose cuisine tag indicates East or Southeast Asian food, tea, noodles, ramen, sushi, Korean, Chinese, Japanese, Malaysian, Thai, Indonesian, or bubble tea. Answer as name|cuisine entries sorted alphabetically by name, one entry per line.',
      expected_answer: osmEastAsianFoodAndTeaVenues(osm_value),
      perceived_difficulty: 3,
      difficulty_label: 'semantic filtering',
      difficulty_reason:
        'Requires interpreting cuisine tags as a regional/theme category rather than computing over ids.'
    },
    {
      fixture: 'openstreetmap_extract',
      id: 'osm_coffee_or_tea_cafes',
      question:
        'List cafe venues that are clearly coffee or tea oriented based on cuisine, brand, or name. Include coffee_shop and bubble_tea cafes. Answer as venue names sorted alphabetically, one entry per line.',
      expected_answer: osmCoffeeOrTeaCafes(osm_value),
      perceived_difficulty: 3,
      difficulty_label: 'semantic filtering',
      difficulty_reason:
        'Requires combining name, brand, amenity, and cuisine signals into a human category.'
    },
    {
      fixture: 'openstreetmap_extract',
      id: 'osm_person_named_ways',
      question:
        'Which unique OSM way names appear to include person surnames or famous-person references such as Washington, Sullivan, MacDougal, LaGuardia, Thompson, Greene, Mercer, or Schwartz? Answer with unique way names sorted alphabetically, one entry per line.',
      expected_answer: osmPersonNamedWays(osm_value),
      perceived_difficulty: 3,
      difficulty_label: 'semantic name classification',
      difficulty_reason:
        'Requires classifying place names by likely person-name references instead of graph traversal.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'wikidata_writer_musicians',
      question:
        'Using P106 occupation claims, list subjects whose labeled occupations include both writer and musician. Ignore unlabeled Q-id occupation values. Answer subject labels sorted alphabetically, one entry per line.',
      expected_answer: wikidataWriterMusicians(wikidata_value),
      perceived_difficulty: 3,
      difficulty_label: 'semantic claim grouping',
      difficulty_reason:
        'Requires grouping claims by subject and matching human-readable occupation labels.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'wikidata_inventor_mathematician_writers',
      question:
        'Using P106 occupation claims, list subjects whose labeled occupations include inventor, mathematician, and writer. Ignore unlabeled Q-id occupation values. Answer subject labels sorted alphabetically, one entry per line.',
      expected_answer: wikidataInventorMathematicianWriters(wikidata_value),
      perceived_difficulty: 3,
      difficulty_label: 'semantic claim grouping',
      difficulty_reason:
        'Requires recognizing a polymath-like occupation combination from local subject claims.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'wikidata_douglas_adams_creative_occupations',
      question:
        'For Douglas Adams, list the labeled P106 occupations that are creative writing, performance, or music roles. Answer occupation labels sorted alphabetically, one entry per line.',
      expected_answer: wikidataDouglasAdamsCreativeOccupations(wikidata_value),
      perceived_difficulty: 2,
      difficulty_label: 'local semantic extraction',
      difficulty_reason:
        'Requires staying within one subject and selecting creative-role occupation labels.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'musicbrainz_david_bowie_space_star_titles',
      question:
        'For David Bowie only, list release-group titles with space, moon, star, Starman, or Ziggy imagery. Answer titles sorted alphabetically, one entry per line.',
      expected_answer: musicBrainzDavidBowieSpaceStarTitles(musicbrainz_value),
      perceived_difficulty: 3,
      difficulty_label: 'artist-local title classification',
      difficulty_reason:
        'Requires staying within one artist group and interpreting title words as a space/star imagery category.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'musicbrainz_queen_best_collection_titles',
      question:
        'For Queen only, list release-group titles that look like best-of, greatest-hits, or collection releases based on the title text. Answer titles sorted alphabetically, one entry per line.',
      expected_answer: musicBrainzQueenBestCollectionTitles(musicbrainz_value),
      perceived_difficulty: 3,
      difficulty_label: 'artist-local title classification',
      difficulty_reason:
        'Requires staying within one artist group and classifying titles by release purpose.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'musicbrainz_radiohead_live_or_broadcast_titles',
      question:
        'For Radiohead only, list release-group titles that look like live, concert, broadcast, BBC, session, festival, dated-performance, or unplugged releases. Answer titles sorted alphabetically, one entry per line.',
      expected_answer: musicBrainzLiveOrBroadcastRadioheadTitles(musicbrainz_value),
      perceived_difficulty: 3,
      difficulty_label: 'title-context classification',
      difficulty_reason:
        'Requires recognizing performance/broadcast context from title wording.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'npm_react_ecosystem_packages',
      question:
        'List selected packages that are clearly part of the React ecosystem because their package name contains react or their dependency edges include react or react-dom. Answer package names sorted alphabetically, one entry per line.',
      expected_answer: npmReactEcosystemPackages(npm_value),
      perceived_difficulty: 3,
      difficulty_label: 'package role classification',
      difficulty_reason:
        'Requires combining package names with dependency edges to identify framework ecosystem membership.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'npm_database_and_storage_packages',
      question:
        'List selected packages that are database, cache, ORM, SQL, or object-storage related based on package names such as prisma, drizzle, redis, sqlite, pg, mysql, mongoose, or minio. Answer package names sorted alphabetically, one entry per line.',
      expected_answer: npmDatabaseAndStoragePackages(npm_value),
      perceived_difficulty: 2,
      difficulty_label: 'package role classification',
      difficulty_reason:
        'Requires semantic package-name grouping rather than dependency counting.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'npm_testing_and_mocking_packages',
      question:
        'List selected packages that are testing, browser automation, assertion, mocking, or HTTP-test tools: include tools like test runners, e2e runners, assertion libraries, mocking libraries, and supertest-style HTTP testing. Do not include linters or formatters. Answer package names sorted alphabetically, one entry per line.',
      expected_answer: npmTestingAndMockingPackages(npm_value),
      perceived_difficulty: 3,
      difficulty_label: 'package role classification',
      difficulty_reason:
        'Requires semantic package-role grouping from names and familiar library roles.'
    }
  ];
}
