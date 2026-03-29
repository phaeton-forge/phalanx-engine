import type { DebugDataProvider } from './DebugDataProvider';
import type {
  DebugSnapshot,
  DebugEntitySnapshot,
  DebugSoAStoreSnapshot,
  DebugPoolSnapshot,
  DebugPanelConfig,
} from './types';

const FONT_MONO = "'Consolas', 'Monaco', 'Courier New', monospace";
const COLOR_BG = 'rgba(15, 15, 20, 0.92)';
const COLOR_TEXT = '#c8ccd0';
const COLOR_ACCENT = '#4fc3f7';
const COLOR_WARNING = '#ffb74d';

/**
 * DebugPanel — Pure DOM renderer that subscribes to DebugDataProvider
 * and renders an overlay panel with ECS debug information.
 *
 * All styles are inline. No CSS files. Works in any browser environment
 * with a `document` global.
 */
export class DebugPanel {
  private readonly provider: DebugDataProvider;
  private readonly toggleKey: string;
  private readonly unsubscribe: () => void;
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private readonly mouseMoveHandler: (e: MouseEvent) => void;
  private readonly mouseUpHandler: () => void;

  // Root DOM
  private readonly root: HTMLDivElement;
  private readonly titleBar: HTMLDivElement;
  private readonly titleText: HTMLSpanElement;
  private readonly toggleBtn: HTMLSpanElement;
  private readonly body: HTMLDivElement;

  // Sections
  private readonly worldSection: HTMLDivElement;
  private readonly entityCountEl: HTMLSpanElement;
  private readonly soaCountEl: HTMLSpanElement;
  private readonly pausedEl: HTMLSpanElement;

  private readonly entitiesSection: HTMLDivElement;
  private readonly entitiesHeader: HTMLDivElement;
  private readonly entitiesBody: HTMLDivElement;
  private readonly entitiesSummary: HTMLSpanElement;

  private readonly soaSection: HTMLDivElement;
  private readonly soaHeader: HTMLDivElement;
  private readonly soaBody: HTMLDivElement;
  private readonly soaSummary: HTMLSpanElement;

  private readonly poolSection: HTMLDivElement;
  private readonly poolHeader: HTMLDivElement;
  private readonly poolBody: HTMLDivElement;
  private readonly poolSummary: HTMLSpanElement;

  // State
  private collapsed: boolean;
  private entitiesSectionCollapsed = false;
  private soaSectionCollapsed = false;
  private poolSectionCollapsed = false;
  private expandedEntities: Set<number> = new Set();

  // Drag state
  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(provider: DebugDataProvider, config?: DebugPanelConfig) {
    this.provider = provider;
    this.toggleKey = config?.toggleKey ?? '`';
    this.collapsed = config?.startCollapsed ?? false;

    // Build DOM
    this.root = document.createElement('div');
    this.applyRootStyles();

    // Title bar
    this.titleBar = document.createElement('div');
    this.applyTitleBarStyles();

    this.titleText = document.createElement('span');
    this.titleText.textContent = '\u2699 Phalanx Debug';

    this.toggleBtn = document.createElement('span');
    this.applyToggleBtnStyles();
    this.updateToggleBtn();

    this.titleBar.appendChild(this.titleText);
    this.titleBar.appendChild(this.toggleBtn);
    this.root.appendChild(this.titleBar);

    // Body container
    this.body = document.createElement('div');
    this.body.style.padding = '6px 8px';
    this.body.style.maxHeight = '80vh';
    this.body.style.overflowY = 'auto';
    this.body.style.display = this.collapsed ? 'none' : 'block';
    this.root.appendChild(this.body);

    // World overview (always visible)
    this.worldSection = document.createElement('div');
    this.worldSection.style.marginBottom = '6px';
    this.worldSection.style.paddingBottom = '4px';
    this.worldSection.style.borderBottom = '1px solid rgba(255,255,255,0.1)';

    const worldLabel = document.createElement('div');
    worldLabel.style.fontSize = '12px';
    worldLabel.style.fontWeight = 'bold';
    worldLabel.style.color = COLOR_ACCENT;
    worldLabel.style.marginBottom = '2px';
    worldLabel.textContent = 'World Overview';
    this.worldSection.appendChild(worldLabel);

    const worldDataRow = document.createElement('div');
    worldDataRow.style.fontSize = '11px';

    this.entityCountEl = document.createElement('span');
    this.soaCountEl = document.createElement('span');
    this.pausedEl = document.createElement('span');

    worldDataRow.appendChild(this.createLabel('Entities: '));
    worldDataRow.appendChild(this.entityCountEl);
    worldDataRow.appendChild(this.createSeparator());
    worldDataRow.appendChild(this.createLabel('SoA Stores: '));
    worldDataRow.appendChild(this.soaCountEl);
    worldDataRow.appendChild(this.createSeparator());
    worldDataRow.appendChild(this.pausedEl);

    this.worldSection.appendChild(worldDataRow);
    this.body.appendChild(this.worldSection);

    // Entities section
    const entitiesResult = this.buildCollapsibleSection('Entities');
    this.entitiesSection = entitiesResult.section;
    this.entitiesHeader = entitiesResult.header;
    this.entitiesBody = entitiesResult.body;
    this.entitiesSummary = entitiesResult.summary;
    this.body.appendChild(this.entitiesSection);

    // SoA Stores section
    const soaResult = this.buildCollapsibleSection('SoA Stores');
    this.soaSection = soaResult.section;
    this.soaHeader = soaResult.header;
    this.soaBody = soaResult.body;
    this.soaSummary = soaResult.summary;
    this.body.appendChild(this.soaSection);

    // Pool Stats section
    const poolResult = this.buildCollapsibleSection('Pool Stats');
    this.poolSection = poolResult.section;
    this.poolHeader = poolResult.header;
    this.poolBody = poolResult.body;
    this.poolSummary = poolResult.summary;
    this.body.appendChild(this.poolSection);

    // Attach to DOM
    document.body.appendChild(this.root);

    // Subscribe to provider
    this.unsubscribe = this.provider.subscribe((snapshot) => {
      this.renderSnapshot(snapshot);
    });

    // Render initial snapshot
    this.renderSnapshot(this.provider.getSnapshot());

    // Drag handling
    this.titleBar.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      this.dragging = true;
      this.dragOffsetX = e.clientX - this.root.offsetLeft;
      this.dragOffsetY = e.clientY - this.root.offsetTop;
    });

    this.mouseMoveHandler = (e: MouseEvent) => {
      if (!this.dragging) return;
      this.root.style.left = (e.clientX - this.dragOffsetX) + 'px';
      this.root.style.top = (e.clientY - this.dragOffsetY) + 'px';
      this.root.style.right = 'auto';
    };

    this.mouseUpHandler = () => {
      this.dragging = false;
    };

    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);

    // Keyboard shortcut
    this.keydownHandler = (e: KeyboardEvent) => {
      if (this.toggleKey === '') return;
      const isToggleMatch =
        e.key === this.toggleKey ||
        e.code === this.toggleKey ||
        (this.toggleKey === '`' && e.code === 'Backquote');
      if (!isToggleMatch) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.toggleCollapse();
    };
    document.addEventListener('keydown', this.keydownHandler);

    // Toggle button – stop mousedown so title-bar drag doesn't fire,
    // and handle click for the actual collapse toggle.
    this.toggleBtn.addEventListener('mousedown', (e: MouseEvent) => {
      e.stopPropagation();
    });
    this.toggleBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      this.toggleCollapse();
    });

    // Section collapse handlers
    this.entitiesHeader.addEventListener('click', () => {
      this.entitiesSectionCollapsed = !this.entitiesSectionCollapsed;
      this.applySectionCollapse(this.entitiesHeader, this.entitiesBody, this.entitiesSectionCollapsed);
    });
    this.soaHeader.addEventListener('click', () => {
      this.soaSectionCollapsed = !this.soaSectionCollapsed;
      this.applySectionCollapse(this.soaHeader, this.soaBody, this.soaSectionCollapsed);
    });
    this.poolHeader.addEventListener('click', () => {
      this.poolSectionCollapsed = !this.poolSectionCollapsed;
      this.applySectionCollapse(this.poolHeader, this.poolBody, this.poolSectionCollapsed);
    });
  }

  /**
   * Clean up: unsubscribe from provider, remove DOM, detach listeners.
   */
  public destroy(): void {
    this.unsubscribe();
    document.removeEventListener('keydown', this.keydownHandler);
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    if (this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }

  /**
   * The root DOM element of the panel.
   */
  public get element(): HTMLDivElement {
    return this.root;
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private renderSnapshot(snapshot: DebugSnapshot): void {
    // World overview — always update
    this.entityCountEl.textContent = String(snapshot.world.entityCount);
    this.soaCountEl.textContent = String(snapshot.world.soaStoreCount);

    if (snapshot.world.paused) {
      this.pausedEl.textContent = 'PAUSED';
      this.pausedEl.style.color = COLOR_WARNING;
      this.pausedEl.style.fontWeight = 'bold';
    } else {
      this.pausedEl.textContent = 'Running';
      this.pausedEl.style.color = COLOR_TEXT;
      this.pausedEl.style.fontWeight = 'normal';
    }

    // Section summaries
    this.entitiesSummary.textContent = `(${snapshot.entities.length} entities)`;
    this.soaSummary.textContent = `(${snapshot.soaStores.length} stores)`;
    this.poolSummary.textContent = `(${snapshot.pools.length} pools)`;

    // Entities
    if (!this.entitiesSectionCollapsed) {
      this.renderEntities(snapshot.entities);
    }

    // SoA Stores
    if (!this.soaSectionCollapsed) {
      this.renderSoAStores(snapshot.soaStores);
    }

    // Pool Stats
    if (!this.poolSectionCollapsed) {
      this.renderPoolStats(snapshot.pools);
    }
  }

  private renderEntities(entities: DebugEntitySnapshot[]): void {
    this.entitiesBody.innerHTML = '';

    for (const entity of entities) {
      const row = document.createElement('div');
      row.style.cursor = 'pointer';
      row.style.padding = '2px 0';
      row.style.fontSize = '11px';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

      const componentNames = entity.components.map((c) => c.typeName).join(', ');
      const label = document.createElement('span');
      label.textContent = `[ID: ${entity.id}] ${componentNames}`;
      row.appendChild(label);

      const isExpanded = this.expandedEntities.has(entity.id);

      row.addEventListener('click', () => {
        if (this.expandedEntities.has(entity.id)) {
          this.expandedEntities.delete(entity.id);
        } else {
          this.expandedEntities.add(entity.id);
        }
        // Re-render entities from last snapshot — trigger a fresh snapshot
        this.renderEntities(this.provider.getSnapshot().entities);
      });

      this.entitiesBody.appendChild(row);

      if (isExpanded) {
        const detail = document.createElement('div');
        detail.style.paddingLeft = '12px';
        detail.style.fontSize = '11px';
        detail.style.color = '#a0a4a8';
        detail.style.marginBottom = '4px';

        for (const comp of entity.components) {
          const compHeader = document.createElement('div');
          compHeader.style.color = COLOR_ACCENT;
          compHeader.style.marginTop = '2px';
          compHeader.textContent = comp.typeName;
          detail.appendChild(compHeader);

          for (const [key, value] of Object.entries(comp.data)) {
            const kvRow = document.createElement('div');
            kvRow.style.paddingLeft = '8px';

            const keySpan = document.createElement('span');
            keySpan.style.color = '#888';
            keySpan.textContent = `${key}: `;

            const valSpan = document.createElement('span');
            valSpan.textContent = this.formatValue(value);

            kvRow.appendChild(keySpan);
            kvRow.appendChild(valSpan);
            detail.appendChild(kvRow);
          }
        }

        this.entitiesBody.appendChild(detail);
      }
    }
  }

  private renderSoAStores(stores: DebugSoAStoreSnapshot[]): void {
    this.soaBody.innerHTML = '';

    for (const store of stores) {
      const storeDiv = document.createElement('div');
      storeDiv.style.marginBottom = '6px';
      storeDiv.style.paddingBottom = '4px';
      storeDiv.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

      // Store name
      const nameEl = document.createElement('div');
      nameEl.style.color = COLOR_ACCENT;
      nameEl.style.fontSize = '11px';
      nameEl.style.fontWeight = 'bold';
      nameEl.textContent = store.name;
      storeDiv.appendChild(nameEl);

      // Field layout
      const layoutEl = document.createElement('div');
      layoutEl.style.fontSize = '11px';
      layoutEl.style.color = '#888';
      const fieldDesc = store.fieldNames
        .map((n) => `${n}: ${store.fieldTypes[n]}`)
        .join(', ');
      layoutEl.textContent = `Fields: ${fieldDesc}`;
      storeDiv.appendChild(layoutEl);

      // Count/capacity with utilisation
      const utilPct = store.capacity > 0
        ? ((store.count / store.capacity) * 100).toFixed(0)
        : '0';
      const capacityEl = document.createElement('div');
      capacityEl.style.fontSize = '11px';
      capacityEl.textContent = `Count: ${store.count}/${store.capacity} (${utilPct}% utilised)`;
      storeDiv.appendChild(capacityEl);

      // Per-entity field data
      if (store.entities.length > 0) {
        const gridEl = document.createElement('div');
        gridEl.style.fontSize = '11px';
        gridEl.style.marginTop = '2px';
        gridEl.style.overflowX = 'auto';

        // Header row
        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.gap = '8px';
        headerRow.style.color = '#888';
        headerRow.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        headerRow.style.paddingBottom = '1px';
        headerRow.style.marginBottom = '1px';

        const idHeader = document.createElement('span');
        idHeader.style.minWidth = '40px';
        idHeader.textContent = 'ID';
        headerRow.appendChild(idHeader);

        for (const fieldName of store.fieldNames) {
          const fh = document.createElement('span');
          fh.style.minWidth = '60px';
          fh.textContent = fieldName;
          headerRow.appendChild(fh);
        }
        gridEl.appendChild(headerRow);

        // Data rows
        for (const entityData of store.entities) {
          const dataRow = document.createElement('div');
          dataRow.style.display = 'flex';
          dataRow.style.gap = '8px';

          const idCell = document.createElement('span');
          idCell.style.minWidth = '40px';
          idCell.textContent = String(entityData.entityId);
          dataRow.appendChild(idCell);

          for (const fieldName of store.fieldNames) {
            const cell = document.createElement('span');
            cell.style.minWidth = '60px';
            cell.textContent = this.formatValue(entityData.fields[fieldName]);
            dataRow.appendChild(cell);
          }
          gridEl.appendChild(dataRow);
        }

        storeDiv.appendChild(gridEl);
      }

      this.soaBody.appendChild(storeDiv);
    }
  }

  private renderPoolStats(pools: DebugPoolSnapshot[]): void {
    this.poolBody.innerHTML = '';

    if (pools.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.style.fontSize = '11px';
      emptyEl.style.color = '#888';
      emptyEl.textContent = 'No pools registered';
      this.poolBody.appendChild(emptyEl);
      return;
    }

    // Table
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.fontSize = '11px';
    table.style.borderCollapse = 'collapse';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = ['typeKey', 'available', 'totalCreated', 'acquireCount', 'releaseCount', 'missCount'];
    for (const col of columns) {
      const th = document.createElement('th');
      th.style.textAlign = 'left';
      th.style.padding = '2px 4px';
      th.style.borderBottom = '1px solid rgba(255,255,255,0.15)';
      th.style.color = '#888';
      th.style.fontWeight = 'normal';
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (const pool of pools) {
      const tr = document.createElement('tr');

      const tdKey = document.createElement('td');
      tdKey.style.padding = '2px 4px';
      tdKey.textContent = pool.typeKey;
      tr.appendChild(tdKey);

      const statValues = [
        pool.stats.available,
        pool.stats.totalCreated,
        pool.stats.acquireCount,
        pool.stats.releaseCount,
        pool.stats.missCount,
      ];
      for (const val of statValues) {
        const td = document.createElement('td');
        td.style.padding = '2px 4px';
        td.textContent = String(val);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.poolBody.appendChild(table);
  }

  // ── Collapse ───────────────────────────────────────────────────────

  private toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed ? 'none' : 'block';
    this.updateToggleBtn();
  }

  private updateToggleBtn(): void {
    this.toggleBtn.textContent = this.collapsed ? '[+]' : '[\u2212]';
  }

  private applySectionCollapse(
    header: HTMLDivElement,
    body: HTMLDivElement,
    isCollapsed: boolean,
  ): void {
    body.style.display = isCollapsed ? 'none' : 'block';
    const arrow = header.querySelector('[data-role="arrow"]') as HTMLSpanElement | null;
    if (arrow) {
      arrow.textContent = isCollapsed ? '\u25B6' : '\u25BC';
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────

  private buildCollapsibleSection(title: string): {
    section: HTMLDivElement;
    header: HTMLDivElement;
    body: HTMLDivElement;
    summary: HTMLSpanElement;
  } {
    const section = document.createElement('div');
    section.style.marginBottom = '4px';

    const header = document.createElement('div');
    header.style.cursor = 'pointer';
    header.style.fontSize = '12px';
    header.style.fontWeight = 'bold';
    header.style.color = COLOR_ACCENT;
    header.style.padding = '2px 0';
    header.style.userSelect = 'none';

    const arrow = document.createElement('span');
    arrow.setAttribute('data-role', 'arrow');
    arrow.textContent = '\u25BC';
    arrow.style.marginRight = '4px';
    arrow.style.fontSize = '10px';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;

    const summary = document.createElement('span');
    summary.style.fontWeight = 'normal';
    summary.style.fontSize = '11px';
    summary.style.color = '#888';
    summary.style.marginLeft = '6px';

    header.appendChild(arrow);
    header.appendChild(titleSpan);
    header.appendChild(summary);

    const body = document.createElement('div');
    body.style.paddingLeft = '4px';

    section.appendChild(header);
    section.appendChild(body);

    return { section, header, body, summary };
  }

  private createLabel(text: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.style.color = '#888';
    el.textContent = text;
    return el;
  }

  private createSeparator(): HTMLSpanElement {
    const el = document.createElement('span');
    el.style.margin = '0 6px';
    el.style.color = '#555';
    el.textContent = '|';
    return el;
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'bigint') {
      return `${value}n`;
    }
    return String(value);
  }

  // ── Styles ─────────────────────────────────────────────────────────

  private applyRootStyles(): void {
    const s = this.root.style;
    s.position = 'fixed';
    s.top = '8px';
    s.right = '8px';
    s.width = '360px';
    s.backgroundColor = COLOR_BG;
    s.color = COLOR_TEXT;
    s.fontFamily = FONT_MONO;
    s.fontSize = '11px';
    s.zIndex = '99999';
    s.borderRadius = '4px';
    s.border = '1px solid rgba(255,255,255,0.1)';
    s.boxShadow = '0 2px 12px rgba(0,0,0,0.5)';
    s.overflow = 'hidden';
  }

  private applyTitleBarStyles(): void {
    const s = this.titleBar.style;
    s.backgroundColor = 'rgba(30, 30, 40, 0.95)';
    s.padding = '4px 8px';
    s.cursor = 'move';
    s.userSelect = 'none';
    s.display = 'flex';
    s.justifyContent = 'space-between';
    s.alignItems = 'center';
    s.fontSize = '12px';
    s.fontWeight = 'bold';
    s.color = COLOR_ACCENT;
    s.minHeight = '20px';
  }

  private applyToggleBtnStyles(): void {
    const s = this.toggleBtn.style;
    s.cursor = 'pointer';
    s.fontSize = '12px';
    s.color = COLOR_TEXT;
    s.marginLeft = '8px';
  }
}
