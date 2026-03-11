---
name: phalanx-server
description: Create and configure a Phalanx Engine multiplayer game server. Use when the user wants to set up a deterministic lockstep multiplayer server using phalanx-server, configure matchmaking, tick rate, TLS, authentication, desync detection, pause/resume, or deploy a Phalanx server to production.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx Server Skill

## When to Use This Skill

Use this skill when the user asks to:

- Create a new Phalanx multiplayer game server
- Configure server options (tick rate, game mode, TLS, CORS, auth, desync detection, pause)
- Set up matchmaking for a multiplayer game
- Deploy a Phalanx server to production (Heroku, VPS, etc.)
- Add server-side event hooks (match-created, player-command, etc.)
- Troubleshoot server configuration or connection issues

## Prerequisites

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)
- The `phalanx-engine` repository cloned locally (packages are not yet on npm)

## Repository Structure

```
phalanx-engine/
├── phalanx-server/    ← Server library
├── phalanx-client/    ← Client library
├── phalanx-ecs/       ← ECS library
├── phalanx-math/      ← Fixed-point math
└── game-test-server/  ← Reference server implementation
```

## Step-by-Step Instructions

### 1. Create a New Server Project

Create a new directory for the game server inside the monorepo or as a standalone project:

```bash
mkdir my-game-server
cd my-game-server
pnpm init
pnpm add typescript tsx dotenv
```

If inside the monorepo, add a reference to `phalanx-server` in your `package.json`:

```json
{
  "dependencies": {
    "phalanx-server": "workspace:*"
  }
}
```

If standalone (once published to npm):

```bash
pnpm add phalanx-server
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### 2. Create the Server Entry Point

Create `src/main.ts`:

```typescript
import 'dotenv/config';
import { Phalanx } from 'phalanx-server';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  const phalanx = new Phalanx({
    port: PORT,
    tickRate: 20,
    gameMode: '1v1',
    cors: { origin: '*' },
  });

  // Register event hooks
  phalanx.on('match-created', (match) => {
    console.log(`Match created: ${match.id}`);
  });

  phalanx.on('match-started', (match) => {
    console.log(`Match started: ${match.id}`);
  });

  phalanx.on('match-ended', (matchId, reason) => {
    console.log(`Match ended: ${matchId}, reason: ${reason}`);
  });

  phalanx.on('player-disconnected', (playerId, matchId) => {
    console.log(`Player ${playerId} disconnected from match ${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId, matchId) => {
    console.log(`Player ${playerId} reconnected to match ${matchId}`);
  });

  await phalanx.start();
  console.log(`Phalanx server running on port ${PORT}`);

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    void phalanx.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
```

### 3. Configuration Reference

The `Phalanx` constructor accepts a `Partial<PhalanxConfig>` object. All fields have sensible defaults.

#### Full Configuration Interface

```typescript
interface PhalanxConfig {
  // === Server ===
  port: number;                    // Default: 3000
  cors: CorsConfig;                // Default: { origin: '*' }

  // === TLS/SSL (optional) ===
  tls?: TlsConfig;

  // === Authentication (optional) ===
  auth?: AuthConfig;

  // === Tick System ===
  tickRate: number;                // Default: 20 (ticks per second)
  tickDeadlineMs: number;          // Default: 50 (max wait for commands per tick)

  // === Matchmaking ===
  gameMode: GameMode;              // Default: '1v1'
  matchmakingIntervalMs: number;   // Default: 1000
  countdownSeconds: number;        // Default: 5

  // === Timeouts ===
  timeoutTicks: number;            // Default: 40 (ticks before "lagging" warning)
  disconnectTicks: number;         // Default: 100 (ticks before disconnect)
  reconnectGracePeriodMs: number;  // Default: 30000

  // === Command Validation ===
  maxTickBehind: number;           // Default: 10
  maxTickAhead: number;            // Default: 5
  commandHistoryTicks: number;     // Default: 200

  // === Determinism Features ===
  validateInputSequence?: boolean; // Default: false
  enableStateHashing?: boolean;    // Default: false
  stateHashInterval?: number;      // Default: 60

  // === Desync Detection ===
  desync?: Partial<DesyncConfig>;

  // === Pause/Resume ===
  pause?: Partial<PauseConfig>;
}
```

#### Game Modes

Available presets:

| Preset   | Players | Teams | Description     |
| -------- | ------- | ----- | --------------- |
| `'1v1'`  | 2       | 2     | Duel            |
| `'2v2'`  | 4       | 2     | 2 vs 2          |
| `'3v3'`  | 6       | 2     | 3 vs 3          |
| `'4v4'`  | 8       | 2     | 4 vs 4          |
| `'FFA4'` | 4       | 4     | Free For All    |

Custom game modes:

```typescript
gameMode: { playersPerMatch: 6, teamsCount: 3 }  // 2v2v2
```

#### TLS Configuration

For production with HTTPS/WSS:

```typescript
const phalanx = new Phalanx({
  port: 443,
  tls: {
    enabled: true,
    keyPath: '/etc/letsencrypt/live/game.example.com/privkey.pem',
    certPath: '/etc/letsencrypt/live/game.example.com/fullchain.pem',
    caPath: '/etc/letsencrypt/live/game.example.com/chain.pem', // optional
  },
});
```

#### Authentication Configuration

```typescript
const phalanx = new Phalanx({
  auth: {
    enabled: true,
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,  // for token exchange
    },
    allowAnonymous: process.env.NODE_ENV !== 'production',
    cacheTokens: true,
    cacheTtlMs: 300000,  // 5 minutes
  },
});
```

When auth is enabled, the server exposes a `POST /auth/token` endpoint for OAuth code exchange.

#### Desync Detection Configuration

```typescript
const phalanx = new Phalanx({
  enableStateHashing: true,
  stateHashInterval: 60,    // check every 60 ticks (3s at 20 TPS)
  desync: {
    enabled: true,
    action: 'end-match',     // 'log-only' for development, 'end-match' for production
    gracePeriodTicks: 1,     // consecutive desyncs before action
  },
});
```

#### Pause/Resume Configuration

```typescript
const phalanx = new Phalanx({
  pause: {
    maxPausesPerPlayer: 3,
    requireSamePlayerToResume: true,
  },
});
```

### 4. Server Event Hooks

Register handlers for server-side events:

```typescript
// Match lifecycle
phalanx.on('match-created', (match: MatchInfo) => { });
phalanx.on('match-started', (match: MatchInfo) => { });
phalanx.on('match-ended', (matchId: string, reason: string) => { });
phalanx.on('match-paused', (matchId: string, requestedBy: string) => { });
phalanx.on('match-resumed', (matchId: string, requestedBy: string) => { });

// Player events
phalanx.on('player-command', (playerId: string, command: PlayerCommand) => {
  // Return false to reject the command
  return true;
});
phalanx.on('player-timeout', (playerId: string, matchId: string) => { });
phalanx.on('player-disconnected', (playerId: string, matchId: string) => { });
phalanx.on('player-reconnected', (playerId: string, matchId: string) => { });

// Desync
phalanx.on('desync-detected', (matchId: string, tick: number, hashes: Record<string, string>) => { });
```

### 5. Runtime API

```typescript
// Get all active matches
const matches: MatchInfo[] = phalanx.getActiveMatches();

// Get matchmaking queue size
const queueSize: number = phalanx.getQueueSize();

// Get current config
const config: PhalanxConfig = phalanx.getConfig();

// Stop the server
await phalanx.stop();
```

### 6. Client ↔ Server Socket Events Reference

| Event                 | Direction        | Description                       |
| --------------------- | ---------------- | --------------------------------- |
| `queue-join`          | Client → Server  | Join matchmaking queue            |
| `queue-leave`         | Client → Server  | Leave matchmaking queue           |
| `queue-status`        | Server → Client  | Queue join/leave confirmation     |
| `match-found`         | Server → Client  | Match created, countdown starting |
| `game-start`          | Server → Client  | Match gameplay begins             |
| `match-end`           | Server → Client  | Match has ended                   |
| `submit-commands`     | Client → Server  | Send game commands for a tick     |
| `submit-commands-ack` | Server → Client  | Command acknowledgment            |
| `commands-batch`      | Server → Client  | All commands for a tick           |
| `tick-sync`           | Server → Client  | Periodic tick synchronization     |
| `countdown`           | Server → Client  | Countdown before game starts      |
| `reconnect-match`     | Client → Server  | Attempt to rejoin a match         |
| `reconnect-status`    | Server → Client  | Reconnection result               |
| `reconnect-state`     | Server → Client  | Game state for reconnection       |
| `state-hash`          | Client → Server  | Submit state hash for desync check|
| `pause-game`          | Client → Server  | Request game pause                |
| `resume-game`         | Client → Server  | Request game resume               |

### 7. Production Deployment

#### Environment Variables

Create a `.env` file:

```bash
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://mygame.com,https://www.mygame.com
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

#### CORS for Production

```typescript
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173'];

const phalanx = new Phalanx({
  cors: {
    origin: CORS_ORIGINS,
    credentials: true,
  },
});
```

#### Run Script

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  }
}
```

### 8. Health Check

The server automatically exposes `GET /` and `GET /health` endpoints:

```json
{
  "status": "ok",
  "timestamp": "2026-03-10T15:00:00.000Z",
  "tls": false
}
```

## Common Patterns

### Minimal Development Server

```typescript
const phalanx = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameMode: '1v1',
});
await phalanx.start();
```

### Production Server with All Features

```typescript
const phalanx = new Phalanx({
  port: parseInt(process.env.PORT || '443', 10),
  cors: { origin: ['https://mygame.com'], credentials: true },
  tls: {
    enabled: true,
    keyPath: '/path/to/privkey.pem',
    certPath: '/path/to/fullchain.pem',
  },
  auth: {
    enabled: true,
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
  tickRate: 20,
  gameMode: '3v3',
  countdownSeconds: 5,
  enableStateHashing: true,
  desync: { enabled: true, action: 'end-match', gracePeriodTicks: 1 },
  pause: { maxPausesPerPlayer: 3, requireSamePlayerToResume: true },
});

phalanx.on('match-created', (match) => console.log(`Match: ${match.id}`));
phalanx.on('match-ended', (id, reason) => console.log(`Ended: ${id} - ${reason}`));
phalanx.on('desync-detected', (matchId, tick, hashes) => {
  console.error(`Desync in ${matchId} at tick ${tick}`, hashes);
});

await phalanx.start();
```

## Exports from phalanx-server

```typescript
// Main class
import { Phalanx } from 'phalanx-server';

// Auth utilities
import { TokenValidatorService, createDevValidator, createEndpointValidator } from 'phalanx-server';

// Math utilities (re-exported from phalanx-math)
import { DeterministicRandom, FP, FPVector2, FPVector3, FixedPoint } from 'phalanx-server';

// Game mode presets
import { GAME_MODES } from 'phalanx-server';

// Types
import type {
  PhalanxConfig, PlayerCommand, MatchInfo, MatchFoundEvent,
  GameStartEvent, TickSyncEvent, CommandsBatchEvent, AuthConfig,
  DesyncConfig, PauseConfig, PhalanxEventType, PhalanxEventHandlers,
} from 'phalanx-server';
```

## Troubleshooting

| Issue | Solution |
| --- | --- |
| `EADDRINUSE` | Another process is using the port. Use a different port or kill the process. |
| `Failed to load TLS certificates` | Check that the keyPath and certPath are correct and the files are readable. |
| Clients cannot connect | Check CORS configuration. Ensure the client's origin is in the allowed list. |
| Players timing out | Increase `timeoutTicks` and `disconnectTicks`. Check network latency. |
| Commands rejected | Check `maxTickBehind` / `maxTickAhead` values. Client may be too far out of sync. |
