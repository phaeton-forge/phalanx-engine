// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Entity, resetEntityIdCounter } from '../../src/Entity';
import { EntityManager } from '../../src/EntityManager';
import { SoAComponent } from '../../src/SoAComponent';
import { defineSoASchema } from '../../src/SoASchema';
import { PoolManager } from '../../src/pool/PoolManager';
import { DebugDataProvider } from '../../src/debug/DebugDataProvider';
import { DebugPanel } from '../../src/debug/DebugPanel';
import type { IComponent } from '../../src/Component';
import type { IPoolableEntity } from '../../src/pool/IPoolableEntity';

class PoolableEntity extends Entity implements IPoolableEntity {
  onSpawn(): void {}
  onDespawn(): void {}
}

// ── Test fixtures ──────────────────────────────────────────────────

const HealthType = Symbol('Health');
const ArmorType = Symbol('Armor');

class HealthComponent implements IComponent {
  readonly type = HealthType;
  constructor(public hp: number = 100) {}
}

class ArmorComponent implements IComponent {
  readonly type = ArmorType;
  constructor(public armor: number = 10) {}
}

const PhysicsSoASchema = defineSoASchema(
  { velocityX: 'i64', velocityY: 'i64', radius: 'f64', isStatic: 'u8' },
  'PhysicsBody',
);

class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  public readonly type = Symbol('PhysicsBody');
  static readonly soaSchema = PhysicsSoASchema;

  constructor(entityId: number, radius: number = 1.0) {
    super(PhysicsSoASchema, entityId, {
      velocityX: 0n,
      velocityY: 0n,
      radius,
      isStatic: 0,
    });
  }
}

// ── Helper ─────────────────────────────────────────────────────

function createProvider(
  em: EntityManager,
  pools: PoolManager | null = null,
): DebugDataProvider {
  return new DebugDataProvider(em, pools, { updateInterval: 0 });
}

// ── Tests ──────────────────────────────────────────────────────

describe('DebugPanel', () => {
  let em: EntityManager;
  let provider: DebugDataProvider;
  let panel: DebugPanel;

  beforeEach(() => {
    resetEntityIdCounter();
    em = new EntityManager();
    em.registerComponentTypes([HealthType, ArmorType]);
    SoAComponent.useEntityManager(em);
    provider = createProvider(em);
  });

  afterEach(() => {
    // Clean up panel if it was created
    if (panel) {
      panel.destroy();
    }
    SoAComponent.resetContext();
  });

  // ── DOM lifecycle ──────────────────────────────────────────────

  describe('DOM lifecycle', () => {
    it('creates root DOM element on construction', () => {
      panel = new DebugPanel(provider);
      expect(panel.element).toBeInstanceOf(HTMLDivElement);
      expect(document.body.contains(panel.element)).toBe(true);
    });

    it('removes root DOM element on destroy()', () => {
      panel = new DebugPanel(provider);
      const el = panel.element;
      expect(document.body.contains(el)).toBe(true);
      panel.destroy();
      expect(document.body.contains(el)).toBe(false);
    });

    it('unsubscribes from provider on destroy()', () => {
      vi.useFakeTimers();

      // Use a provider with a real update interval so it pushes snapshots
      const timedProvider = new DebugDataProvider(em, null, { updateInterval: 200 });
      timedProvider.start();

      const entity = new Entity();
      entity.addComponent(new HealthComponent(100));
      em.addEntity(entity);

      panel = new DebugPanel(timedProvider);

      // Advance timers so the provider pushes a snapshot
      vi.advanceTimersByTime(200);
      expect(panel.element.textContent).toContain('1');

      // Destroy the panel (should unsubscribe)
      panel.destroy();

      // Add another entity
      const e2 = new Entity();
      e2.addComponent(new HealthComponent(200));
      em.addEntity(e2);

      // Advance timers again — provider pushes a new snapshot, but
      // the panel should NOT update because destroy() unsubscribed.
      vi.advanceTimersByTime(200);

      // Provider sees 2 entities, but the detached panel still shows 1
      const snap = timedProvider.getSnapshot();
      expect(snap.world.entityCount).toBe(2);
      expect(panel.element.textContent).not.toContain('[ID: ' + e2.id + ']');

      timedProvider.stop();
      timedProvider.dispose();
      vi.useRealTimers();
    });
  });

  // ── Rendering ──────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders world overview section with entity count', () => {
      const e1 = new Entity();
      em.addEntity(e1);
      const e2 = new Entity();
      em.addEntity(e2);

      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain('Entities:');
      expect(text).toContain('2');
      expect(text).toContain('World Overview');
    });

    it('renders entity list with component names', () => {
      const entity = new Entity();
      entity.addComponent(new HealthComponent(75));
      entity.addComponent(new ArmorComponent(20));
      em.addEntity(entity);

      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain(`[ID: ${entity.id}]`);
      expect(text).toContain('Health');
      expect(text).toContain('Armor');
    });

    it('renders SoA store section with field types', () => {
      const entity = new Entity();
      em.addEntity(entity);
      new PhysicsBodyComponent(entity.id, 2.5);

      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain('PhysicsBody');
      expect(text).toContain('velocityX');
      expect(text).toContain('i64');
      expect(text).toContain('f64');
    });

    it('renders pool stats table', () => {
      const pools = new PoolManager(em);
      pools.registerEntityType('projectile', {
        factory: () => new PoolableEntity(),
        pool: { initialSize: 5 },
      });
      pools.prewarmAll();

      provider = new DebugDataProvider(em, pools, { updateInterval: 0 });
      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain('projectile');
      expect(text).toContain('5'); // available and totalCreated
    });

    it('renders empty state gracefully', () => {
      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain('0');
      expect(text).toContain('(0 entities)');
      expect(text).toContain('No pools registered');
    });

    it('formats bigint values with n suffix', () => {
      const entity = new Entity();
      em.addEntity(entity);
      new PhysicsBodyComponent(entity.id, 3.14);

      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      // SoA grid should show bigint values with 'n' suffix
      expect(text).toContain('0n');
    });

    it('shows paused indicator', () => {
      provider.paused = true;

      panel = new DebugPanel(provider);

      const text = panel.element.textContent!;
      expect(text).toContain('PAUSED');
    });
  });

  // ── Collapse behavior ──────────────────────────────────────────

  describe('collapse behavior', () => {
    it('starts expanded by default', () => {
      panel = new DebugPanel(provider);
      // Body should be visible
      const body = panel.element.querySelector('div:nth-child(2)') as HTMLDivElement;
      expect(body.style.display).not.toBe('none');
      // Toggle button should show minus
      expect(panel.element.textContent).toContain('\u2212');
    });

    it('collapses to stripe on toggle button click', () => {
      panel = new DebugPanel(provider);

      // Find the toggle button [−]
      const titleBar = panel.element.firstElementChild as HTMLDivElement;
      const toggleBtn = titleBar.querySelector('span:last-child') as HTMLSpanElement;
      toggleBtn.click();

      // Body should be hidden
      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).toBe('none');
      expect(panel.element.textContent).toContain('[+]');
    });

    it('expands from stripe on toggle button click', () => {
      panel = new DebugPanel(provider, { startCollapsed: true });

      // Should start collapsed
      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).toBe('none');

      // Click toggle to expand
      const titleBar = panel.element.firstElementChild as HTMLDivElement;
      const toggleBtn = titleBar.querySelector('span:last-child') as HTMLSpanElement;
      toggleBtn.click();

      expect(body.style.display).toBe('block');
      expect(panel.element.textContent).toContain('\u2212');
    });

    it('starts collapsed when startCollapsed is true', () => {
      panel = new DebugPanel(provider, { startCollapsed: true });

      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).toBe('none');
      expect(panel.element.textContent).toContain('[+]');
    });

    it('section collapse toggles section visibility', () => {
      const entity = new Entity();
      entity.addComponent(new HealthComponent());
      em.addEntity(entity);

      panel = new DebugPanel(provider);

      // Find the Entities section header (first collapsible section after world overview)
      const body = panel.element.children[1] as HTMLDivElement;
      // World overview is first child, then Entities section
      const entitiesSection = body.children[1] as HTMLDivElement;
      const entitiesHeader = entitiesSection.children[0] as HTMLDivElement;
      const entitiesBody = entitiesSection.children[1] as HTMLDivElement;

      // Should start expanded
      expect(entitiesBody.style.display).not.toBe('none');

      // Click to collapse
      entitiesHeader.click();
      expect(entitiesBody.style.display).toBe('none');

      // Click to expand
      entitiesHeader.click();
      expect(entitiesBody.style.display).toBe('block');
    });
  });

  // ── Drag behavior ──────────────────────────────────────────────

  describe('drag behavior', () => {
    it('updates position on mouse drag of title bar', () => {
      panel = new DebugPanel(provider);
      const titleBar = panel.element.firstElementChild as HTMLDivElement;

      // Simulate drag
      const mousedown = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      });
      titleBar.dispatchEvent(mousedown);

      const mousemove = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 150,
        bubbles: true,
      });
      document.dispatchEvent(mousemove);

      // Position should have changed
      expect(panel.element.style.right).toBe('auto');
      // The left/top should reflect the drag offset
      expect(panel.element.style.left).toBeTruthy();
      expect(panel.element.style.top).toBeTruthy();

      const mouseup = new MouseEvent('mouseup', { bubbles: true });
      document.dispatchEvent(mouseup);
    });

    it('does not drag when clicking panel body', () => {
      panel = new DebugPanel(provider);
      const body = panel.element.children[1] as HTMLDivElement;

      const initialRight = panel.element.style.right;

      // Click on body, not title bar
      const mousedown = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      body.dispatchEvent(mousedown);

      const mousemove = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mousemove);

      // Position should NOT have changed (right should still be set)
      expect(panel.element.style.right).toBe(initialRight);

      const mouseup = new MouseEvent('mouseup', { bubbles: true });
      document.dispatchEvent(mouseup);
    });
  });

  // ── Keyboard shortcut ──────────────────────────────────────────

  describe('keyboard shortcut', () => {
    it('toggles collapse on backtick press', () => {
      panel = new DebugPanel(provider);

      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).not.toBe('none');

      // Press backtick
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
      expect(body.style.display).toBe('none');

      // Press again to expand
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
      expect(body.style.display).toBe('block');
    });

    it('ignores backtick when typing in input element', () => {
      panel = new DebugPanel(provider);

      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).not.toBe('none');

      // Create an input element and simulate keydown targeting it
      const input = document.createElement('input');
      document.body.appendChild(input);

      const event = new KeyboardEvent('keydown', { key: '`', bubbles: true });
      Object.defineProperty(event, 'target', { value: input, writable: false });
      document.dispatchEvent(event);

      // Should still be expanded (shortcut ignored)
      expect(body.style.display).not.toBe('none');

      document.body.removeChild(input);
    });

    it('respects custom toggleKey config', () => {
      panel = new DebugPanel(provider, { toggleKey: 'F2' });

      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).not.toBe('none');

      // Backtick should NOT toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
      expect(body.style.display).not.toBe('none');

      // F2 should toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
      expect(body.style.display).toBe('none');
    });

    it('disables shortcut when toggleKey is empty string', () => {
      panel = new DebugPanel(provider, { toggleKey: '' });

      const body = panel.element.children[1] as HTMLDivElement;
      expect(body.style.display).not.toBe('none');

      // No key should toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '`', bubbles: true }));
      expect(body.style.display).not.toBe('none');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
      expect(body.style.display).not.toBe('none');
    });
  });
});
