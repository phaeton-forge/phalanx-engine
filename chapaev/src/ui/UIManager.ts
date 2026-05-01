/**
 * UIManager — manages UI screen transitions and HUD updates.
 *
 * All UI is HTML overlay on top of the Three.js canvas.
 */

import './styles/ui.css';

export type Screen =
  | 'main-menu'
  | 'auth'
  | 'matchmaking'
  | 'countdown'
  | 'countdown-local'
  | 'private-match'
  | 'local-game-mode'
  | 'game'
  | 'match-result'
  | 'profile'
  | 'pause'
  | 'settings'
  | 'rules';

type ScreenRenderFn = (container: HTMLDivElement) => void;

export class UIManager {
  private currentScreen: Screen = 'main-menu';
  private readonly container: HTMLDivElement;
  private readonly screenElements = new Map<string, HTMLDivElement>();
  private readonly screenRenderers = new Map<Screen, ScreenRenderFn>();

  constructor() {
    const existing = document.getElementById('ui-root');
    if (existing instanceof HTMLDivElement) {
      this.container = existing;
    } else {
      this.container = document.createElement('div');
      this.container.id = 'ui-root';
      document.body.appendChild(this.container);
    }
  }

  /** Register a render function for a screen */
  public registerScreen(screen: Screen, renderer: ScreenRenderFn): void {
    this.screenRenderers.set(screen, renderer);
  }

  /** Show a screen with enter animation */
  public showScreen(screen: Screen): void {
    // Hide current if different
    if (this.currentScreen !== screen) {
      this.hideCurrentScreen();
    }

    this.currentScreen = screen;

    let el = this.screenElements.get(screen);

    if (!el) {
      el = document.createElement('div');
      el.dataset['screen'] = screen;
      const renderer = this.screenRenderers.get(screen);
      if (renderer) {
        renderer(el);
      }
      this.container.appendChild(el);
      this.screenElements.set(screen, el);
    }

    this.revealElement(el);
  }

  /** Show a screen as an overlay without hiding the current screen */
  public showOverlay(screen: Screen): void {
    let el = this.screenElements.get(screen);

    if (!el) {
      el = document.createElement('div');
      el.dataset['screen'] = screen;
      const renderer = this.screenRenderers.get(screen);
      if (renderer) {
        renderer(el);
      }
      this.container.appendChild(el);
      this.screenElements.set(screen, el);
    }

    this.revealElement(el);
  }

  /** Hide a specific screen with exit animation */
  public hideScreen(screen: Screen): void {
    const el = this.screenElements.get(screen);
    if (!el) return;
    // Idempotent: skip if already hidden or already in the process of hiding.
    // Also avoids stacking up `animationend` listeners (which would fire on
    // the next `panel-in` and re-hide a freshly shown panel).
    if (el.style.display === 'none' || el.dataset['hiding'] === '1') return;

    el.classList.remove('panel-enter');
    el.classList.add('panel-exit');
    el.dataset['hiding'] = '1';

    const onEnd = (): void => {
      el.removeEventListener('animationend', onEnd);
      // `showScreen()` may have revealed the panel before this listener fired.
      // The reveal clears `dataset.hiding`, which signals us to bail out so we
      // don't re-hide the just-shown element.
      if (el.dataset['hiding'] !== '1') return;
      delete el.dataset['hiding'];
      el.style.display = 'none';
      el.classList.remove('panel-exit');
    };
    el.addEventListener('animationend', onEnd);
  }

  /** Apply the show/enter animation and cancel any pending hide. */
  private revealElement(el: HTMLDivElement): void {
    delete el.dataset['hiding'];
    el.style.display = '';
    el.classList.remove('panel-exit');
    el.classList.add('panel-enter');
  }

  /** Hide current screen */
  private hideCurrentScreen(): void {
    this.hideScreen(this.currentScreen);
  }

  /** Remove and re-render a specific screen */
  public refreshScreen(screen: Screen): void {
    const el = this.screenElements.get(screen);
    if (el) {
      el.remove();
      this.screenElements.delete(screen);
    }
    if (this.currentScreen === screen) {
      this.showScreen(screen);
    }
  }

  /** Destroy a specific screen element (remove from DOM) */
  public destroyScreen(screen: Screen): void {
    const el = this.screenElements.get(screen);
    if (el) {
      el.remove();
      this.screenElements.delete(screen);
    }
  }

  /** Get current active screen */
  public getCurrentScreen(): Screen {
    return this.currentScreen;
  }

  /** Get the UI root container */
  public getContainer(): HTMLDivElement {
    return this.container;
  }

  /** Get or create a screen element */
  public getScreenElement(screen: Screen): HTMLDivElement | undefined {
    return this.screenElements.get(screen);
  }

  /** Dispose all screens */
  public dispose(): void {
    for (const [, el] of this.screenElements) {
      el.remove();
    }
    this.screenElements.clear();
    this.screenRenderers.clear();
  }
}
