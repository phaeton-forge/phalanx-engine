import type { IComponent } from './Component';
import type { SoASchemaDefinition, SoASchema, SoAFieldsOf } from './SoASchema';
import type { SoAComponentStore } from './SoAComponentStore';
import type { EntityManager } from './EntityManager';

/** Default initial capacity for lazily created SoA stores */
const DEFAULT_STORE_CAPACITY = 1024;

/**
 * SoAComponent - Base class for SoA-backed ECS components
 *
 * Encapsulates all boilerplate for SoA store lookup, cached indexing,
 * and field access. Subclasses only need to define their schema, type,
 * and domain-specific getters/setters.
 *
 * Stores are lazily created via a static EntityManager context set by
 * GameWorld on construction.
 *
 * @example
 * ```typescript
 * class PhysicsBodyComponent extends SoAComponent<typeof schema.definition> {
 *   public readonly type = ComponentType.PhysicsBody;
 *   static readonly soaSchema = defineSoASchema({ velocityX: 'i64', ... }, 'PhysicsBody');
 *
 *   constructor(entityId: number, opts: { radius?: number }) {
 *     super(PhysicsBodyComponent.soaSchema, entityId, { velocityX: 0n, ... });
 *   }
 *
 *   get velocity() { return FP.FromRaw(this.getField('velocityX')); }
 * }
 * ```
 */
export abstract class SoAComponent<S extends SoASchemaDefinition> implements IComponent {
  public abstract readonly type: symbol;

  /** The SoA store backing this component (shared across all instances of the same schema) */
  protected readonly store: SoAComponentStore<S>;

  /** Entity ID for SoA indexing */
  protected readonly entityId: number;

  /** Cached dense array index (may change if other entities are removed via swap-and-pop) */
  private _cachedIndex: number = -1;

  // ── Static EntityManager context ──────────────────────────────────────

  private static _entityManager: EntityManager | null = null;

  /**
   * Set the EntityManager context. Called once by GameWorld on construction.
   * All SoAComponent subclasses will use this to resolve their stores.
   */
  public static useEntityManager(em: EntityManager): void {
    SoAComponent._entityManager = em;
  }

  /**
   * Clear the EntityManager context. Use in tests to isolate state between runs.
   */
  public static resetContext(): void {
    SoAComponent._entityManager = null;
  }

  // ── Constructor ───────────────────────────────────────────────────────

  constructor(schema: SoASchema<S>, entityId: number, initialValues: SoAFieldsOf<S>) {
    if (!SoAComponent._entityManager) {
      throw new Error(
        'SoAComponent: No EntityManager context. Ensure GameWorld is created before instantiating SoA components.'
      );
    }

    this.entityId = entityId;
    this.store = SoAComponent._entityManager.getOrCreateSoAStore<S>(schema, DEFAULT_STORE_CAPACITY);

    // Add this entity to the store with initial values
    this.store.add(entityId, initialValues);

    // Cache the dense index for fast subsequent access
    this._cachedIndex = this.store.indexOf(entityId);
  }

  // ── Index helpers ─────────────────────────────────────────────────────

  /**
   * Get the current dense array index, re-looking up if the cache is stale.
   * Index can become stale when other entities are removed (swap-and-pop).
   */
  protected getIndex(): number {
    if (this._cachedIndex === -1 || this.store.entityAt(this._cachedIndex) !== this.entityId) {
      this._cachedIndex = this.store.indexOf(this.entityId);
    }
    return this._cachedIndex;
  }

  // ── Field access helpers ──────────────────────────────────────────────

  /**
   * Read a single field value from the SoA store for this entity.
   */
  protected getField<K extends keyof S & string>(fieldName: K): SoAFieldsOf<S>[K] {
    const idx = this.getIndex();
    return this.store.arrays[fieldName][idx] as SoAFieldsOf<S>[K];
  }

  /**
   * Write a single field value to the SoA store for this entity.
   */
  protected setField<K extends keyof S & string>(fieldName: K, value: SoAFieldsOf<S>[K]): void {
    const idx = this.getIndex();
    const arr = this.store.arrays[fieldName];
    if (arr instanceof BigInt64Array) {
      arr[idx] = value as bigint;
    } else {
      (arr as Float64Array)[idx] = value as number;
    }
  }
}
