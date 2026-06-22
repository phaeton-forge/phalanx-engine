import type {GameSystem} from "./GameSystem";

/**
 * Minimal ability-system contract known to phalanx-ecs.
 *
 * Methods that involve ability-specific value types (AttributeValue,
 * ProvidedTarget, TargetSpec, …) use `unknown` here so that phalanx-ecs
 * stays dependency-free. The concrete AbilitySystem interface in
 * phalanx-abilities extends this and re-declares those methods with
 * their proper types.
 *
 * GameSystem exposes this as a protected `abilities` getter; systems in
 * games that don't use phalanx-abilities will simply receive `undefined`.
 */
export interface IAbilitySystem {
  activateAbility(
    casterEntityId: number,
    abilityId: string,
    providedTarget?: unknown,
  ): boolean;

  applyEffect(
    targetEntityId: number,
    effectId: string,
    sourceEntityId?: number,
  ): void;

  tryGetAttribute(
    entityId: number,
    attrId: string,
  ): { base: unknown; current: unknown } | undefined;

  getAttribute(
    entityId: number,
    attrId: string,
  ): { base: unknown; current: unknown };

  hasTag(entityId: number, tag: string): boolean;

  addTag(entityId: number, tag: string): void;

  removeTag(entityId: number, tag: string): boolean;

  readonly tickSystems: readonly GameSystem[];
}
