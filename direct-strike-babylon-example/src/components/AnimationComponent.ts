import type {
  AnimationGroup,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * Animation state enum for tracking current animation
 */
export const AnimationState = {
  Idle: 'idle',
  Running: 'running',
  Attacking: 'attacking',
  Dying: 'dying',
  Dead: 'dead',
} as const;

export type AnimationStateType =
  (typeof AnimationState)[keyof typeof AnimationState];

/**
 * Configuration for animation names per unit type
 * Each unit type can define its own animation name mappings
 */
export interface AnimationNames {
  idle: string;
  run: string;
  death: string;
  attacks: readonly string[]; // Array of attack animation names for variety
}

/**
 * AnimationComponent - Data container for entity animation state
 *
 * Follows ECS pattern: stores data only, logic handled by AnimationSystem
 */
export class AnimationComponent implements IComponent {
  public readonly type = ComponentType.Animation;

  // Animation state
  public currentState: AnimationStateType = AnimationState.Idle;
  public isModelLoaded: boolean = false;
  public isAttacking: boolean = false;
  public lastAttackAnimIndex: number = -1;

  // Combat state
  public isInCombat: boolean = false;
  public shouldForceRunAnimation: boolean = false;

  // Animation configuration
  public readonly animationBlendSpeed: number;
  public readonly animationNames: AnimationNames;

  // Model references (set after model loads)
  public modelRoot: TransformNode | null = null;
  public modelMeshes: AbstractMesh[] = [];
  public animationGroups: AnimationGroup[] = [];

  // Death sequence state
  public isDying: boolean = false;
  public onDeathComplete: (() => void) | null = null;

  constructor(animationNames: AnimationNames, blendSpeed: number = 0.15) {
    this.animationNames = animationNames;
    this.animationBlendSpeed = blendSpeed;
  }

  /**
   * Set model data after it's loaded
   */
  public setModelData(
    root: TransformNode,
    meshes: AbstractMesh[],
    animations: AnimationGroup[]
  ): void {
    this.modelRoot = root;
    this.modelMeshes = meshes;
    this.animationGroups = animations;
    this.isModelLoaded = true;
  }

  /**
   * Get animation group by name (partial match)
   */
  public getAnimation(name: string): AnimationGroup | undefined {
    return this.animationGroups.find((ag) => ag.name.includes(name));
  }

  /**
   * Clear all animation data (for disposal)
   */
  public clear(): void {
    this.animationGroups = [];
    this.modelMeshes = [];
    this.modelRoot = null;
    this.isModelLoaded = false;
  }
}
