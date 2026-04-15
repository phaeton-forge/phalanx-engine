import { Game } from './core/Game.ts';
import type { GameMode } from './core/Game.ts';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Canvas element with id 'app' not found");
}

// Switch between hot-seat and online via query param: ?mode=hotseat or ?mode=online
// Default is 'online' for Stage 2.
const params = new URLSearchParams(window.location.search);
const mode: GameMode = (params.get('mode') as GameMode) || 'online';

console.log(`[Chapayev] Starting in ${mode} mode`);

const game = new Game(canvas, mode);
void game.start();

// Expose for debugging in devtools
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__game'] = game;
}
