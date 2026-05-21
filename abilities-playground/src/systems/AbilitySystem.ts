import { GameSystem, type SystemContext } from 'phalanx-ecs';
import {
  AbilityActivationSystem,
  AbilityHookExecutorSystem,
  AttributeAggregationSystem,
  AuraTickSystem,
  EffectApplicationSystem,
  EffectTickSystem,
} from 'phalanx-abilities';
import type { AbilitySystemRegistries } from 'phalanx-abilities';
import type { AbilitySystemRuntime } from 'phalanx-abilities';

export class AbilitySystem extends GameSystem {
  private readonly systems: GameSystem[];

  public constructor(
    registries: AbilitySystemRegistries,
    runtime: AbilitySystemRuntime
  ) {
    super();
    this.systems = [
      new AbilityActivationSystem(registries, runtime),
      new EffectApplicationSystem(registries, runtime),
      new AbilityHookExecutorSystem(registries, runtime),
      new EffectTickSystem(registries, runtime),
      new AttributeAggregationSystem(registries),
      new AuraTickSystem(registries, runtime),
    ];
  }

  public override init(context: SystemContext): void {
    super.init(context);
    for (const system of this.systems) {
      system.init(context);
    }
  }

  public override processTick(tick: number): void {
    for (const system of this.systems) {
      system.processTick(tick);
    }
  }

  public override dispose(): void {
    for (const system of this.systems) {
      system.dispose();
    }
    super.dispose();
  }
}
