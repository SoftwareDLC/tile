#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareJsonTileSize,
  decodeTileToJson,
  encodeJsonToTile
} from './index.js';
import type { JsonTileEncodeOptions, JsonTileObjectTableStrategy } from './types.js';

type CliCommand = 'encode' | 'decode' | 'size';

type CliOptions = {
  command: CliCommand;
  input_path: string | null;
  output_path: string | null;
  pretty: boolean;
  encode_options: JsonTileEncodeOptions;
};

type ReadableInput = AsyncIterable<string | Buffer>;
type WritableOutput = {
  write(chunk: string): unknown;
};

type CliIo = {
  argv: readonly string[];
  stdin: ReadableInput;
  stdout: WritableOutput;
  stderr: WritableOutput;
};

const USAGE = `Usage:
  tile encode [input.json|-] [--out output.tile] [--strategy path|normalized_shape]
  tile decode [input.tile|-] [--out output.json] [--pretty]
  tile size [input.json|-] [--strategy path|normalized_shape]

Commands:
  encode   Encode JSON as TILE.
  decode   Decode TILE as JSON.
  size     Compare compact JSON, pretty JSON, and TILE sizes.

Options:
  --out <path>      Write output to a file instead of stdout.
  --pretty          Pretty-print decoded JSON.
  --strategy <name> Object table strategy for JSON encoding.
  --help            Show this help text.
  --version         Show the package version.
`;

function parseStrategy(value: string): JsonTileObjectTableStrategy {
  if (value === 'path' || value === 'normalized_shape') {
    return value;
  }

  throw new Error('--strategy must be path or normalized_shape');
}

function parseArgs(argv: readonly string[]): CliOptions | 'help' | 'version' {
  const args = [...argv];
  const first = args.shift();

  if (!first || first === '--help' || first === '-h') {
    return 'help';
  }

  if (first === '--version' || first === '-v') {
    return 'version';
  }

  if (first !== 'encode' && first !== 'decode' && first !== 'size') {
    throw new Error(`Unknown command: ${first}`);
  }

  let input_path: string | null = null;
  let output_path: string | null = null;
  let pretty = false;
  const encode_options: JsonTileEncodeOptions = {};

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return 'help';
    }

    if (arg === '--out') {
      const value = args.shift();
      if (!value) {
        throw new Error('--out requires a path');
      }
      output_path = value;
      continue;
    }

    if (arg === '--pretty') {
      pretty = true;
      continue;
    }

    if (arg === '--strategy') {
      const value = args.shift();
      if (!value) {
        throw new Error('--strategy requires a value');
      }
      encode_options.object_table_strategy = parseStrategy(value);
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (input_path !== null) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    input_path = arg;
  }

  if (first === 'decode' && encode_options.object_table_strategy) {
    throw new Error('--strategy is only valid for encode and size');
  }

  if (first === 'encode' && pretty) {
    throw new Error('--pretty is only valid for decode');
  }

  if (first === 'size' && output_path) {
    throw new Error('--out is only valid for encode and decode');
  }

  return {
    command: first,
    input_path,
    output_path,
    pretty,
    encode_options
  };
}

async function readInput(
  input_path: string | null,
  stdin: ReadableInput
): Promise<string> {
  if (input_path && input_path !== '-') {
    return readFile(input_path, 'utf8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonInput(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON input: ${message}`);
  }
}

async function writeOutput(
  text: string,
  output_path: string | null,
  stdout: WritableOutput
): Promise<void> {
  const output = text.endsWith('\n') ? text : `${text}\n`;
  if (output_path) {
    await writeFile(output_path, output);
    return;
  }

  stdout.write(output);
}

async function packageVersion(): Promise<string> {
  const package_json_url = new URL('../package.json', import.meta.url);
  const text = await readFile(package_json_url, 'utf8');
  const parsed = JSON.parse(text) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : 'unknown';
}

async function runCommand(options: CliOptions, io: CliIo): Promise<void> {
  const input = await readInput(options.input_path, io.stdin);

  if (options.command === 'encode') {
    const json = parseJsonInput(input);
    await writeOutput(
      encodeJsonToTile(json, options.encode_options),
      options.output_path,
      io.stdout
    );
    return;
  }

  if (options.command === 'decode') {
    const json = decodeTileToJson(input);
    await writeOutput(
      JSON.stringify(json, null, options.pretty ? 2 : 0),
      options.output_path,
      io.stdout
    );
    return;
  }

  const json = parseJsonInput(input);
  await writeOutput(
    JSON.stringify(compareJsonTileSize(json, options.encode_options), null, 2),
    null,
    io.stdout
  );
}

export async function runTileCli(io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs(io.argv);
    if (parsed === 'help') {
      io.stdout.write(USAGE);
      return 0;
    }

    if (parsed === 'version') {
      io.stdout.write(`${await packageVersion()}\n`);
      return 0;
    }

    await runCommand(parsed, io);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${basename(process.argv[1] ?? 'tile')}: ${message}\n`);
    io.stderr.write('Run `tile --help` for usage.\n');
    return 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runTileCli({
    argv: process.argv.slice(2),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  });
}
