import './style.css';
import { LobbyScene } from './scenes/LobbyScene';
import { Game } from './core/Game';
import type { MatchFoundEvent, PhalanxClient } from 'phalanx-client';

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
  (client: PhalanxClient, matchData: MatchFoundEvent) => {
    const canvas = document.getElementById('app') as HTMLCanvasElement;
    game = new Game(canvas, client, matchData);
    game.setOnExit(returnToLobby);
    game.initialize();
    client.sendReady();
  }
);
