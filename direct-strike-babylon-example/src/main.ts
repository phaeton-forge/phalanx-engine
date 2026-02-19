import { LobbyScene } from './scenes/LobbyScene';
import { Game } from './core/Game';
import type { PhalanxClient, MatchFoundEvent } from 'phalanx-client';
import './style.css';

/**
 * Application Entry Point
 * Manages lobby and game scene transitions for 1v1 multiplayer
 */

// Current game instance
let game: Game | null = null;

// Initialize lobby scene
const lobbyScene = new LobbyScene();

/**
 * Handle returning to lobby from game
 */
function returnToLobby(): void {
  if (game) {
    game.dispose();
    game = null;
  }
  lobbyScene.show();
}

// Handle game start
lobbyScene.setOnGameStart(
  (client: PhalanxClient, matchData: MatchFoundEvent) => {
    console.warn('Game starting!', matchData);

    const canvas = document.getElementById('app') as HTMLCanvasElement;

    if (!canvas) {
      throw new Error("Canvas element with id 'app' not found");
    }

    // Create and start game with network client
    game = new Game(canvas, client, matchData);
    game.setOnExit(returnToLobby);

    void game.initialize().then(() => {
      game?.start();
    });
  }
);

// Log startup
console.warn('Babylon RTS Demo initialized');
