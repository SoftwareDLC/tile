import type { JsonValue } from '../src/index.js';
import {
  asArray,
  asNumber,
  asObject,
  asString,
  joinAnswer,
  sortStrings,
  type JsonObject,
  type ReasoningTask
} from './benchmark-utils.js';

function osmLongestWayNodeWindow(value: JsonValue): string {
  const top_way = asArray(asObject(value).ways)
    .map((way) => asObject(way))
    .sort((left, right) => {
      const node_delta = asArray(right.nodes).length - asArray(left.nodes).length;
      if (node_delta !== 0) {
        return node_delta;
      }

      return (asNumber(left.id) ?? 0) - (asNumber(right.id) ?? 0);
    })[0];
  if (!top_way) {
    throw new Error('OSM fixture has no ways');
  }

  const nodes = asArray(top_way.nodes)
    .map((node_ref) => asNumber(node_ref))
    .filter((node_ref): node_ref is number => node_ref !== null);
  const middle_index = Math.floor(nodes.length / 2);
  const previous_index = Math.max(0, middle_index - 1);

  return joinAnswer([
    asNumber(top_way.id) ?? '',
    asString(asObject(top_way.tags).highway) ?? '',
    nodes.length,
    previous_index,
    nodes[previous_index] ?? '',
    middle_index,
    nodes[middle_index] ?? ''
  ]);
}

function osmClosestConsecutiveNodeRefs(value: JsonValue): string {
  const candidates: {
    gap: number;
    way_id: number;
    highway: string;
    index: number;
    left_ref: number;
    right_ref: number;
  }[] = [];

  for (const way of asArray(asObject(value).ways).map((entry) => asObject(entry))) {
    const way_id = asNumber(way.id);
    const highway = asString(asObject(way.tags).highway);
    if (way_id === null || !highway) {
      continue;
    }

    const nodes = asArray(way.nodes)
      .map((node_ref) => asNumber(node_ref))
      .filter((node_ref): node_ref is number => node_ref !== null);
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const left_ref = nodes[index];
      const right_ref = nodes[index + 1];
      if (typeof left_ref === 'undefined' || typeof right_ref === 'undefined') {
        continue;
      }

      candidates.push({
        gap: Math.abs(right_ref - left_ref),
        way_id,
        highway,
        index,
        left_ref,
        right_ref
      });
    }
  }

  const candidate = candidates.sort((left, right) => {
    if (left.gap !== right.gap) {
      return left.gap - right.gap;
    }
    if (left.way_id !== right.way_id) {
      return left.way_id - right.way_id;
    }
    return left.index - right.index;
  })[0];
  if (!candidate) {
    throw new Error('OSM fixture has no consecutive way node pairs');
  }

  return joinAnswer([
    candidate.way_id,
    candidate.highway,
    candidate.index,
    candidate.left_ref,
    candidate.right_ref
  ]);
}

function osmLowestSharedNodePairDetails(value: JsonValue): string {
  const ways = asArray(asObject(value).ways).map((way) => asObject(way));
  const candidates: {
    left_id: number;
    left_highway: string;
    right_id: number;
    right_highway: string;
    node_ref: number;
  }[] = [];

  for (let left_index = 0; left_index < ways.length; left_index += 1) {
    for (let right_index = left_index + 1; right_index < ways.length; right_index += 1) {
      const left = ways[left_index];
      const right = ways[right_index];
      const left_id = asNumber(left?.id);
      const right_id = asNumber(right?.id);
      const left_highway = asString(asObject(left?.tags).highway);
      const right_highway = asString(asObject(right?.tags).highway);
      if (left_id === null || right_id === null || !left_highway || !right_highway) {
        continue;
      }

      const right_nodes = new Set(
        asArray(right?.nodes)
          .map((node_ref) => asNumber(node_ref))
          .filter((node_ref): node_ref is number => node_ref !== null)
      );
      for (const node_ref of asArray(left?.nodes)
        .map((entry) => asNumber(entry))
        .filter((entry): entry is number => entry !== null)) {
        if (right_nodes.has(node_ref)) {
          const ordered_left =
            left_id < right_id
              ? { id: left_id, highway: left_highway }
              : { id: right_id, highway: right_highway };
          const ordered_right =
            left_id < right_id
              ? { id: right_id, highway: right_highway }
              : { id: left_id, highway: left_highway };
          candidates.push({
            left_id: ordered_left.id,
            left_highway: ordered_left.highway,
            right_id: ordered_right.id,
            right_highway: ordered_right.highway,
            node_ref
          });
        }
      }
    }
  }

  const candidate = candidates.sort((left, right) => {
    if (left.node_ref !== right.node_ref) {
      return left.node_ref - right.node_ref;
    }
    if (left.left_id !== right.left_id) {
      return left.left_id - right.left_id;
    }
    return left.right_id - right.right_id;
  })[0];
  if (!candidate) {
    throw new Error('OSM fixture has no shared way nodes');
  }

  return joinAnswer([
    candidate.left_id,
    candidate.left_highway,
    candidate.right_id,
    candidate.right_highway,
    candidate.node_ref
  ]);
}

function wikidataClaimsBySubject(value: JsonValue): Map<string, JsonObject[]> {
  const claims_by_subject = new Map<string, JsonObject[]>();
  for (const triple of asArray(asObject(value).triples).map((entry) => asObject(entry))) {
    const subject_label = asString(triple.subject_label);
    if (!subject_label) {
      continue;
    }

    const claims = claims_by_subject.get(subject_label) ?? [];
    claims.push(triple);
    claims_by_subject.set(subject_label, claims);
  }

  return claims_by_subject;
}

function wikidataObjectsForProperty(
  claims: readonly JsonObject[],
  property_id: string
): string[] {
  return sortStrings(
    claims
      .filter((claim) => asString(claim.property_id) === property_id)
      .map((claim) => asString(claim.object_label))
      .filter((label): label is string => Boolean(label))
  );
}

function wikidataSubjectsWithClaim(
  claims_by_subject: Map<string, JsonObject[]>,
  property_id: string,
  object_label: string
): { subject: string; claims: JsonObject[] }[] {
  return [...claims_by_subject.entries()]
    .filter(([, claims]) =>
      claims.some(
        (claim) =>
          asString(claim.property_id) === property_id &&
          asString(claim.object_label) === object_label
      )
    )
    .map(([subject, claims]) => ({ subject, claims }));
}

function wikidataUkHumanMostOccupationsBirthplace(value: JsonValue): string {
  const claims_by_subject = wikidataClaimsBySubject(value);
  const candidates = wikidataSubjectsWithClaim(claims_by_subject, 'P31', 'human')
    .filter(({ claims }) =>
      claims.some(
        (claim) =>
          asString(claim.property_id) === 'P27' &&
          asString(claim.object_label) === 'United Kingdom'
      )
    )
    .map(({ subject, claims }) => {
      const occupations = wikidataObjectsForProperty(claims, 'P106');
      const birthplaces = wikidataObjectsForProperty(claims, 'P19');
      return {
        subject,
        occupation_count: occupations.length,
        birthplace: birthplaces[0] ?? ''
      };
    })
    .filter((candidate) => candidate.occupation_count > 0 && candidate.birthplace);

  const candidate = candidates.sort((left, right) => {
    if (left.occupation_count !== right.occupation_count) {
      return right.occupation_count - left.occupation_count;
    }

    return left.subject.localeCompare(right.subject);
  })[0];
  if (!candidate) {
    throw new Error('Wikidata fixture has no UK human occupation candidates');
  }

  return joinAnswer([
    candidate.subject,
    candidate.birthplace,
    candidate.occupation_count
  ]);
}

function wikidataDouglasAdamsEducationAfterOccupationCheck(value: JsonValue): string {
  const claims = wikidataClaimsBySubject(value).get('Douglas Adams') ?? [];
  const occupations = new Set(wikidataObjectsForProperty(claims, 'P106'));
  if (!occupations.has('writer') || !occupations.has('screenwriter')) {
    throw new Error('Wikidata fixture lacks Douglas Adams writer/screenwriter claims');
  }

  const education = wikidataObjectsForProperty(claims, 'P69');
  if (education.length === 0) {
    throw new Error('Wikidata fixture lacks Douglas Adams education claims');
  }

  return joinAnswer(['Douglas Adams', education.join(';')]);
}

function wikidataCambridgeBornScreenwriterDeathplace(value: JsonValue): string {
  const claims_by_subject = wikidataClaimsBySubject(value);
  const candidates = [...claims_by_subject.entries()]
    .filter(([, claims]) => {
      const occupations = new Set(wikidataObjectsForProperty(claims, 'P106'));
      return (
        occupations.has('screenwriter') &&
        claims.some(
          (claim) =>
            asString(claim.property_id) === 'P19' &&
            asString(claim.object_label) === 'Cambridge'
        )
      );
    })
    .map(([subject, claims]) => ({
      subject,
      deathplace: wikidataObjectsForProperty(claims, 'P20')[0] ?? ''
    }))
    .filter((candidate) => candidate.deathplace)
    .sort((left, right) => left.subject.localeCompare(right.subject));
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error('Wikidata fixture has no Cambridge-born screenwriter deathplace');
  }

  return joinAnswer([candidate.subject, candidate.deathplace]);
}

function datedAlbumReleaseGroupsForArtist(value: JsonValue, artist_name: string): JsonObject[] {
  return asArray(asObject(value).release_groups)
    .map((entry) => asObject(entry))
    .filter(
      (entry) =>
        asString(entry.artist_name) === artist_name &&
        asString(entry.primary_type) === 'Album' &&
        Boolean(asString(entry.first_release_date))
    )
    .sort((left, right) => {
      const date_delta = (asString(left.first_release_date) ?? '').localeCompare(
        asString(right.first_release_date) ?? ''
      );
      if (date_delta !== 0) {
        return date_delta;
      }

      return (asString(left.title) ?? '').localeCompare(asString(right.title) ?? '');
    });
}

function musicBrainzOkComputerNeighbors(value: JsonValue): string {
  const albums = datedAlbumReleaseGroupsForArtist(value, 'Radiohead');
  const ok_index = albums.findIndex((entry) => asString(entry.title) === 'OK Computer');
  if (ok_index < 1 || ok_index >= albums.length - 1) {
    throw new Error('MusicBrainz fixture lacks dated OK Computer neighbors');
  }

  return joinAnswer([
    'Radiohead',
    asString(albums[ok_index - 1]?.title) ?? '',
    asString(albums[ok_index]?.title) ?? '',
    asString(albums[ok_index + 1]?.title) ?? ''
  ]);
}

function yearFromDate(date: string): number | null {
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function musicBrainzLargestAlbumDateSpan(value: JsonValue): string {
  const candidates = asArray(asObject(value).artists)
    .map((artist) => {
      const artist_name = asString(asObject(artist).name);
      if (!artist_name) {
        return null;
      }

      const albums = datedAlbumReleaseGroupsForArtist(value, artist_name);
      const first = albums[0];
      const last = albums[albums.length - 1];
      const first_year = yearFromDate(asString(first?.first_release_date) ?? '');
      const last_year = yearFromDate(asString(last?.first_release_date) ?? '');
      if (!first || !last || first_year === null || last_year === null) {
        return null;
      }

      return {
        artist_name,
        first_title: asString(first.title) ?? '',
        last_title: asString(last.title) ?? '',
        span: last_year - first_year
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        artist_name: string;
        first_title: string;
        last_title: string;
        span: number;
      } => candidate !== null
    );

  const candidate = candidates.sort((left, right) => {
    if (left.span !== right.span) {
      return right.span - left.span;
    }

    return left.artist_name.localeCompare(right.artist_name);
  })[0];
  if (!candidate) {
    throw new Error('MusicBrainz fixture lacks dated span candidates');
  }

  return joinAnswer([
    candidate.artist_name,
    candidate.first_title,
    candidate.last_title,
    candidate.span
  ]);
}

function musicBrainzHundredthAlbumTitleByArtist(value: JsonValue): string {
  const rows = asArray(asObject(value).artists)
    .map((artist) => {
      const artist_name = asString(asObject(artist).name);
      if (!artist_name) {
        return null;
      }

      const albums = datedAlbumReleaseGroupsForArtist(value, artist_name);
      const release_group = albums[99];
      if (!release_group) {
        return null;
      }

      return {
        artist_name,
        answer: joinAnswer([
          artist_name,
          asString(release_group.title) ?? '',
          asString(release_group.first_release_date) ?? ''
        ])
      };
    })
    .filter(
      (entry): entry is { artist_name: string; answer: string } => entry !== null
    )
    .sort((left, right) => left.artist_name.localeCompare(right.artist_name))
    .map((entry) => entry.answer);
  if (rows.length === 0) {
    throw new Error('MusicBrainz fixture has no 100th dated album candidates');
  }

  return rows.join('||');
}

function npmPackageWithVitePeerAndMostPeers(value: JsonValue): string {
  const package_by_name = new Map(
    asArray(asObject(value).packages)
      .map((entry) => asObject(entry))
      .map((entry) => [asString(entry.name), entry] as const)
      .filter((entry): entry is readonly [string, JsonObject] => Boolean(entry[0]))
  );
  const candidates = asArray(asObject(value).dependencies)
    .map((entry) => asObject(entry))
    .filter(
      (entry) =>
        asString(entry.type) === 'peerDependency' &&
        asString(entry.dependency) === 'vite'
    )
    .map((dependency) => {
      const package_name = asString(dependency.package);
      const package_row = package_name ? package_by_name.get(package_name) : undefined;
      return {
        package_name: package_name ?? '',
        version: asString(package_row?.version) ?? '',
        peer_dependency_count: asNumber(package_row?.peer_dependency_count) ?? 0,
        range: asString(dependency.range) ?? ''
      };
    })
    .filter((candidate) => candidate.package_name);

  const candidate = candidates.sort((left, right) => {
    if (left.peer_dependency_count !== right.peer_dependency_count) {
      return right.peer_dependency_count - left.peer_dependency_count;
    }

    return left.package_name.localeCompare(right.package_name);
  })[0];
  if (!candidate) {
    throw new Error('npm fixture has no vite peer dependency candidates');
  }

  return joinAnswer([
    candidate.package_name,
    candidate.version,
    candidate.peer_dependency_count,
    candidate.range
  ]);
}

function npmHighestTotalDependencyAlphabeticalWindow(value: JsonValue): string {
  const package_row = asArray(asObject(value).packages)
    .map((entry) => asObject(entry))
    .sort((left, right) => {
      const left_total =
        (asNumber(left.dependency_count) ?? 0) +
        (asNumber(left.peer_dependency_count) ?? 0);
      const right_total =
        (asNumber(right.dependency_count) ?? 0) +
        (asNumber(right.peer_dependency_count) ?? 0);
      if (left_total !== right_total) {
        return right_total - left_total;
      }

      return (asString(left.name) ?? '').localeCompare(asString(right.name) ?? '');
    })[0];
  const package_name = asString(package_row?.name);
  if (!package_name) {
    throw new Error('npm fixture has no package rows');
  }

  const total =
    (asNumber(package_row?.dependency_count) ?? 0) +
    (asNumber(package_row?.peer_dependency_count) ?? 0);
  const dependencies = sortStrings(
    asArray(asObject(value).dependencies)
      .map((entry) => asObject(entry))
      .filter((entry) => asString(entry.package) === package_name)
      .map((entry) => `${asString(entry.type) ?? ''}:${asString(entry.dependency) ?? ''}`)
  ).slice(0, 5);

  return joinAnswer([package_name, total, dependencies.join(';')]);
}

function npmMostSharedDependencyWithPackages(value: JsonValue): string {
  const packages_by_dependency = new Map<string, Set<string>>();
  for (const dependency of asArray(asObject(value).dependencies).map((entry) =>
    asObject(entry)
  )) {
    const dependency_name = asString(dependency.dependency);
    const package_name = asString(dependency.package);
    if (!dependency_name || !package_name) {
      continue;
    }

    const packages = packages_by_dependency.get(dependency_name) ?? new Set<string>();
    packages.add(package_name);
    packages_by_dependency.set(dependency_name, packages);
  }

  const candidate = [...packages_by_dependency.entries()]
    .map(([dependency, packages]) => ({
      dependency,
      packages: sortStrings([...packages])
    }))
    .sort((left, right) => {
      if (left.packages.length !== right.packages.length) {
        return right.packages.length - left.packages.length;
      }

      return left.dependency.localeCompare(right.dependency);
    })[0];
  if (!candidate) {
    throw new Error('npm fixture has no shared dependency candidates');
  }

  return joinAnswer([
    candidate.dependency,
    candidate.packages.length,
    candidate.packages.join(';')
  ]);
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
      id: 'longest_way_middle_node_window',
      question:
        'Find the OSM way with the most node references. Within that same way, inspect its ordered node list and answer as way_id|highway|node_count|previous_middle_node_index|previous_middle_node_ref|middle_node_index|middle_node_ref, where middle_node_index is floor(node_count / 2) using zero-based indexes.',
      expected_answer: osmLongestWayNodeWindow(osm_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires selecting a parent way by aggregate length, then jumping into the local ordered child node refs.'
    },
    {
      fixture: 'openstreetmap_extract',
      id: 'closest_consecutive_node_refs',
      question:
        'Across all OSM ways, examine only consecutive node references within the same way. Find the consecutive pair with the smallest absolute numeric gap, breaking ties by smaller way_id then smaller node_index. Answer as way_id|highway|node_index|left_node_ref|right_node_ref.',
      expected_answer: osmClosestConsecutiveNodeRefs(osm_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires local sibling adjacency inside each way node list plus global tie-breaking.'
    },
    {
      fixture: 'openstreetmap_extract',
      id: 'lowest_shared_node_pair_details',
      question:
        'Find the pair of OSM ways that share the lowest numeric node reference. Answer as smaller_way_id|smaller_way_highway|larger_way_id|larger_way_highway|shared_node_ref.',
      expected_answer: osmLowestSharedNodePairDetails(osm_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires comparing child node-reference lists across parent ways, then jumping back to each parent highway.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'uk_human_most_occupations_birthplace',
      question:
        'Among subjects that have both P31=human and P27=United Kingdom, find the subject with the most P106 occupation claims. Answer as subject_label|P19_birthplace_label|occupation_count, breaking ties alphabetically by subject_label.',
      expected_answer: wikidataUkHumanMostOccupationsBirthplace(wikidata_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires grouping claims by subject, intersecting local claims, counting sibling occupation claims, then returning a birthplace claim.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'douglas_adams_education_after_occupation_check',
      question:
        'For Douglas Adams, first confirm the same subject has both P106=writer and P106=screenwriter. Then list that subject plus every P69 education object label sorted alphabetically. Answer as subject_label|education_label;education_label.',
      expected_answer: wikidataDouglasAdamsEducationAfterOccupationCheck(wikidata_value),
      perceived_difficulty: 4,
      difficulty_label: 'harder',
      difficulty_reason:
        'Requires checking multiple sibling claims for one subject before returning another local claim family.'
    },
    {
      fixture: 'wikidata_truthy_triples',
      id: 'cambridge_born_screenwriter_deathplace',
      question:
        'Find the subject that has both P19=Cambridge and P106=screenwriter, then answer as subject_label|P20_death_place_label.',
      expected_answer: wikidataCambridgeBornScreenwriterDeathplace(wikidata_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires locating a subject by two local claims and then returning a third local claim.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'ok_computer_neighbor_albums',
      question:
        'For Radiohead, sort dated Album release groups by first_release_date then title. Find OK Computer and answer as artist_name|previous_album_title|OK Computer|next_album_title.',
      expected_answer: musicBrainzOkComputerNeighbors(musicbrainz_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires staying within one artist, sorting local child release groups, and reading neighboring sibling rows.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'largest_album_date_span',
      question:
        'For each artist, sort dated Album release groups by first_release_date then title. Compute the span in years between that artist’s earliest and latest dated album release groups. Which artist has the largest span? Answer as artist_name|earliest_album_title|latest_album_title|span_years, breaking ties alphabetically by artist_name.',
      expected_answer: musicBrainzLargestAlbumDateSpan(musicbrainz_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires per-parent child sorting, local first/last sibling lookup, derived span calculation, and global tie-breaking.'
    },
    {
      fixture: 'musicbrainz_release_groups',
      id: 'hundredth_album_by_artist',
      question:
        'For each artist with at least 100 dated Album release groups, sort that artist’s dated Album release groups by first_release_date then title. Return one entry per qualifying artist as artist_name|100th_album_title|100th_album_first_release_date, using one-based position 100, and separate artist entries with || in alphabetical artist order.',
      expected_answer: musicBrainzHundredthAlbumTitleByArtist(musicbrainz_value),
      perceived_difficulty: 4,
      difficulty_label: 'harder',
      difficulty_reason:
        'Requires local child ordering and reading a deep sibling position inside each artist group.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'vite_peer_with_most_peer_deps',
      question:
        'Among packages that declare vite as a peerDependency, find the package with the highest peer_dependency_count. Answer as package_name|version|peer_dependency_count|vite_peer_range, breaking ties alphabetically by package_name.',
      expected_answer: npmPackageWithVitePeerAndMostPeers(npm_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires matching a dependency edge to its parent package summary and returning both parent and child fields.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'highest_total_dependency_window',
      question:
        'Find the package with the highest dependency_count plus peer_dependency_count. Then, within only that package’s dependency edges, sort edges alphabetically as type:dependency and return the first five joined by semicolons. Answer as package_name|total_count|edge;edge;edge;edge;edge.',
      expected_answer: npmHighestTotalDependencyAlphabeticalWindow(npm_value),
      perceived_difficulty: 4,
      difficulty_label: 'harder',
      difficulty_reason:
        'Requires selecting a parent by derived aggregate, then jumping into its local child dependency rows.'
    },
    {
      fixture: 'npm_dependency_metadata',
      id: 'most_shared_dependency_packages',
      question:
        'Across all dependency edges, find the dependency name used by the largest number of selected packages. Answer as dependency_name|package_count|package;package;package, with package names sorted alphabetically. Break dependency-name ties alphabetically.',
      expected_answer: npmMostSharedDependencyWithPackages(npm_value),
      perceived_difficulty: 5,
      difficulty_label: 'very hard',
      difficulty_reason:
        'Requires grouping child dependency edges by dependency name and jumping back to all parent packages that use it.'
    }
  ];
}
