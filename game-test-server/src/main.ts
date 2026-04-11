/**
 * Game server using Phalanx Engine
 * Configured for Heroku deployment
 */

import 'dotenv/config';
import { Phalanx } from 'phalanx-server';

// Heroku provides PORT as an environment variable
const PORT = parseInt(process.env.PORT || '3000', 10);

// CORS origins - configurable via environment variable
// In production, set CORS_ORIGINS to your client URLs (comma-separated)
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : [
      'http://localhost:3001',
      'http://localhost:5173',
      'http://192.168.31.228:5173',
      'https://energoids.website.yandexcloud.net',
    ];

// Google OAuth configuration for JWT validation and token exchange
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const AUTH_ENABLED = !!GOOGLE_CLIENT_ID;

async function main() {
  console.warn('Starting Phalanx Test Game Server...');
  console.warn(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.warn(`Authentication: ${AUTH_ENABLED ? 'enabled' : 'disabled (no GOOGLE_CLIENT_ID)'}`);
  if (AUTH_ENABLED && !GOOGLE_CLIENT_SECRET) {
    console.warn('Warning: GOOGLE_CLIENT_SECRET not set - token exchange will not work');
  }

  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: CORS_ORIGINS,
      credentials: true,
    },
    tickRate: 20, // 20 ticks per second
    gameMode: '1v1', // 2 players per match
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
    gameTypes: [
      {
        gameType: 'direct-strike',
        tickMode: 'continuous',
        tickRate: 20,
        gameMode: '1v1',
        countdownSeconds: 3,
      },
      {
        gameType: 'chapayev',
        tickMode: 'event',
        gameMode: '1v1',
        countdownSeconds: 3,
        turnTimeoutMs: 90000,
      },
    ],
    // Pause configuration
    pause: {
      maxPausesPerPlayer: 3,
      requireSamePlayerToResume: true,
    },
    // Authentication configuration
    auth: AUTH_ENABLED
      ? {
          enabled: true,
          google: {
            clientId: GOOGLE_CLIENT_ID!,
            clientSecret: GOOGLE_CLIENT_SECRET,
          },
          // Allow unauthenticated connections in development
          allowAnonymous: process.env.NODE_ENV !== 'production',
        }
      : undefined,
  });

  // Event handlers
  phalanx.on('match-created', (match) => {
    console.warn(`Match created: ${match.id}`);
  });

  phalanx.on('match-started', (match) => {
    console.warn(`Match started: ${match.id}`);
  });

  phalanx.on('match-ended', (matchId: string, reason: string) => {
    console.warn(`Match ended: ${matchId}, reason: ${reason}`);
  });

  phalanx.on('player-command', (playerId: string, command: unknown) => {
    // Validate commands if needed
    console.warn(`Command from ${playerId}:`, command);
    return true; // Accept command
  });

  phalanx.on('player-disconnected', (playerId: string, matchId: string) => {
    console.warn(`Player ${playerId} disconnected from match ${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId: string, matchId: string) => {
    console.warn(`Player ${playerId} reconnected to match ${matchId}`);
  });

  try {
    await phalanx.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    console.warn('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.warn('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });
}

void main();
