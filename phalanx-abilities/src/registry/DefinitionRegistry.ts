export abstract class DefinitionRegistry<TDef extends { id: string }> {
  private readonly defs = new Map<string, TDef>();

  public register(def: TDef): TDef {
    if (this.defs.has(def.id)) {
      throw new Error(`${this.registryName} already contains '${def.id}'`);
    }

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

  public values(): readonly TDef[] {
    return Array.from(this.defs.values());
  }

  public get size(): number {
    return this.defs.size;
  }

  protected abstract readonly registryName: string;
}
