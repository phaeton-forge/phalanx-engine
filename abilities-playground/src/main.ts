import { LobbyScene } from './scenes/LobbyScene';
import { Game } from './core/Game.ts';
import type { PhalanxClient, MatchFoundEvent } from '@phalanx-engine/client';

let game: Game | null = null;

const lobbyScene = new LobbyScene();

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

    game = new Game(canvas, client, matchData);
    game.setOnExit(returnToLobby);

    await game.initialize();
  },
);

console.log('[abilities-playground] client initialized');
