import type { AbilityHook } from '../types';

export class AbilityHooksRegistry {
  private readonly hooks = new Map<string, AbilityHook>();

  public register(hookId: string, hook: AbilityHook): void {
    if (this.hooks.has(hookId)) {
      throw new Error(`AbilityHooksRegistry already contains '${hookId}'`);
    }

    this.hooks.set(hookId, hook);
  }

  public get(hookId: string): AbilityHook {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      throw new Error(`AbilityHooksRegistry does not contain '${hookId}'`);
    }

    return hook;
  }

  public tryGet(hookId: string): AbilityHook | undefined {
    return this.hooks.get(hookId);
  }

  public has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  public get size(): number {
    return this.hooks.size;
  }
}
