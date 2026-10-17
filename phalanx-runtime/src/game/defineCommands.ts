import type { SlotInfo } from './MatchConfig.js';
import {
  isCommandRejection,
  rejectCommand,
  type CommandRejection,
  type GameCommand,
  type JsonValue,
} from './commands.js';

/** Field types a generated command codec accepts. */
export type CommandFieldType =
  'i32' | 'u32' | 'u8' | 'i64' | 'bool' | 'entity' | 'string';

/**
 * A command field. `string` may carry a max length; the default max is
 * {@link DEFAULT_COMMAND_STRING_LENGTH}.
 */
export type CommandFieldSpec =
  CommandFieldType | { readonly type: 'string'; readonly maxLength: number };

export interface CommandSpec {
  readonly [command: string]: Readonly<Record<string, CommandFieldSpec>>;
}

/** One command as stored in `configHash`: name, then fields in declaration order. */
export interface CommandSchemaHash {
  readonly name: string;
  readonly fields: readonly (readonly [string, string])[];
}

const DEFAULT_COMMAND_STRING_LENGTH = 64;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

type FieldValue<F> = F extends 'i64'
  ? bigint
  : F extends 'bool'
    ? boolean
    : F extends 'string'
      ? string
      : F extends { readonly type: 'string' }
        ? string
        : F extends 'i32' | 'u32' | 'u8' | 'entity'
          ? number
          : never;

type CommandBody<Name extends string, Fields> = {
  readonly [Field in keyof Fields | 'type']: Field extends 'type'
    ? Name
    : FieldValue<Fields[Field & keyof Fields]>;
};

/** Discriminated union of every command in a {@link defineCommands} spec. */
export type CommandFromSpec<Spec extends CommandSpec> = {
  [Name in keyof Spec & string]: CommandBody<Name, Spec[Name]>;
}[keyof Spec & string];

interface ParsedField {
  readonly name: string;
  readonly type: CommandFieldType;
  readonly maxLength: number;
  readonly token: string;
}

/**
 * Codec produced by {@link defineCommands}. `decode` rejects bad input and
 * does not throw. `encode` writes keys in UTF-16 order.
 */
export interface DefinedCommands<Cmd extends GameCommand = GameCommand> {
  readonly types: readonly Cmd['type'][];
  /** Declaration order. Folded into `configHash`. */
  readonly schema: readonly CommandSchemaHash[];
  decode(raw: unknown, slot: SlotInfo): Cmd | CommandRejection;
  encode(command: Cmd): JsonValue;
  validate?(
    command: Cmd,
    slot: SlotInfo,
    sim: Readonly<unknown>
  ): CommandRejection | null;
}

export interface DefineCommandsOptions<Cmd extends GameCommand> {
  /**
   * Pure, deterministic, in-tick check. Return `null` to accept.
   * A throw becomes a rejection in the runner.
   */
  validate?(
    command: Cmd,
    slot: SlotInfo,
    sim: Readonly<unknown>
  ): CommandRejection | null;
}

/**
 * Build a command codec.
 *
 * Wire values are JSON. `i64` is a canonical decimal string (no leading
 * zeros). `bool` is a boolean. `entity` is a non-negative integer id.
 * Unknown types, extra fields, missing fields and out-of-range values are
 * rejections. `decode` does not throw.
 */
export function defineCommands<const Spec extends CommandSpec>(
  spec: Spec,
  options?: DefineCommandsOptions<CommandFromSpec<Spec>>
): DefinedCommands<CommandFromSpec<Spec>> {
  const parsed = parseSpec(spec);
  const types = parsed.map((command) => command.name);
  const schema: CommandSchemaHash[] = parsed.map((command) => ({
    name: command.name,
    fields: command.fields.map((field) => [field.name, field.token] as const),
  }));
  const byName = new Map(parsed.map((command) => [command.name, command]));

  const defined: DefinedCommands<CommandFromSpec<Spec>> = {
    // Spec keys are the command names. The mapped command type's `type`
    // field is that key; the array is built from Object.keys.
    types,
    schema,
    decode(raw) {
      return decodeCommand(raw, byName);
    },
    encode(command) {
      return encodeCommand(command, byName);
    },
  };
  if (options?.validate !== undefined) {
    defined.validate = (command, slot, sim) => {
      const result = options.validate?.(command, slot, sim);
      if (result === null || result === undefined) return null;
      if (isCommandRejection(result)) return result;
      return rejectCommand('invalid command');
    };
  }
  return defined;
}

interface ParsedCommand {
  readonly name: string;
  readonly fields: readonly ParsedField[];
}

function parseSpec(spec: CommandSpec): ParsedCommand[] {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new Error('defineCommands: spec must be an object');
  }
  const names = Object.keys(spec);
  if (names.length === 0) {
    throw new Error('defineCommands: at least one command is required');
  }
  return names.map((name) => {
    if (name.length === 0) {
      throw new Error('defineCommands: command name must be non-empty');
    }
    const fields = spec[name];
    if (
      typeof fields !== 'object' ||
      fields === null ||
      Array.isArray(fields)
    ) {
      throw new Error(`defineCommands: '${name}' fields must be an object`);
    }
    return {
      name,
      fields: Object.keys(fields).map((fieldName) =>
        parseField(name, fieldName, fields[fieldName])
      ),
    };
  });
}

function parseField(
  command: string,
  fieldName: string,
  spec: CommandFieldSpec | undefined
): ParsedField {
  if (fieldName.length === 0) {
    throw new Error(`defineCommands: '${command}' has an empty field name`);
  }
  if (fieldName === 'type') {
    throw new Error(
      `defineCommands: '${command}' cannot declare a field named 'type'`
    );
  }
  if (typeof spec === 'string') {
    assertFieldType(command, fieldName, spec);
    const maxLength = spec === 'string' ? DEFAULT_COMMAND_STRING_LENGTH : 0;
    return {
      name: fieldName,
      type: spec,
      maxLength,
      token: spec === 'string' ? 'string' : spec,
    };
  }
  if (
    typeof spec === 'object' &&
    spec !== null &&
    spec.type === 'string' &&
    Number.isInteger(spec.maxLength) &&
    spec.maxLength >= 0
  ) {
    return {
      name: fieldName,
      type: 'string',
      maxLength: spec.maxLength,
      token: `string(${String(spec.maxLength)})`,
    };
  }
  throw new Error(
    `defineCommands: '${command}.${fieldName}' has type '${fieldTypeLabel(spec)}'; allowed types are i32, u32, u8, i64, bool, entity, string`
  );
}

function fieldTypeLabel(spec: CommandFieldSpec | undefined): string {
  if (typeof spec === 'string') return spec;
  if (spec === undefined) return 'undefined';
  return 'invalid';
}

function assertFieldType(
  command: string,
  fieldName: string,
  type: string
): asserts type is CommandFieldType {
  if (
    type === 'i32' ||
    type === 'u32' ||
    type === 'u8' ||
    type === 'i64' ||
    type === 'bool' ||
    type === 'entity' ||
    type === 'string'
  ) {
    return;
  }
  throw new Error(
    `defineCommands: '${command}.${fieldName}' has type '${type}'; allowed types are i32, u32, u8, i64, bool, entity, string`
  );
}

function decodeCommand<Cmd extends GameCommand>(
  raw: unknown,
  byName: ReadonlyMap<string, ParsedCommand>
): Cmd | CommandRejection {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return rejectCommand('not an object');
  }
  const record = raw as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') return rejectCommand("missing field 'type'");
  const command = byName.get(type);
  if (command === undefined) return rejectCommand('unknown command');
  const allowed = new Set<string>([
    'type',
    ...command.fields.map((f) => f.name),
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return rejectCommand(`unexpected field '${key}'`);
  }
  const value: { [key: string]: string | number | boolean | bigint } = {
    type,
  };
  for (const field of command.fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.name)) {
      return rejectCommand(`missing field '${field.name}'`);
    }
    const decoded = decodeField(field, record[field.name]);
    if (isCommandRejection(decoded)) return decoded;
    value[field.name] = decoded;
  }
  // Fields were checked against the spec. The object is the command.
  return value as unknown as Cmd;
}

function decodeField(
  field: ParsedField,
  raw: unknown
): string | number | boolean | bigint | CommandRejection {
  switch (field.type) {
    case 'i32':
      return decodeInt(field, raw, I32_MIN, I32_MAX);
    case 'u32':
      return decodeInt(field, raw, 0, U32_MAX);
    case 'u8':
      return decodeInt(field, raw, 0, 255);
    case 'entity':
      return decodeInt(field, raw, 0, Number.MAX_SAFE_INTEGER);
    case 'i64':
      return decodeI64(field, raw);
    case 'bool':
      if (typeof raw !== 'boolean') return invalidField(field);
      return raw;
    case 'string':
      if (typeof raw !== 'string' || raw.length > field.maxLength) {
        return invalidField(field);
      }
      return raw;
    default:
      return invalidField(field);
  }
}

function invalidField(field: ParsedField): CommandRejection {
  return rejectCommand(`invalid field '${field.name}' (${field.token})`);
}

function decodeInt(
  field: ParsedField,
  raw: unknown,
  min: number,
  max: number
): number | CommandRejection {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return invalidField(field);
  }
  if (raw < min || raw > max) return invalidField(field);
  return raw;
}

function decodeI64(
  field: ParsedField,
  raw: unknown
): bigint | CommandRejection {
  if (typeof raw !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(raw)) {
    return invalidField(field);
  }
  const value = BigInt(raw);
  if (value < I64_MIN || value > I64_MAX) return invalidField(field);
  return value;
}

function encodeCommand<Cmd extends GameCommand>(
  command: Cmd,
  byName: ReadonlyMap<string, ParsedCommand>
): JsonValue {
  const parsed = byName.get(command.type);
  if (parsed === undefined) {
    throw new Error(`defineCommands.encode: unknown command '${command.type}'`);
  }
  const entries: [string, JsonValue][] = [['type', command.type]];
  const record = command as unknown as Record<string, unknown>;
  for (const field of parsed.fields) {
    const value = record[field.name];
    entries.push([field.name, encodeField(field, value)]);
  }
  entries.sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
  );
  const payload: { [key: string]: JsonValue } = {};
  for (const [key, value] of entries) payload[key] = value;
  return payload;
}

function encodeField(field: ParsedField, value: unknown): JsonValue {
  if (field.type === 'i64') {
    if (typeof value !== 'bigint') {
      throw new Error(
        `defineCommands.encode: field '${field.name}' expects a bigint`
      );
    }
    return value.toString();
  }
  if (field.type === 'bool') {
    if (typeof value !== 'boolean') {
      throw new Error(
        `defineCommands.encode: field '${field.name}' expects a boolean`
      );
    }
    return value;
  }
  if (field.type === 'string') {
    if (typeof value !== 'string') {
      throw new Error(
        `defineCommands.encode: field '${field.name}' expects a string`
      );
    }
    return value;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `defineCommands.encode: field '${field.name}' expects an integer`
    );
  }
  return value;
}
