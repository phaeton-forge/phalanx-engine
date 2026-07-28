/**
 * Indeterminate spinner shown while the AssetManager finishes downloading
 * models (and any future manifest assets).
 */
export class LoaderOverlay {
  private readonly container: HTMLDivElement;
  private visible = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'loader-overlay';
    this.container.setAttribute('role', 'status');
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-label', 'Loading assets');

    const spinner = document.createElement('div');
    spinner.className = 'loader-spinner';

    const label = document.createElement('div');
    label.className = 'loader-label';
    label.textContent = 'Loading assets…';

    this.container.appendChild(spinner);
    this.container.appendChild(label);
    document.body.appendChild(this.container);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.container.classList.add('loader-overlay--visible');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.container.classList.remove('loader-overlay--visible');
  }

  dispose(): void {
    this.container.remove();
  }
}
