import { escapeTileText, unescapeTileText } from './text.js';
import type { JsonPrimitive } from './types.js';
import type {
  ParsedTileColumn,
  TileOutputColumnPlan,
  TilePrimitiveCell,
  TileRefCell
} from './codec-types.js';

export function escapeTileColumnName(value: string): string {
  return escapeTileText(value).replace(/@/g, '\\@').replace(/:/g, '\\:');
}

export function encodePrimitiveCell(value: JsonPrimitive): string {
  if (value === null) {
    return 'z:';
  }

  if (typeof value === 'string') {
    return `s:${escapeTileText(value)}`;
  }

  if (typeof value === 'number') {
    return `n:${JSON.stringify(value)}`;
  }

  return value ? 'b:1' : 'b:0';
}

export function createRefCell(table_id: string, row_id: string): string {
  return `r:${table_id}:${row_id}`;
}

export function parseRefCell(cell: string): TileRefCell | null {
  if (!cell.startsWith('r:')) {
    return null;
  }

  const [table_id, row_id, extra] = cell.slice(2).split(':');
  if (!table_id || !row_id || extra !== undefined) {
    return null;
  }

  return { table_id, row_id };
}

export function parsePrimitiveCellHeader(
  cell: string
): TilePrimitiveCell | null {
  const primitive_type = cell[0];
  if (
    (primitive_type !== 's' &&
      primitive_type !== 'n' &&
      primitive_type !== 'b' &&
      primitive_type !== 'z' &&
      primitive_type !== 'j') ||
    cell[1] !== ':'
  ) {
    return null;
  }

  return {
    primitive_type,
    payload: cell.slice(2)
  };
}

export function encodeTileColumnHeader(plan: TileOutputColumnPlan): string {
  const escaped_name = escapeTileColumnName(plan.name);
  if (plan.primitive_type) {
    return `${escaped_name}:${plan.primitive_type}`;
  }

  return plan.ref_table_id ? `${escaped_name}@${plan.ref_table_id}` : escaped_name;
}

function findUnescapedAt(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '@') {
      continue;
    }

    let backslash_count = 0;
    for (
      let lookbehind_index = index - 1;
      lookbehind_index >= 0 && value[lookbehind_index] === '\\';
      lookbehind_index -= 1
    ) {
      backslash_count += 1;
    }

    if (backslash_count % 2 === 0) {
      return index;
    }
  }

  return -1;
}

function isUnescapedCharacterAt(input: {
  value: string;
  index: number;
}): boolean {
  let backslash_count = 0;
  for (
    let lookbehind_index = input.index - 1;
    lookbehind_index >= 0 && input.value[lookbehind_index] === '\\';
    lookbehind_index -= 1
  ) {
    backslash_count += 1;
  }

  return backslash_count % 2 === 0;
}

export function parseTileColumnHeader(
  header: string,
  supports_primitive_headers: boolean
): ParsedTileColumn {
  const separator_index = findUnescapedAt(header);
  if (separator_index === -1) {
    const primitive_type = header[header.length - 1];
    const type_separator_index = header.length - 2;
    if (
      supports_primitive_headers &&
      (primitive_type === 's' ||
        primitive_type === 'n' ||
        primitive_type === 'b' ||
        primitive_type === 'z' ||
        primitive_type === 'j') &&
      header[type_separator_index] === ':' &&
      isUnescapedCharacterAt({
        value: header,
        index: type_separator_index
      })
    ) {
      return {
        name: unescapeTileText(header.slice(0, type_separator_index)),
        ref_table_id: null,
        primitive_type
      };
    }

    return {
      name: unescapeTileText(header),
      ref_table_id: null,
      primitive_type: null
    };
  }

  const raw_name = header.slice(0, separator_index);
  const ref_table_id = header.slice(separator_index + 1);
  if (!/^t[0-9a-z]+$/.test(ref_table_id)) {
    throw new Error(`Invalid TILE column reference header: ${header}`);
  }

  return {
    name: unescapeTileText(raw_name),
    ref_table_id,
    primitive_type: null
  };
}

function createPrimitiveColumnPlan(input: {
  column: string;
  present_cells: string[];
}): TileOutputColumnPlan | null {
  const primitives = input.present_cells.map(parsePrimitiveCellHeader);
  if (primitives.some((primitive) => primitive === null)) {
    return null;
  }

  const primitive_type = primitives[0]?.primitive_type;
  if (!primitive_type) {
    return null;
  }

  const all_same_primitive_type = primitives.every(
    (primitive) => primitive?.primitive_type === primitive_type
  );
  if (!all_same_primitive_type) {
    return null;
  }

  const contains_empty_string =
    primitive_type === 's' &&
    primitives.some((primitive) => primitive?.payload.length === 0);
  if (contains_empty_string) {
    return null;
  }

  return {
    name: input.column,
    source_column: input.column,
    ref_table_id: null,
    primitive_type
  };
}

export function createCellColumnPlan(input: {
  column: string;
  cells: string[];
}): TileOutputColumnPlan[] {
  const present_cells = input.cells.filter((cell) => cell.length > 0);
  if (present_cells.length === 0) {
    return [
      {
        name: input.column,
        source_column: input.column,
        ref_table_id: null,
        primitive_type: null
      }
    ];
  }

  const primitive_plan = createPrimitiveColumnPlan({
    column: input.column,
    present_cells
  });
  if (primitive_plan) {
    return [primitive_plan];
  }

  const refs = present_cells.map(parseRefCell);
  if (refs.some((ref) => ref === null)) {
    return [
      {
        name: input.column,
        source_column: input.column,
        ref_table_id: null,
        primitive_type: null
      }
    ];
  }

  const ref_table_ids: string[] = [];
  refs.forEach((ref) => {
    if (ref && !ref_table_ids.includes(ref.table_id)) {
      ref_table_ids.push(ref.table_id);
    }
  });

  return ref_table_ids.map((ref_table_id) => ({
    name: input.column,
    source_column: input.column,
    ref_table_id,
    primitive_type: null
  }));
}

export function createPropertyValueColumnPlan(
  cells: string[]
): TileOutputColumnPlan {
  const present_cells = cells.filter((cell) => cell.length > 0);
  const primitive_plan =
    present_cells.length > 0
      ? createPrimitiveColumnPlan({
          column: 'value',
          present_cells
        })
      : null;

  return (
    primitive_plan ?? {
      name: 'value',
      source_column: 'value',
      ref_table_id: null,
      primitive_type: null
    }
  );
}

export function encodeCellForColumnPlan(input: {
  cell: string;
  plan: TileOutputColumnPlan;
}): string {
  if (!input.plan.ref_table_id || input.cell.length === 0) {
    if (!input.plan.primitive_type || input.cell.length === 0) {
      return input.cell;
    }

    const primitive = parsePrimitiveCellHeader(input.cell);
    if (!primitive || primitive.primitive_type !== input.plan.primitive_type) {
      return '';
    }

    if (primitive.primitive_type === 'z') {
      return '1';
    }

    return primitive.payload;
  }

  const ref = parseRefCell(input.cell);
  if (!ref || ref.table_id !== input.plan.ref_table_id) {
    return '';
  }

  return ref.row_id;
}

export function encodeRootLine(root_cell: string): string {
  const root_ref = parseRefCell(root_cell);
  if (root_ref) {
    return `root@${root_ref.table_id}\t${root_ref.row_id}`;
  }

  const primitive_plan = createPrimitiveColumnPlan({
    column: 'root',
    present_cells: [root_cell]
  });
  if (primitive_plan) {
    return `${encodeTileColumnHeader(primitive_plan)}\t${encodeCellForColumnPlan({
      cell: root_cell,
      plan: primitive_plan
    })}`;
  }

  return `root\t${root_cell}`;
}
