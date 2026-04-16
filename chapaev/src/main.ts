import { Game } from './core/Game.ts';
import type { GameMode } from './core/Game.ts';

// Initialize Telegram Mini App SDK if running inside Telegram
const tgWebApp = window.Telegram?.WebApp;
if (tgWebApp) {
  tgWebApp.ready();
  tgWebApp.expand();
  console.log('[Chapayev] Running as Telegram Mini App');
}

const canvas = document.getElementById('app') as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Canvas element with id 'app' not found");
}

// Switch between hot-seat and online via query param: ?mode=hotseat or ?mode=online
// Default is 'online' for Stage 2.
const params = new URLSearchParams(window.location.search);
const rawMode = params.get('mode');
const mode: GameMode = rawMode === 'hotseat' || rawMode === 'online' ? rawMode : 'online';

console.log(`[Chapayev] Starting in ${mode} mode`);

function reportStartupError(error: unknown): void {
  console.error('[Chapayev] Failed to start game', error);
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  const errorElement = document.createElement('div');
  errorElement.setAttribute('role', 'alert');
  errorElement.textContent = `Failed to start game: ${message}`;
  // @ts-ignore
  const mountTarget = canvas.parentElement ?? document.body;
  mountTarget.appendChild(errorElement);
}

const game = new Game(canvas, mode);
void game.start().catch((error: unknown) => {
  reportStartupError(error);
});

// Expose for debugging in devtools
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__game'] = game;
}
