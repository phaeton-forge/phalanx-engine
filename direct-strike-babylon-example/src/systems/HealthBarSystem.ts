import {AdvancedDynamicTexture, Control, Rectangle} from '@babylonjs/gui';
import type { Scene } from '@babylonjs/core';
import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import type { Unit } from '../entities/Unit';
import {ComponentType, HealthComponent, HealthBarComponent, DeathComponent} from '../components';
import type {DamageAppliedEvent, EntityDestroyedEvent, EntityDyingEvent,} from '../events';
import {GameEvents} from '../events';

interface HealthBarUI {
  entityId: number;
  container: Rectangle;
  background: Rectangle;
  foreground: Rectangle;
  heightOffset: number;
}

/**
 * HealthBarSystem - Displays health bars above entities using BabylonJS GUI
 * Extends GameSystem for consistent lifecycle management
 *
 * Following ECS principles: queries entities with HealthBarComponent
 * and automatically creates/removes health bar UI elements.
 *
 * Features:
 * - Uses 2D GUI elements (Rectangle) instead of 3D meshes
 * - Automatic billboarding via linkWithMesh()
 * - Dynamic visibility: Hidden at 100% health, shown when damaged
 * - Color gradient: Green (100%) -> Yellow (50%) -> Red (0%)
 */
export class HealthBarSystem extends GameSystem {
  private guiTexture!: AdvancedDynamicTexture;
  // Internal UI state - maps entity ID to GUI elements
  // Note: This is UI state, not game state, so it's acceptable to track here
  private healthBarUIs: Map<number, HealthBarUI> = new Map();

  // Health bar dimensions (in pixels)
  private readonly BAR_WIDTH = 60;
  private readonly BAR_HEIGHT = 8;
  private scene: Scene;

  constructor(scene: Scene) {
    super();
    this.scene = scene;
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);

    // Create fullscreen GUI texture for health bars
    this.guiTexture = AdvancedDynamicTexture.CreateFullscreenUI(
      'healthBarUI',
      true,
      this.scene
    );

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for damage events to update health bars
    this.subscribe<DamageAppliedEvent>(
      GameEvents.DAMAGE_APPLIED,
      (event) => {
        this.updateHealthBar(
          event.entityId,
          event.newHealth,
          event.maxHealth
        );
      }
    );

    // Listen for entity dying to remove health bar immediately (before death animation)
    this.subscribe<EntityDyingEvent>(
      GameEvents.ENTITY_DYING,
      (event) => {
        this.removeHealthBarUI(event.entityId);
      }
    );

    // Listen for entity destruction to cleanup health bars
    this.subscribe<EntityDestroyedEvent>(
      GameEvents.ENTITY_DESTROYED,
      (event) => {
        this.removeHealthBarUI(event.entityId);
      }
    );
  }

  /**
   * Create a health bar UI for an entity
   */
  private createHealthBarUI(entityId: number, heightOffset: number): HealthBarUI {
    // Container rectangle (groups background and foreground)
    const container = new Rectangle(`healthBar_container_${entityId}`);
    container.width = `${this.BAR_WIDTH + 4}px`;
    container.height = `${this.BAR_HEIGHT + 4}px`;
    container.cornerRadius = 2;
    container.color = 'transparent';
    container.background = 'transparent';
    container.isPointerBlocker = false;
    this.guiTexture.addControl(container);

    // Background rectangle (dark gray)
    const background = new Rectangle(`healthBar_bg_${entityId}`);
    background.width = `${this.BAR_WIDTH}px`;
    background.height = `${this.BAR_HEIGHT}px`;
    background.cornerRadius = 2;
    background.color = '#222222';
    background.thickness = 1;
    background.background = '#333333';
    background.isPointerBlocker = false;
    container.addControl(background);

    // Foreground rectangle (health indicator)
    const foreground = new Rectangle(`healthBar_fg_${entityId}`);
    foreground.width = `${this.BAR_WIDTH}px`;
    foreground.height = `${this.BAR_HEIGHT}px`;
    foreground.cornerRadius = 2;
    foreground.color = 'transparent';
    foreground.thickness = 0;
    foreground.background = '#00ff00'; // Start green
    foreground.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    foreground.isPointerBlocker = false;
    background.addControl(foreground);

    return {
      entityId,
      container,
      background,
      foreground,
      heightOffset,
    };
  }

  /**
   * Update health bar display based on current health
   */
  private updateHealthBar(
    entityId: number,
    currentHealth: number,
    maxHealth: number
  ): void {
    const healthBarUI = this.healthBarUIs.get(entityId);
    if (!healthBarUI) return;

    const healthPercent = currentHealth / maxHealth;

    // Update foreground bar width
    const width = Math.max(healthPercent * this.BAR_WIDTH, 1);
    healthBarUI.foreground.width = `${width}px`;

    // Update color based on health percentage
    this.updateHealthBarColor(healthBarUI, healthPercent);

    // Update visibility
    this.updateHealthBarVisibility(healthBarUI, healthPercent);
  }

  /**
   * Update health bar color with gradient from green -> yellow -> red
   */
  private updateHealthBarColor(
    healthBarUI: HealthBarUI,
    healthPercent: number
  ): void {
    let r: number, g: number, b: number;

    if (healthPercent > 0.5) {
      // Green to Yellow (100% -> 50%)
      const t = (healthPercent - 0.5) * 2; // 1 at 100%, 0 at 50%
      r = Math.round((1 - t) * 255); // 0 at 100%, 255 at 50%
      g = 255;
      b = 0;
    } else {
      // Yellow to Red (50% -> 0%)
      const t = healthPercent * 2; // 1 at 50%, 0 at 0%
      r = 255;
      g = Math.round(t * 255); // 255 at 50%, 0 at 0%
      b = 0;
    }

    healthBarUI.foreground.background = `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Update health bar visibility (hidden at 100% health)
   */
  private updateHealthBarVisibility(
    healthBarUI: HealthBarUI,
    healthPercent: number
  ): void {
    healthBarUI.container.isVisible = healthPercent < 1;
  }

  /**
   * Remove a health bar UI
   */
  private removeHealthBarUI(entityId: number): void {
    const healthBarUI = this.healthBarUIs.get(entityId);
    if (!healthBarUI) return;

    healthBarUI.foreground.dispose();
    healthBarUI.background.dispose();
    healthBarUI.container.dispose();
    this.healthBarUIs.delete(entityId);
  }

  /**
   * Update method - queries entities with HealthBarComponent and manages UI
   * Called each frame to sync UI with entity state
   */
  public update(): void {
    // Query all entities with HealthBarComponent
    const healthBarEntities = this.entityManager.queryEntities(
      ComponentType.HealthBar
    );

    // Track which entities we've seen this frame
    const seenEntityIds = new Set<number>();

    for (const entity of healthBarEntities) {
      seenEntityIds.add(entity.id);

      // Skip dying entities - their health bars were already removed by ENTITY_DYING event
      const deathComp = entity.getComponent<DeathComponent>(ComponentType.Death);
      if (deathComp?.isDying) {
        // Also ensure any lingering UI is removed
        this.removeHealthBarUI(entity.id);
        continue;
      }

      // Skip if UI already exists for this entity
      if (this.healthBarUIs.has(entity.id)) continue;

      // Get required components
      const healthBarComp = entity.getComponent<HealthBarComponent>(ComponentType.HealthBar);
      const healthComp = entity.getComponent<HealthComponent>(ComponentType.Health);
      if (!healthBarComp || !healthComp) continue;

      const mesh = (entity as Unit).getMesh();
      if (!mesh) continue;

      // Create health bar UI for this entity
      const healthBarUI = this.createHealthBarUI(entity.id, healthBarComp.heightOffset);
      this.healthBarUIs.set(entity.id, healthBarUI);

      // Link the container to the entity's mesh
      healthBarUI.container.linkWithMesh(mesh);
      healthBarUI.container.linkOffsetY = -healthBarComp.heightOffset * 15; // Convert world units to pixels (approximate)

      // Initially hidden if at full health
      this.updateHealthBarVisibility(healthBarUI, healthComp.healthPercent);
    }

    // Remove UI for entities that no longer exist or lost their HealthBarComponent
    for (const entityId of this.healthBarUIs.keys()) {
      if (!seenEntityIds.has(entityId)) {
        this.removeHealthBarUI(entityId);
      }
    }
  }

  /**
   * Dispose of the health bar system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class

    for (const healthBarUI of this.healthBarUIs.values()) {
      healthBarUI.foreground.dispose();
      healthBarUI.background.dispose();
      healthBarUI.container.dispose();
    }
    this.healthBarUIs.clear();
  }
}
