/**
 * Typed key for a world service. Keys compare by reference; `name` is for
 * error messages and must be unique within a world.
 */
export interface ServiceKey<T> {
  readonly name: string;
  /** Phantom field that carries `T`. Never set. */
  readonly __service?: T;
}

/** Create a service key. Call once at module scope and export the result. */
export function defineService<T>(name: string): ServiceKey<T> {
  return Object.freeze({ name });
}

/** Services provided to one world, in `provide` order. */
export class ServiceRegistry {
  private readonly entries = new Map<ServiceKey<unknown>, unknown>();

  public provide<T>(key: ServiceKey<T>, impl: T): void {
    if (this.entries.has(key)) {
      throw new Error(`provide: service '${key.name}' is already provided`);
    }
    for (const existing of this.entries.keys()) {
      if (existing.name === key.name) {
        throw new Error(
          `provide: another service key named '${key.name}' is already provided; ` +
            'the bundle probably contains two copies of the package that defines it'
        );
      }
    }
    this.entries.set(key, impl);
  }

  public get<T>(key: ServiceKey<T>): T {
    if (!this.entries.has(key)) {
      const names = this.names();
      const provided = names.length === 0 ? '(none)' : names.join(', ');
      throw new Error(
        `getService: service '${key.name}' is not provided; provided: ${provided}`
      );
    }
    return this.entries.get(key) as T;
  }

  public tryGet<T>(key: ServiceKey<T>): T | undefined {
    return this.entries.get(key) as T | undefined;
  }

  public names(): readonly string[] {
    return [...this.entries.keys()].map((key) => key.name);
  }
}
