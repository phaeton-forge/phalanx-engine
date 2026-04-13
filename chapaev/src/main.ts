import { Game } from './core/Game.ts';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Canvas element with id 'app' not found");
}

const game = new Game(canvas);
game.start();

// Expose for debugging in devtools
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__game'] = game;
}


