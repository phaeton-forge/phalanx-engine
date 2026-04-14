import {
  UI_BTN_TEXT,
  UI_BTN_BORDER,
} from '../config/constants.ts';

/** LocalStorage key used to remember that the user dismissed the hint. */
const DISMISSED_KEY = 'chapaev-silent-mode-hint-dismissed';

/**
 * Returns `true` on iOS Safari (iPhone / iPad / iPod) where the
 * hardware silent-mode switch can silently mute all web audio.
 */
function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|CriOS|FxiOS).)*safari/i.test(ua);
  return isIOS && isSafari;
}

/**
 * SilentModeHint — a small dismissible toast shown on iOS Safari
 * reminding the user to turn off the hardware silent-mode switch
 * so that game sounds work.
 *
 * The hint is shown once; after the user taps "Got it" the
 * preference is persisted to localStorage and the hint never
 * appears again.
 */
export class SilentModeHint {
  private overlay: HTMLDivElement | null = null;

  /**
   * Show the hint if conditions are met (iOS Safari + not previously dismissed).
   * Safe to call on any platform — does nothing on non-iOS.
   */
  public show(): void {
    if (!isIOSSafari()) return;

    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // localStorage may be unavailable in private mode — show anyway
    }

    this.createOverlay();
  }

  /** Remove the hint from the DOM immediately. */
  public dispose(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────

  private createOverlay(): void {
    const overlay = document.createElement('div');

    Object.assign(overlay.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2000',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 18px',
      background: 'rgba(0, 0, 0, 0.88)',
      color: UI_BTN_TEXT,
      fontSize: '14px',
      fontFamily: 'system-ui, sans-serif',
      borderRadius: '12px',
      border: `1px solid ${UI_BTN_BORDER}`,
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
      maxWidth: '92vw',
      textAlign: 'center',
      lineHeight: '1.4',
      WebkitUserSelect: 'none',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    const text = document.createElement('span');
    text.textContent = '🔇 Turn off Silent Mode on your iPhone to hear game sounds';

    const btn = document.createElement('button');
    btn.textContent = 'Got it';
    Object.assign(btn.style, {
      padding: '6px 14px',
      border: `1px solid ${UI_BTN_BORDER}`,
      borderRadius: '6px',
      background: 'rgba(255, 255, 255, 0.12)',
      color: UI_BTN_TEXT,
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      flexShrink: '0',
    } as Partial<CSSStyleDeclaration>);

    btn.addEventListener('click', () => {
      try {
        localStorage.setItem(DISMISSED_KEY, '1');
      } catch {
        // ignore
      }
      this.dispose();
    });

    overlay.appendChild(text);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);

    this.overlay = overlay;
  }
}

