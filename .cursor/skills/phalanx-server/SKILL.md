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

- Node.js 24.x (`>=24.0.0 <25.0.0`, as declared in the workspace `engines` field)
- pnpm (install with `npm install -g pnpm`)
- The `phalanx-engine` repository cloned locally (packages are not yet on npm)

## Repository Structure

```
phalanx-engine/
├── phalanx-server/    ← Server library (this skill)
├── phalanx-client/    ← Client library
├── phalanx-ecs/       ← ECS library (renderer-agnostic, GameWorld facade)
├── phalanx-physics/   ← Deterministic FP physics (spatial hash, collisions)
├── phalanx-math/      ← Fixed-point math
└── chapaev/server/    ← Example game server implementation
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
    "@phalanx-engine/server": "workspace:*"
  }
}
```

If standalone (once published to npm):

```bash
pnpm add @phalanx-engine/server
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
import { Phalanx } from '@phalanx-engine/server';

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
  commandHistoryTicks: number | 'full'; // Default: 200. 'full' keeps every non-empty tick
  requireBuildId?: boolean;        // Default: false. Mismatch → match-error before start
  shutdownGraceMs?: number;        // Default: 0. Wait after server-shutdown before stop(), then again for archive hooks
  handleSignals?: boolean;         // Default: false. true → SIGTERM calls shutdown('sigterm')
  onMatchArchived?: (rec: MatchArchive) => void | Promise<void>; // Default: omitted. Once per started match; engine stores nothing
  session?: { secret: string; ttlMs?: number }; // Opt-in HMAC token. secret ≥ 32 chars. ttlMs default 60 min
  reconnect?: { requireSessionToken?: boolean }; // Default false. true rejects legacy rebind into a live match

  // === Determinism Features ===
  validateInputSequence?: boolean; // Default: false
  enableStateHashing?: boolean;    // Default: false
  stateHashInterval?: number;      // Default: 60

  // === Ready Handshake ===
  readyTimeoutMs?: number;         // Default: 30000 (30s for clients to call sendReady)

  // === Desync Detection ===
  desync?: Partial<DesyncConfig>;

  // === Pause/Resume ===
  pause?: Partial<PauseConfig>;
}
```

`session` issues `session-token { token, matchId, slot }` at `match-found` (right after the personal payload, and again at `game-start`). `exp` is that issue time plus `ttlMs`; the `game-start` token and a rebind extend it. `handleReconnect` sends one after `reconnect-state` with no `gameStartEmitted` gate, including during countdown. A token is bound to that `matchId` and `playerId` and cannot join another match. A match that ends before start (`ready-timeout`, `players-not-connected`, or `stop` during countdown) is tombstoned, so resume answers `match-ended`. `slot` is the index in `teams.flat()`. The token is HMAC-signed, not encrypted, so the payload is readable. Never log the token or `session.secret`. `match-resume { token, buildId?, haveTick }` verifies the HMAC, then the 10-minute ended-match tombstone, then `buildId`, then rebinds with `handleReconnect` using the player id from the token. The previous socket leaves the room, loses `matchId` / `playerId`, and receives `session-superseded`. `player-command` and `submit-commands` require `isParticipantSocket` even if the old socket still has `matchId`. `match-resume-state` follows `reconnect-state` and may include `absentDeadline` (milliseconds until the soonest *other* absence). `reconnect.requireSessionToken` rejects `reconnect-match` and `room-recover` after `waiting-for-players` (`room-error` `message` and `reason` are both `'session-token-required'`). Recover during `waiting-for-players` stays open so a player who missed `match-found` gets the token. The flag throws at startup without `session.secret`. Omit `session` and today's rebind behaviour is unchanged.

`commandHistoryTicks: 'full'` stores only non-empty ticks for the whole match. `match-log` replies with `match-log-chunk` events of at most 2000 ticks, only to the requesting member socket. A new `match-log` or `match-log-cancel` stops the previous stream on that socket. Optional `requestId` is echoed on chunks and errors. `Phalanx.shutdown(reason)` emits `server-shutdown` to every active room, waits `shutdownGraceMs`, then calls `stop()`, then waits for `onMatchArchived` hooks up to `shutdownGraceMs` again. Set `handleSignals: true` to bind that to `SIGTERM`. The engine never calls `process.exit`. With `requireBuildId`, a missing or differing `buildId` emits `match-error` (`build-mismatch`) and removes the match before `match-found`. `GameRoom.getBuildId()` returns the first non-empty id in team order.

`onMatchArchived` is opt-in. It runs once after a match that reached `startGame()` ends, with a `MatchArchive` (seed, optional `buildId`, teams, end reason, optional `winnerTeamId`, and the command log). It does not run for `build-mismatch`, `players-not-connected`, `ready-timeout`, or a stop during countdown or waiting-for-ready. The log arrays are not copied; do heavy work asynchronously. Without the hook the log is released at match end and nothing is stored. A throw or a rejected promise is logged and does not stop other matches. With `shutdownGraceMs` of 0 or unset, shutdown does not await async hooks. An in-flight `match-log` ends with `match-log-error` `not-found` when the history is released.

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

#### Absence while `playing` (opt-in)

Omit `absence` and a disconnected player never loses the match. Pass
`DEFAULT_ABSENCE` (`windowMs` 120000, `matchBudgetMs` 180000) or your own
positive integers. The deadline is `min(windowMs, budgetLeft)`. The timer
starts only in `playing` (socket drop, or `disconnectTicks` in continuous
mode). It does not start on a disconnect while `paused`. `resume()` starts
one for each player who is still disconnected, cut by the remaining budget.
A timer that already started keeps running through a pause. Event mode
(`tickMode: 'event'`) does not run `checkPlayerTimeouts`, so only a socket
drop starts the timer.

`player-absent` is `{ playerId, deadlineMs, budgetLeftMs }`. Both numbers
are milliseconds left at send time; the client counts down from receipt.
`getAbsences()` uses the same semantics. Return goes through
`handleReconnect`. With `absence` enabled, the first message on the
still-bound socket after a `disconnectTicks` timeout is also a return.
A message during `paused` stops a timer that is already running.

Expiry calls `endMatch`. Every human absent → `{ reason: 'abandoned' }`
with no winner. Otherwise `{ reason: 'disconnect', loserIds }` and
`winnerTeamId` when exactly one team contains no loser (omitted for FFA
when several teams remain).

```typescript
import { DEFAULT_ABSENCE } from '@phalanx-engine/server';

const phalanx = new Phalanx({
  absence: DEFAULT_ABSENCE,
});

phalanx.on('player-command', (_playerId, command, ctx) => {
  if (command.type === 'destroy-base') {
    // Returns false when the match was already finished.
    ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
  }
});
```

`ctx.endMatch` returns false when the match is already finished, and when
`winnerTeamId` is not a team in the match (a warning is logged and the
match stays `playing`). The command that ended the match is not written
to the log and not broadcast. Handlers with two parameters stay valid.

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
phalanx.on('player-command', (playerId: string, command: PlayerCommand, ctx) => {
  // Return false to reject the command. ctx.endMatch finishes the match
  // and drops this command. Two-argument handlers still work.
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

#### Key Types

```typescript
// Match information returned by getActiveMatches() and event hooks
interface MatchInfo {
  id: string;
  players: PlayerInfo[];
  currentTick: number;
  state: 'countdown' | 'waiting-for-ready' | 'playing' | 'paused' | 'finished';
  createdAt: Date;
}

// Player information within a match
interface PlayerInfo {
  id: string;
  teamId: number;
  connected: boolean;
  lastTick: number;
}
```

### 6. Client ↔ Server Socket Events Reference

| Event                 | Direction        | Description                       |
| --------------------- | ---------------- | --------------------------------- |
| `queue-join`          | Client → Server  | Join matchmaking queue            |
| `queue-leave`         | Client → Server  | Leave matchmaking queue           |
| `queue-status`        | Server → Client  | Queue join/leave confirmation     |
| `match-found`         | Server → Client  | Match created, countdown starting |
| `game-start`          | Server → Client  | Countdown finished, load assets   |
| `client-ready`        | Client → Server  | Client finished loading, ready for ticks |
| `player-ready`        | Server → Client  | A player reported ready           |
| `match-end`           | Server → Client  | Match has ended (`reason`, optional `winnerTeamId`) |
| `player-absent`       | Server → Client  | Opt-in absence timer (`deadlineMs`, `budgetLeftMs`) |
| `submit-commands`     | Client → Server  | Send game commands for a tick     |
| `submit-commands-ack` | Server → Client  | Command acknowledgment            |
| `commands-batch`      | Server → Client  | All commands for a tick           |
| `tick-sync`           | Server → Client  | Periodic tick synchronization     |
| `countdown`           | Server → Client  | Countdown before game starts      |
| `reconnect-match`     | Client → Server  | Attempt to rejoin a match         |
| `reconnect-status`    | Server → Client  | Reconnection result               |
| `reconnect-state`     | Server → Client  | Game state for reconnection       |
| `session-token`       | Server → Client  | `{ token, matchId, slot }` at match-found, game-start (extends `exp`), and after reconnect-state |
| `session-superseded`  | Server → Client  | `{ matchId }` when this socket is replaced |
| `match-resume`        | Client → Server  | `{ token, buildId?, haveTick }`   |
| `match-resume-state`  | Server → Client  | Resume accepted, after reconnect-state |
| `match-resume-error`  | Server → Client  | `invalid`, `expired`, `match-ended`, `build-mismatch` |
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

## Server simulation (Task 11)

Omit `sim` and the server stays a relay: no worker is spawned. To simulate, pass `sim: createServerSim({ games })` from `@phalanx-engine/runtime/server` (re-exported by `@phalanx-engine/game/server`):

```ts
new Phalanx({
  sim: createServerSim({ games: [{ module: './myGame.js' }] }),
});
```

- `games: [{ module, export?, configKeys? }]` (a worker imports the module; an `inProcess` host may also take a `GameDefinition` object). `configKeys` is the allow-list of integer `matchConfig` fields copied into the runner config. `GameModuleSpec` and `ServerSimConfig` are exports of the runtime `./server` subpath, not of this package.
- Host options on `createServerSim`: `{ mode?: 'worker' | 'inProcess'; workers?: 1; resourceLimits?; snapshotEveryTicks?; maxMatches? }`. Default mode is `worker`. `workers` is reserved until Task 17; only `1` is accepted.
- `room-create` may include `matchConfig: { gameId, simMode: 'server', slots, inputDelayTicks?, absencePolicy? }` plus integer fields named in that game's `configKeys`. Other extras are rejected. Omitted `matchConfig` keeps the two-human room. `maxMatches` is reserved at create, including a waiting room, and released on cancel, expiry, or match end.
- The relay stamps. Player ids `system` and `bot:<slot>` are rejected on `queue-join`, `room-create`, `room-join`, `room-recover`, and on human slots. A client command is stamped with the socket id; `RoomSim` is the only producer of `system` commands. Server bots appear as `bot:<slot>` and target `S + inputDelayTicks`. If that room leads the sim by more than `inputDelayTicks - 1`, `sim-lag` pauses that room only. Late bot commands are not retargeted (`bot-commands-late`).
- Hash arbiter: sim digest vs that client's `state-hash` → `desync { playerId, tick }` to that socket only. The match continues. Relay rooms still end on a client-vs-client desync when `enableStateHashing` is on.
- `match-snapshot-request` → `match-snapshot { tick, bytes, requestId }` to that player only. One pending request per player (a new id replaces the old); those share one snapshot. Each player is answered at most once a second; an earlier request is kept (latest id) and answered when the interval elapses. `requestId` is per player. `match-resume-state.snapshot` is `{ tick }` when a server snapshot exists. `bot-commands-late` is `(matchId, tick, playerId)`.
- `Phalanx.endMatch(matchId, result)` and sim outcomes share `GameRoom.endMatch`. `onMatchArchived` fires once.
- `Phalanx.getPort()` is the bound port.
- A thrown tick or in-worker `process.exit` ends that match. A worker OOM (`ERR_WORKER_OUT_OF_MEMORY`) or thread crash ends every server match on it until Task 17. A new `room-create` then gets `room-error` `{ reason: 'sim-unavailable' }`. `stop()` ends every server match, waits for `ended`, then closes the host.
- With `absence` and `absencePolicy`, absence sends `setController` (`bot` while absent, `human` on return). Window expiry still forfeits (`disconnect` / `abandoned`).

Startup throws if a game's `tickRate` differs from the resolved server tick rate, or `tickMode` is not `continuous`. `inputDelayTicks` must be an integer from 1 through `maxTickAhead`.

## Exports from phalanx-server

```typescript
// Main class
import { Phalanx } from '@phalanx-engine/server';

// Auth utilities
import { TokenValidatorService, createDevValidator, createEndpointValidator } from '@phalanx-engine/server';

// Fixed-point numbers and the match RNG live in @phalanx-engine/math.
// This package does not re-export them.

// Game mode presets and the suggested absence window
import { GAME_MODES, DEFAULT_ABSENCE } from '@phalanx-engine/server';

// Types — Configuration
import type {
  PhalanxConfig, AuthConfig,
  CorsConfig, TlsConfig,
  DesyncConfig, DesyncAction,
  PauseConfig, AbsenceConfig, EndMatchResult,
  ServerSimHook, ServerRoomMatchConfig,
  PlayerAbsentEvent, PlayerCommandContext,
  GameMode, GameModePreset, CustomGameMode,
  TokenValidator, TokenValidationResult,
} from '@phalanx-engine/server';

// Types — Events & Data
import type {
  PhalanxEventType, PhalanxEventHandlers,
  PlayerCommand, TickCommands, SubmitCommandsEvent, SubmittedCommand,
  PlayerInfo, MatchInfo, MatchFoundEvent,
  GameStartEvent, TickSyncEvent, CommandsBatchEvent,
  QueuedPlayer, QueueStatusEvent,
  StateHashEvent, MatchResumeState, MatchState,
} from '@phalanx-engine/server';
```

## Troubleshooting

| Issue | Solution |
| --- | --- |
| `EADDRINUSE` | Another process is using the port. Use a different port or kill the process. |
| `Failed to load TLS certificates` | Check that the keyPath and certPath are correct and the files are readable. |
| Clients cannot connect | Check CORS configuration. Ensure the client's origin is in the allowed list. |
| Players timing out | Increase `timeoutTicks` and `disconnectTicks`. Check network latency. |
| Commands rejected | Check `maxTickBehind` / `maxTickAhead` values. Client may be too far out of sync. |
