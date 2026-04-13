import {
  UI_BTN_AIM_BG,
  UI_BTN_CAM_BG,
  UI_BTN_TEXT,
  UI_BTN_BORDER,
  UI_BTN_FOCUS,
} from '../config/constants.ts';

/**
 * Interaction mode — determines whether pointer events drive
 * the orbit-camera or the flick-aiming system.
 */
export type InteractionMode = 'aim' | 'camera';

/** Callback signature for mode-change listeners. */
export type ModeChangeListener = (mode: InteractionMode) => void;

/**
 * ModeToggle — tiny DOM overlay button that lets the player switch
 * between "Aim" and "Camera" interaction modes.
 *
 * Styled with colours drawn from the game's existing palette
 * (see `constants.ts` – `UI_BTN_*`).
 */
export class ModeToggle {
  private readonly button: HTMLButtonElement;
  private mode: InteractionMode;
  private readonly listeners: ModeChangeListener[] = [];

  constructor(initialMode: InteractionMode = 'aim') {
    this.mode = initialMode;

    // ── Create the <button> ───────────────────────────────────────
    this.button = document.createElement('button');
    this.button.id = 'mode-toggle';

    // Inline styles — keeps us dependency-free and out of any CSS build
    Object.assign(this.button.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '1000',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 14px',
      border: `2px solid ${UI_BTN_BORDER}`,
      borderRadius: '8px',
      color: UI_BTN_TEXT,
      fontSize: '14px',
      fontFamily: 'system-ui, sans-serif',
      fontWeight: '600',
      cursor: 'pointer',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      outline: 'none',
      transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    } as Partial<CSSStyleDeclaration>);

    // Focus / hover ring
    this.button.addEventListener('pointerenter', () => {
      this.button.style.borderColor = UI_BTN_FOCUS;
      this.button.style.boxShadow = `0 0 0 3px ${UI_BTN_FOCUS}44, 0 2px 8px rgba(0,0,0,0.35)`;
    });
    this.button.addEventListener('pointerleave', () => {
      this.button.style.borderColor = UI_BTN_BORDER;
      this.button.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
    });

    this.button.addEventListener('click', () => this.toggle());

    this.applyVisuals();
    document.body.appendChild(this.button);
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Current interaction mode. */
  public get currentMode(): InteractionMode {
    return this.mode;
  }

  /** Register a listener called whenever the mode changes. */
  public onChange(listener: ModeChangeListener): void {
    this.listeners.push(listener);
  }

  /** Programmatically switch to the given mode. */
  public setMode(mode: InteractionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyVisuals();
    this.notifyListeners();
  }

  /** Toggle between aim ↔ camera. */
  public toggle(): void {
    this.setMode(this.mode === 'aim' ? 'camera' : 'aim');
  }

  /** Remove the button from the DOM. */
  public dispose(): void {
    this.button.remove();
    this.listeners.length = 0;
  }

  // ── Internals ──────────────────────────────────────────────────

  private applyVisuals(): void {
    if (this.mode === 'aim') {
      this.button.textContent = '🎯 Aim';
      this.button.style.background = UI_BTN_AIM_BG;
    } else {
      this.button.textContent = '📷 Camera';
      this.button.style.background = UI_BTN_CAM_BG;
    }
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      fn(this.mode);
    }
  }
}

