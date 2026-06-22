import { Phalanx } from 'phalanx-server';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

async function main(): Promise<void> {
  console.log(`[abilities-playground] Starting Phalanx server on port ${PORT}...`);

  const phalanx = new Phalanx({
    port: PORT,
    tickRate: 20,
    gameMode: '1v1',
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
    cors: {
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
      ],
      credentials: true,
    },
  });

  phalanx.on('match-created', (match) => {
    console.log(`[match-created] ${match.id} players=${match.players.length}`);
  });

  phalanx.on('match-started', (match) => {
    console.log(`[match-started] ${match.id} tick=${match.currentTick}`);
  });

  phalanx.on('match-ended', (matchId, reason) => {
    console.log(`[match-ended] ${matchId} reason=${reason}`);
  });

  phalanx.on('player-disconnected', (playerId, matchId) => {
    console.log(`[player-disconnected] player=${playerId} match=${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId, matchId) => {
    console.log(`[player-reconnected] player=${playerId} match=${matchId}`);
  });

  phalanx.on('player-command', () => true);

  try {
    await phalanx.start();
    console.log(`[abilities-playground] Listening on http://localhost:${PORT}`);
  } catch (error) {
    console.error('[abilities-playground] Failed to start server:', error);
    process.exit(1);
  }

  const shutdown = (): void => {
    console.log('\n[abilities-playground] Shutting down...');
    void phalanx.stop().then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
