import { ROOT_PATH } from './codec-constants.js';
import type { JsonObject, JsonValue } from './types.js';

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateJsonValue(
  value: unknown,
  path: string = ROOT_PATH
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`TILE only supports finite JSON numbers at ${path}`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    const json_array: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new Error(`TILE only supports dense JSON arrays at ${path}`);
      }

      json_array.push(
        validateJsonValue(value[index], `${path}[${String(index)}]`)
      );
    }

    return json_array;
  }

  if (value && typeof value === 'object') {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error(`TILE only supports plain JSON objects at ${path}`);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child_value]) => [
        key,
        validateJsonValue(child_value, `${path}.${key}`)
      ])
    );
  }

  throw new Error(`TILE only supports JSON values at ${path}`);
}
