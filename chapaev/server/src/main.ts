/**
 * Chapayev game server using Phalanx Engine
 *
 * Minimal server: matchmaking, tick clock, command relay, desync detection.
 * No game logic — all simulation runs on clients (lockstep).
 */

import { Phalanx } from 'phalanx-server';

const PORT = parseInt(process.env.PORT || '3000', 10);

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:5174', 'http://localhost:5173'];

async function main() {
  console.log('Starting Chapayev server...');

  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: CORS_ORIGINS,
      credentials: true,
    },
    tickRate: 20,
    gameMode: '1v1',
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
    timeoutTicks: 60,
    disconnectTicks: 200,
    reconnectGracePeriodMs: 30000,
    readyTimeoutMs: 15000,
    enableStateHashing: true,
    stateHashInterval: 60,
    desync: {
      enabled: true,
      action: 'log-only',
      gracePeriodTicks: 3,
    },
  });

  // TODO (Stage 3): Add server-side command validation via phalanx.on('player-command')
  // to reject invalid command types, malformed payloads, and commands targeting wrong team.
  // See: PhalanxEventHandlers['player-command'] — return false to reject a command.

  phalanx.on('match-created', (match) => {
    console.log(`Match created: ${match.id}`);
  });

  phalanx.on('match-started', (match) => {
    console.log(`Match started: ${match.id}`);
  });

  phalanx.on('match-ended', (matchId: string, reason: string) => {
    console.log(`Match ended: ${matchId}, reason: ${reason}`);
  });

  phalanx.on('player-disconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} disconnected from ${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} reconnected to ${matchId}`);
  });

  phalanx.on('desync-detected', (matchId: string, tick: number, hashes: Record<string, string>) => {
    console.warn(`Desync detected in ${matchId} at tick ${tick}:`, hashes);
  });

  try {
    await phalanx.start();
    console.log(`Chapayev server running on port ${PORT}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });
}

void main();
