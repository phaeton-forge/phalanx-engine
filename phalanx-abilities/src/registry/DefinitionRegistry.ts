export abstract class DefinitionRegistry<TDef extends { id: string }> {
  private readonly defs = new Map<string, TDef>();
  /** Stable insertion-ordered array of registered definitions. */
  private readonly defsArray: TDef[] = [];
  /** id -> index in defsArray; kept in sync with defsArray. */
  private readonly indexById = new Map<string, number>();

  public register(def: TDef): TDef {
    if (this.defs.has(def.id)) {
      throw new Error(`${this.registryName} already contains '${def.id}'`);
    }

    this.indexById.set(def.id, this.defsArray.length);
    this.defsArray.push(def);
    this.defs.set(def.id, def);
    return def;
  }

  public get(id: string): TDef {
    const def = this.defs.get(id);
    if (!def) {
      throw new Error(`${this.registryName} does not contain '${id}'`);
    }

    return def;
  }

  public tryGet(id: string): TDef | undefined {
    return this.defs.get(id);
  }

  public has(id: string): boolean {
    return this.defs.has(id);
  }

  /**
   * Returns the stable insertion-ordered array of registered definitions.
   *
   * The same array reference is returned across calls (no per-call
   * allocation); callers MUST NOT mutate it. Insertion order is the
   * canonical attribute/effect index used by SoA-style components such as
   * {@link AttributesComponent}.
   */
  public values(): readonly TDef[] {
    return this.defsArray;
  }

  /**
   * O(1) lookup of the insertion index of `id`. Returns `-1` if the id is
   * not registered. Subclasses (e.g. {@link AttributeRegistry}) may throw
   * a typed error instead.
   */
  public indexOfOrMinusOne(id: string): number {
    const index = this.indexById.get(id);
    return index === undefined ? -1 : index;
  }

  public get size(): number {
    return this.defsArray.length;
  }

  protected abstract readonly registryName: string;
}
