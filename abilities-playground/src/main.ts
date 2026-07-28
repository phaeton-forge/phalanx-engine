import { LobbyScene } from './scenes/LobbyScene';
import { Game } from './core/Game.ts';
import { assetManager } from './assets';
import type { PhalanxClient, MatchFoundEvent } from '@phalanx-engine/client';

let game: Game | null = null;

const lobbyScene = new LobbyScene();

// Kick off as soon as the app loads (overlaps with lobby time). Models have
// no placeholder, so a failure here must surface at `await` below.
const assetsReady = assetManager.preloadAll();
// Attach a no-op handler so an early rejection isn't reported as unhandled;
// the real error still propagates through the `await` in the start handler.
assetsReady.catch(() => {});

function returnToLobby(): void {
  if (game) {
    game.dispose();
    game = null;
  }
  lobbyScene.show();
}

lobbyScene.setOnGameStart(
  async (client: PhalanxClient, matchData: MatchFoundEvent) => {
    const canvas = document.getElementById('app') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error("Canvas element with id 'app' not found");
    }

    await assetsReady;

    game = new Game(canvas, client, matchData);
    game.setOnExit(returnToLobby);

    await game.initialize();
  }
);

console.log('[abilities-playground] client initialized');
