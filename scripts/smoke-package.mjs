import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo_root = new URL('..', import.meta.url);
const temp_root = mkdtempSync(join(tmpdir(), 'tile-package-smoke-'));
const pack_dir = join(temp_root, 'pack');
const consumer_dir = join(temp_root, 'consumer');
const package_json = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repo_root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: join(temp_root, 'npm-cache'),
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false'
    },
    stdio: options.capture ? 'pipe' : 'inherit'
  });
}

function nodeBin(name) {
  return process.platform === 'win32'
    ? join(consumer_dir, 'node_modules', '.bin', `${name}.cmd`)
    : join(consumer_dir, 'node_modules', '.bin', name);
}

mkdirSync(pack_dir, { recursive: true });
mkdirSync(consumer_dir, { recursive: true });

const pack_output = run('npm', ['pack', '--json', '--pack-destination', pack_dir], {
  cwd: repo_root,
  capture: true
});
const [pack_manifest] = JSON.parse(pack_output);
assert.equal(pack_manifest.name, package_json.name);
assert.equal(pack_manifest.version, package_json.version);

const tarball_path = join(pack_dir, pack_manifest.filename);
assert.equal(existsSync(tarball_path), true, `Missing packed tarball: ${tarball_path}`);

run('npm', ['init', '-y'], { cwd: consumer_dir });
run('npm', ['install', '--ignore-scripts', tarball_path], { cwd: consumer_dir });

writeFileSync(
  join(consumer_dir, 'esm-smoke.mjs'),
  `
import assert from 'node:assert/strict';
import {
  compareJsonTileSize,
  decodeTileToJson,
  encodeFirstClassTablesToTile,
  encodeJsonToTile
} from '@software-dlc/tile';

const value = {
  users: [
    { id: 'u1', name: 'Ada', metadata: { role: 'engineer' } },
    { id: 'u2', name: 'Grace', metadata: { role: 'admiral' } }
  ]
};
const tile = encodeJsonToTile(value, {
  path_rules: {
    'root.users[].metadata': 'inline_json'
  }
});
assert.deepEqual(decodeTileToJson(tile), value);
assert.equal(typeof compareJsonTileSize(value).tile_chars, 'number');
assert.match(
  encodeFirstClassTablesToTile({
    tables: [
      {
        id: 'users',
        kind: 'people',
        path: 'root.users',
        columns: ['id', 'name'],
        rows: [
          ['u1', 'Ada'],
          ['u2', 'Grace']
        ]
      }
    ]
  }),
  /users/
);
`
);

writeFileSync(
  join(consumer_dir, 'cjs-smoke.cjs'),
  `
const assert = require('node:assert/strict');
const tile = require('@software-dlc/tile');

const value = { ok: true, items: [{ id: 'i1' }] };
const encoded = tile.encodeJsonToTile(value);
assert.deepEqual(tile.decodeTileToJson(encoded), value);
assert.equal(typeof tile.encodeFirstClassTablesToTile, 'function');
`
);

run('node', ['esm-smoke.mjs'], { cwd: consumer_dir });
run('node', ['cjs-smoke.cjs'], { cwd: consumer_dir });

const input_path = join(consumer_dir, 'input.json');
const tile_path = join(consumer_dir, 'input.tile');
const output_path = join(consumer_dir, 'output.json');
const cli_input = { users: [{ id: 'u1', name: 'Ada' }] };
writeFileSync(input_path, `${JSON.stringify(cli_input)}\n`);

run(nodeBin('tile'), ['encode', input_path, '--out', tile_path], {
  cwd: consumer_dir
});
run(nodeBin('tile'), ['decode', tile_path, '--pretty', '--out', output_path], {
  cwd: consumer_dir
});
run(nodeBin('tile'), ['size', input_path], { cwd: consumer_dir });

assert.deepEqual(JSON.parse(readFileSync(output_path, 'utf8')), cli_input);

console.log(`Package smoke passed: ${pack_manifest.name}@${pack_manifest.version}`);
