/**
 * Simple DOM overlay that shows asset loading progress.
 *
 * Creates its own elements and removes them from the DOM when loading finishes.
 */
export class AssetLoaderUI {
  private readonly container: HTMLElement;
  private readonly progressBar: HTMLElement;
  private readonly statusText: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'asset-loader';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      z-index: 1000;
      font-family: system-ui, -apple-system, Segoe UI, Arial, sans-serif;
      text-align: center;
      padding: 24px;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Loading Assets';
    title.style.cssText = `
      font-size: clamp(1.5rem, 5vw, 2rem);
      margin: 0;
      color: #4ecca3;
    `;

    this.statusText = document.createElement('p');
    this.statusText.textContent = 'Preparing textures…';
    this.statusText.style.cssText = `
      margin: 0;
      color: #ccc;
      font-size: 1rem;
      min-height: 1.5em;
    `;

    const track = document.createElement('div');
    track.style.cssText = `
      width: min(320px, 80vw);
      height: 8px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      overflow: hidden;
    `;

    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = `
      width: 0%;
      height: 100%;
      background: #4ecca3;
      transition: width 0.2s ease-out;
    `;

    track.appendChild(this.progressBar);
    this.container.appendChild(title);
    this.container.appendChild(track);
    this.container.appendChild(this.statusText);
  }

  /**
   * Attach the loader to the document body.
   */
  show(): void {
    if (!document.body.contains(this.container)) {
      document.body.appendChild(this.container);
    }
  }

  /**
   * Update progress display.
   */
  update(loaded: number, total: number): void {
    const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
    this.progressBar.style.width = `${percent}%`;
    this.statusText.textContent = `Loaded ${loaded} of ${total} asset groups (${percent}%)`;
  }

  /**
   * Remove the loader from the DOM.
   */
  hide(): void {
    if (document.body.contains(this.container)) {
      document.body.removeChild(this.container);
    }
  }
}
