import type { JsonTileDelimiter } from './types.js';

export function escapeTileText(
  value: string,
  delimiter: string = '\t'
): string {
  let result = '';

  for (const char of value) {
    if (char === '\\') {
      result += '\\\\';
    } else if (char === '\t') {
      result += '\\t';
    } else if (char === '\n') {
      result += '\\n';
    } else if (char === '\r') {
      result += '\\r';
    } else if (char === ' ' && delimiter === ' ') {
      result += '\\s';
    } else if (char === delimiter && delimiter !== '\t') {
      result += `\\${char}`;
    } else {
      result += char;
    }
  }

  return result;
}

export function unescapeTileText(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (char !== '\\') {
      result += char;
      continue;
    }

    const escaped_char = value[index + 1];
    if (escaped_char === undefined) {
      throw new Error('Invalid TILE escape: trailing backslash');
    }

    if (escaped_char === 't') {
      result += '\t';
    } else if (escaped_char === 'n') {
      result += '\n';
    } else if (escaped_char === 'r') {
      result += '\r';
    } else if (escaped_char === '\\') {
      result += '\\';
    } else if (escaped_char === 's') {
      result += ' ';
    } else if (escaped_char === ',') {
      result += ',';
    } else if (escaped_char === '|') {
      result += '|';
    } else if (escaped_char === '@') {
      result += '@';
    } else if (escaped_char === ':') {
      result += ':';
    } else {
      throw new Error(`Invalid TILE escape: \\${escaped_char}`);
    }

    index += 1;
  }

  return result;
}

export function resolveTileDelimiter(delimiter: JsonTileDelimiter): string {
  if (delimiter === 'comma') {
    return ',';
  }

  if (delimiter === 'pipe') {
    return '|';
  }

  if (delimiter === 'space') {
    return ' ';
  }

  return '\t';
}
