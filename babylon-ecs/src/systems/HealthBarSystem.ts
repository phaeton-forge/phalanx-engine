import {AdvancedDynamicTexture, Control, Rectangle} from '@babylonjs/gui';
import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';
import {ComponentType, HealthComponent} from '../components';
import {Entity} from '../entities/Entity';
import type {DamageAppliedEvent, EntityDestroyedEvent, EntityDyingEvent,} from '../events';
import {GameEvents} from '../events';

interface HealthBar {
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
 * Features:
 * - Uses 2D GUI elements (Rectangle) instead of 3D meshes
 * - Automatic billboarding via linkWithMesh()
 * - Dynamic visibility: Hidden at 100% health, shown when damaged
 * - Color gradient: Green (100%) -> Yellow (50%) -> Red (0%)
 */
export class HealthBarSystem extends GameSystem {
  private guiTexture!: AdvancedDynamicTexture;
  private healthBars: Map<number, HealthBar> = new Map();

  // Health bar dimensions (in pixels)
  private readonly BAR_WIDTH = 60;
  private readonly BAR_HEIGHT = 8;

  constructor() {
    super();
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
      this.context.scene
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
        this.removeHealthBar(event.entityId);
      }
    );

    // Listen for entity destruction to cleanup health bars
    this.subscribe<EntityDestroyedEvent>(
      GameEvents.ENTITY_DESTROYED,
      (event) => {
        this.removeHealthBar(event.entityId);
      }
    );
  }

  /**
   * Register an entity to have a health bar
   * @param entity The entity to track
   * @param heightOffset Y offset above the entity mesh (in world units)
   */
  public registerEntity(entity: Entity, heightOffset: number = 3): void {
    const healthComp = entity.getComponent<HealthComponent>(
      ComponentType.Health
    );
    if (!healthComp) return;

    // Don't create duplicate health bars
    if (this.healthBars.has(entity.id)) return;

    const mesh = entity.getMesh();
    if (!mesh) return;

    const healthBar = this.createHealthBar(entity.id, heightOffset);
    this.healthBars.set(entity.id, healthBar);

    // Link the container to the entity's mesh
    healthBar.container.linkWithMesh(mesh);
    healthBar.container.linkOffsetY = -heightOffset * 15; // Convert world units to pixels (approximate)

    // Initially hidden if at full health
    this.updateHealthBarVisibility(healthBar, healthComp.healthPercent);
  }

  /**
   * Unregister an entity and remove its health bar
   */
  public unregisterEntity(entityId: number): void {
    this.removeHealthBar(entityId);
  }

  /**
   * Create a health bar using GUI elements
   */
  private createHealthBar(entityId: number, heightOffset: number): HealthBar {
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
    const healthBar = this.healthBars.get(entityId);
    if (!healthBar) return;

    const healthPercent = currentHealth / maxHealth;

    // Update foreground bar width
    const width = Math.max(healthPercent * this.BAR_WIDTH, 1);
    healthBar.foreground.width = `${width}px`;

    // Update color based on health percentage
    this.updateHealthBarColor(healthBar, healthPercent);

    // Update visibility
    this.updateHealthBarVisibility(healthBar, healthPercent);
  }

  /**
   * Update health bar color with gradient from green -> yellow -> red
   */
  private updateHealthBarColor(
    healthBar: HealthBar,
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

    healthBar.foreground.background = `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Update health bar visibility (hidden at 100% health)
   */
  private updateHealthBarVisibility(
    healthBar: HealthBar,
    healthPercent: number
  ): void {
    healthBar.container.isVisible = healthPercent < 1;
  }

  /**
   * Remove a health bar
   */
  private removeHealthBar(entityId: number): void {
    const healthBar = this.healthBars.get(entityId);
    if (!healthBar) return;

    healthBar.foreground.dispose();
    healthBar.background.dispose();
    healthBar.container.dispose();
    this.healthBars.delete(entityId);
  }

  /**
   * Update method - no longer needed since linkWithMesh handles positioning
   * Kept for cleanup of removed entities
   */
  public update(): void {
    // Check for entities that no longer exist
    for (const entityId of this.healthBars.keys()) {
      const entity = this.entityManager.getEntity(entityId);
      if (!entity) {
        this.removeHealthBar(entityId);
      }
    }
  }

  /**
   * Dispose of the health bar system
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class

    for (const healthBar of this.healthBars.values()) {
      healthBar.foreground.dispose();
      healthBar.background.dispose();
      healthBar.container.dispose();
    }
    this.healthBars.clear();
  }
}
