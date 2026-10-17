/** Soldier, archer, and totem. Stored as `u8` on the unit row. */
export const KIND_SOLDIER = 1;
export const KIND_ARCHER = 2;
export const KIND_TOTEM = 3;

export const TAG_COOLDOWN = 'Cooldown.Ability.Strike';
export const TAG_BANNER = 'State.Buff.Banner';
export const TAG_INIT = 'Team.Unit';
export const EFFECT_DAMAGE = 'Effect.Damage';
export const EFFECT_BANNER = 'Effect.Banner';
export const ABILITY_STRIKE = 'Ability.Strike';
export const ABILITY_BANNER = 'Ability.Banner';

/** Melee / overlap radius, raw fixed-point of 2 (sum of two radius-1 bodies). */
export const TOUCH_RANGE = 200000n;
/** Archer attack range, raw fixed-point of 6. */
export const ARCHER_RANGE = 600000n;
/** Totem aura radius, raw fixed-point of 5. */
export const AURA_RANGE = 500000n;

export const MAX_UNITS_PER_SLOT = 6;

export type SkirmishCommand =
  | { readonly type: 'move'; readonly dir: number }
  | { readonly type: 'attack'; readonly target: number }
  | { readonly type: 'cast'; readonly ability: number; readonly target: number }
  | { readonly type: 'spawn'; readonly kind: number }
  | { readonly type: 'recall' };

export function isSkirmishCommand(value: unknown): value is SkirmishCommand {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { type?: unknown };
  if (record.type === 'move') return isDir(record);
  if (record.type === 'attack') return isId(record, 'target');
  if (record.type === 'cast') return isAbility(record);
  if (record.type === 'spawn') return isKind(record);
  return record.type === 'recall';
}

function isDir(value: object): boolean {
  const dir = (value as { dir?: unknown }).dir;
  return (
    typeof dir === 'number' && Number.isInteger(dir) && dir >= 0 && dir <= 3
  );
}

function isId(value: object, key: 'target'): boolean {
  const id = (value as { target?: unknown })[key];
  return typeof id === 'number' && Number.isInteger(id) && id >= 1;
}

function isAbility(value: object): boolean {
  const ability = (value as { ability?: unknown }).ability;
  return (
    isId(value, 'target') &&
    typeof ability === 'number' &&
    Number.isInteger(ability) &&
    ability >= 0 &&
    ability <= 1
  );
}

function isKind(value: object): boolean {
  const kind = (value as { kind?: unknown }).kind;
  return (
    typeof kind === 'number' &&
    Number.isInteger(kind) &&
    kind >= KIND_SOLDIER &&
    kind <= KIND_TOTEM
  );
}
