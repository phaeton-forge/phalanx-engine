import { LobbyScene } from './scenes/LobbyScene';
import { PreviewGame } from './core/PreviewGame';
import type { PhalanxClient, MatchFoundEvent } from 'phalanx-client';

let game: PreviewGame | null = null;

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

    game = new PreviewGame(canvas, client, matchData);
    game.setOnExit(returnToLobby);

    await game.initialize();
  },
);

console.log('[abilities-playground] client initialized');
