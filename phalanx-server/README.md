# Phalanx Server

Server component of [Phalanx Engine](../README.md) - a game-agnostic deterministic lockstep multiplayer engine with authentication, matchmaking, and command synchronization.

## Features

- **Deterministic Lockstep**: Synchronizes only player commands, game logic runs deterministically on each client
- **Matchmaking**: Built-in support for various game modes (1v1, 2v2, 3v3, 4v4, FFA)
- **Tick System**: Configurable tick rate with command batching
- **Reconnection Support**: Players can rejoin matches after disconnection
- **TypeScript**: Full TypeScript support with exported types

## Installation

```bash
npm install phalanx-server
```

## Quick Start

```typescript
import { Phalanx } from 'phalanx-server';

const app = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameMode: '3v3',
});

app.start().then(() => {
  console.log('Phalanx server running on port 3000');
});
```

## Configuration

```typescript
import { Phalanx, PhalanxConfig } from 'phalanx-server';

const config: Partial<PhalanxConfig> = {
  // === Server ===
  port: 3000, // Server port (default: 3000)
  cors: { origin: '*' }, // CORS configuration
  extraRequestHandler: async (req, res) => {
    // Optional: mount trusted webhooks or custom HTTP endpoints on the
    // same HTTP server. Return true when the request was fully handled.
    if (req.method === 'POST' && req.url === '/telegram/webhook') {
      res.writeHead(204);
      res.end();
      return true;
    }
    return false;
  },

  // === TLS/SSL (optional) ===
  // See "TLS/WSS Configuration" section below for details
  tls: {
    enabled: true,
    keyPath: '/path/to/privkey.pem',
    certPath: '/path/to/fullchain.pem',
  },

  // === Authentication (optional) ===
  auth: {
    enabled: false, // Set true to require auth tokens
  },

  // === Tick System ===
  tickRate: 20, // Ticks per second (default: 20)
  tickDeadlineMs: 50, // Max wait for commands per tick

  // === Matchmaking ===
  gameMode: '3v3', // Preset: '1v1' | '2v2' | '3v3' | '4v4' | 'FFA4'
  // OR custom:
  // gameMode: { playersPerMatch: 6, teamsCount: 2 },
  matchmakingIntervalMs: 1000,
  countdownSeconds: 5,

  // === Timeouts ===
  timeoutTicks: 40, // Ticks before "lagging" warning
  disconnectTicks: 100, // Ticks before disconnect
  reconnectGracePeriodMs: 30000,

  // === Command Validation ===
  maxTickBehind: 10,
  maxTickAhead: 5,

  // === Command History (for reconnection) ===
  commandHistoryTicks: 200, // Ticks of command history to keep

  // === Ready Handshake ===
  readyTimeoutMs: 30000, // Max time for clients to send ready (default: 30000)

  // === Determinism / Desync Detection ===
  enableStateHashing: true, // Enable server-side hash comparison
  stateHashInterval: 60, // Hint interval for hash submission (default: 60)
  desync: {
    enabled: true,
    action: 'end-match', // 'log-only' | 'end-match'
    gracePeriodTicks: 1, // Consecutive desyncs before taking action
  },

  // === Pause/Resume ===
  pause: {
    maxPausesPerPlayer: 3,
    requireSamePlayerToResume: true,
  },

  // === Game Types (multi-game-type routing) ===
  tickMode: 'continuous', // Default tick mode: 'continuous' | 'event'
  turnTimeoutMs: 60000, // Turn timeout for event mode (default: 60000)
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
};

const app = new Phalanx(config);
```

## Event Hooks

```typescript
app.on('match-created', (match) => {
  console.log(`Match ${match.id} created with ${match.players.length} players`);
});

app.on('match-started', (match) => {
  console.log(`Match ${match.id} started!`);
});

app.on('player-command', (playerId, command) => {
  // Custom command validation
  return true; // or false to reject
});

app.on('player-timeout', (playerId, matchId) => {
  console.log(`Player ${playerId} timed out`);
});

app.on('player-disconnected', (playerId, matchId) => {
  console.log(`Player ${playerId} disconnected from match ${matchId}`);
});

app.on('player-reconnected', (playerId, matchId) => {
  console.log(`Player ${playerId} reconnected to match ${matchId}`);
});
```

## HTTP Extension Hooks

Use `extraRequestHandler` when an embedding server needs a small HTTP surface on the same port as Phalanx, such as a Telegram webhook, an internal health probe, or a signed partner callback.

```typescript
import { Phalanx } from 'phalanx-server';

const app = new Phalanx({
  port: 3000,
  extraRequestHandler: async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/telegram/webhook') {
      return false; // fall through to Phalanx built-in routes
    }

    if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
      res.writeHead(401);
      res.end();
      return true;
    }

    // Parse and handle the request body here.
    res.writeHead(200);
    res.end();
    return true;
  },
});
```

Request routing order is:

1. CORS preflight (`OPTIONS`) is answered by Phalanx.
2. `extraRequestHandler` is called.
3. Built-in routes run (`/`, `/health`, `/auth/token`).
4. Unknown routes receive `404`.

Handler contract:

- Return `true` only after fully handling the request, including writing headers/body and ending the response.
- Return `false` to let Phalanx continue with its built-in routing.
- Set any route-specific CORS or content headers yourself for handled custom routes.
- Parse and size-limit request bodies yourself; Phalanx only parses bodies for its own built-in routes.
- If the handler throws, Phalanx logs the error and sends a generic `500` response when headers have not already been sent.

Treat custom HTTP routes as public internet-facing endpoints. Validate webhook secrets or signatures, avoid exposing trusted administrative operations to browsers, and apply rate limiting where appropriate.

## API

### Phalanx Class

```typescript
class Phalanx {
  constructor(config?: Partial<PhalanxConfig>);

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Trusted server-side integrations
  createPrivateRoomForHost(params: {
    playerId: string;
    username?: string;
    gameType?: string;
  }): RoomCreatedEvent;

  // Events
  on(event: PhalanxEvent, handler: Function): this;
  off(event: PhalanxEvent, handler: Function): this;

  // Runtime info
  getActiveMatches(): MatchInfo[];
  getQueueSize(): number;
  getConfig(): PhalanxConfig;
}
```

### Client Events

| Event                 | Emit | Receive | Description                       |
| --------------------- | ---- | ------- | --------------------------------- |
| `queue-join`          | ✅   |         | Join matchmaking queue            |
| `queue-leave`         | ✅   |         | Leave matchmaking queue           |
| `queue-status`        |      | ✅      | Queue join/leave confirmation     |
| `match-found`         |      | ✅      | Match created, countdown starting |
| `match-waiting-for-players` |      | ✅      | Match is waiting for disconnected participants before countdown |
| `game-start`          |      | ✅      | Countdown finished, load assets   |
| `client-ready`        | ✅   |         | Client finished loading, ready for ticks |
| `player-ready`        |      | ✅      | A player reported ready           |
| `match-end`           |      | ✅      | Match has ended                   |
| `submit-commands`     | ✅   |         | Send game commands                |
| `submit-commands-ack` |      | ✅      | Command acknowledgment            |
| `commands-batch`      |      | ✅      | All commands for a tick           |
| `tick-sync`           |      | ✅      | Periodic tick synchronization     |
| `countdown`           |      | ✅      | Countdown before game starts      |
| `submit-state-hash`   | ✅   |         | Submit state hash for desync detection |
| `hash-comparison`     |      | ✅      | Server hash comparison result     |
| `pause-game`          | ✅   |         | Request game pause                |
| `resume-game`         | ✅   |         | Request game resume               |
| `game-paused`         |      | ✅      | Game was paused                   |
| `game-resumed`        |      | ✅      | Game was resumed                  |
| `reconnect-match`     | ✅   |         | Attempt to rejoin a match         |
| `reconnect-status`    |      | ✅      | Reconnection result               |
| `reconnect-state`     |      | ✅      | Game state for reconnection       |
| `player-disconnected` |      | ✅      | Another player disconnected       |
| `player-reconnected`  |      | ✅      | Another player reconnected        |
| `room-create`         | ✅   |         | Create a private room             |
| `room-join`           | ✅   |         | Join a private room by invite code |
| `room-cancel`         | ✅   |         | Cancel a previously created room  |
| `room-recover`        | ✅   |         | Reclaim a room after socket drop (see Private Room Recovery) |
| `room-created`        |      | ✅      | Room created; contains invite `code` |
| `room-error`          |      | ✅      | Room operation failed; contains `message` |
| `room-expired`        |      | ✅      | Room TTL exceeded; server evicted the room |
| `room-cancelled`      |      | ✅      | Host cancelled the room           |
| `room-recovered`      |      | ✅      | Room successfully reclaimed after socket drop |

### Game Start Synchronization

After the countdown completes, the server emits `game-start` and enters a `waiting-for-ready` state. The tick loop does **not** start until all connected clients send `client-ready`. This prevents desync caused by clients with different asset loading times missing early ticks.

If a client does not send `client-ready` within 30 seconds, the match ends with reason `'ready-timeout'`.

### Private Room Recovery

Private rooms support a `room-recover` handshake so a participant whose socket was dropped (e.g. mobile OS suspended the WebSocket while the user was sharing the invite link) can seamlessly reclaim either a waiting room or a private-room match without losing the pending join or countdown state.

`room-recover` requires both the deterministic `playerId` and the original room `code`. Treat the room code as a bearer recovery secret: possession of the code is what proves the caller is allowed to recover that waiting room or match.

#### Recovery protocol

1. Client calls `room-recover` with `{ playerId, code }` after reconnecting.
2. If the code still maps to a waiting room, only the original host can recover it. The server rebinds the host socket and emits `room-recovered`.
3. If the code has already been consumed into a match, any participant in that match can recover with the original code. The server emits `room-recovered` and delegates to the match reconnect flow.
4. If the match is still waiting for disconnected participants, reconnecting everyone starts the countdown. If the match is already in progress, the normal reconnect state is delivered.
5. Server responds with `room-error: { message: 'Room expired' }` on terminal failure. The same generic message is used for missing, expired, wrong-player, and already-finished cases so callers cannot probe room ownership.

#### Server-side room TTL

Waiting rooms are kept alive for `ROOM_TTL_MS` (default 5 minutes) from creation. If the host disconnects, the room remains recoverable until that original TTL expires; if no host socket is connected at expiry time, there is no `room-expired` recipient to notify. Clients should mirror this TTL in their local persistence layer so they do not attempt `room-recover` for a room the server has certainly already evicted.

The client-side [`RoomRecoveryController`](../phalanx-client/README.md#mobile-friendly-room-recovery) handles the full recovery lifecycle automatically when `roomRecovery.enabled: true` is passed to `PhalanxClient`.

### Trusted Server-Side Private Room Creation

Trusted integrations can create a private room for a host that is not currently connected over Socket.IO. This is intended for server-side entry points such as bot commands: the bot creates a room, sends the invite link containing the room code, and the host later opens the game and recovers the room with the same deterministic `playerId`.

```typescript
const room = app.createPrivateRoomForHost({
  playerId: `telegram:${telegramUserId}`,
  username: telegramUsername,
  gameType: 'chapayev',
});

const inviteUrl = `https://game.example.com/?room=${room.code}`;
```

`createPrivateRoomForHost`:

- Requires `playerId` and accepts optional `username` and `gameType`.
- Defaults `username` to `playerId` and `gameType` to the default game type when omitted.
- Returns `{ code }`. If the same host already has an active waiting room, the existing room code is reused rather than creating a duplicate room.
- Throws if Phalanx is not running, if the host is already queued for matchmaking, or if the host is already in an active private-room match.
- Does not emit `room-created`, because there is no host socket yet.

Typical bot/webhook flow:

1. A trusted HTTP handler validates the webhook request.
2. The handler derives a stable server-trusted `playerId` from the external identity, such as `telegram:123456`.
3. The handler calls `createPrivateRoomForHost` and sends the invite URL/code back through the external channel.
4. The host opens the game and emits `room-recover` with the same `playerId` and code.
5. The guest opens the invite and emits `room-join` with the code.

Do not expose `createPrivateRoomForHost` as an unauthenticated browser endpoint. Browser clients should continue using the Socket.IO `room-create` flow, while trusted server integrations should authenticate the external request before creating rooms.

## Game Types

Phalanx supports running multiple game types on a single server instance. Each game type can override base config values like `tickMode`, `tickRate`, `gameMode`, `countdownSeconds`, and `turnTimeoutMs`.

### Configuration

```typescript
const app = new Phalanx({
  tickRate: 20,
  gameMode: '1v1',
  gameTypes: [
    {
      gameType: 'direct-strike',
      tickMode: 'continuous',
      tickRate: 20,
      gameMode: '1v1',
    },
    {
      gameType: 'chapayev',
      tickMode: 'event',
      gameMode: '1v1',
      turnTimeoutMs: 90000,
    },
  ],
});
```

### Client: Joining a Game Type Queue

Clients declare which game type they want to join via the `queue-join` event:

```typescript
socket.emit('queue-join', {
  playerId: 'player-123',
  username: 'Alice',
  gameType: 'chapayev', // optional — omit for default queue
});
```

Clients that omit `gameType` are placed in a `'default'` queue and use the base config.

### `tickMode: 'event'` (Turn-Based / Tickless)

When a game type uses `tickMode: 'event'`, no server tick loop runs. Instead:

- On `receivePlayerCommands`, the server immediately broadcasts `commands-batch` to all players in the room.
- `currentTick` increments by 1 per broadcast.
- A turn timeout (`turnTimeoutMs`, default 60000ms) starts on game start and resets on each received batch. If the timeout fires, the match ends with reason `'turn-timeout'`.
- `timeoutTicks` / `disconnectTicks` activity tracking is skipped in event mode.
- Pause/resume works identically in both modes.

This is ideal for turn-based physics games (e.g. Chapayev checkers) where game state transitions are driven by player commands only.

### `turnTimeoutMs`

Maximum time (in milliseconds) allowed between command batches in event mode. If no commands arrive within this window, the match ends automatically. Default: `60000` (1 minute).

## Game Modes

```typescript
import { GAME_MODES } from 'phalanx-server';

// Available presets:
// '1v1'  - 2 players, 2 teams
// '2v2'  - 4 players, 2 teams
// '3v3'  - 6 players, 2 teams
// '4v4'  - 8 players, 2 teams
// 'FFA4' - 4 players, 4 teams (Free For All)
```

## TLS/WSS Configuration

Phalanx supports secure WebSocket connections (WSS) for production environments.

### Basic TLS Setup

```typescript
import { Phalanx } from 'phalanx-server';

const app = new Phalanx({
  port: 443,
  tls: {
    enabled: true,
    keyPath: '/etc/letsencrypt/live/game.example.com/privkey.pem',
    certPath: '/etc/letsencrypt/live/game.example.com/fullchain.pem',
  },
});

await app.start();
console.log('Phalanx server running with TLS on port 443');
```

### TLS Configuration Options

```typescript
interface TlsConfig {
  /** Enable TLS/SSL encryption */
  enabled: boolean;
  /** Path to the private key file (PEM format) */
  keyPath: string;
  /** Path to the certificate file (PEM format) */
  certPath: string;
  /** Optional path to CA certificate chain (for Let's Encrypt) */
  caPath?: string;
}
```

### Development Mode (No TLS)

When TLS is not configured, the server runs in HTTP/WS mode:

```typescript
const app = new Phalanx({
  port: 3000,
  // No tls config = development mode
});
```

### Let's Encrypt Setup

1. Install certbot:
   ```bash
   sudo apt install certbot
   ```

2. Obtain certificates:
   ```bash
   sudo certbot certonly --standalone -d game.example.com
   ```

3. Configure Phalanx:
   ```typescript
   const app = new Phalanx({
     port: 443,
     tls: {
       enabled: true,
       keyPath: '/etc/letsencrypt/live/game.example.com/privkey.pem',
       certPath: '/etc/letsencrypt/live/game.example.com/fullchain.pem',
     },
   });
   ```

4. Set up certificate auto-renewal:
   ```bash
   sudo certbot renew --dry-run
   ```

> **Note**: You may need to run the server with elevated privileges for port 443, or use a reverse proxy like nginx.

### Client Connection (WSS)

When connecting to a TLS-enabled server from the client:

```typescript
import { PhalanxClient } from 'phalanx-client';

const client = await PhalanxClient.create({
  serverUrl: 'https://game.example.com', // Use https:// for TLS
  playerId: 'player-123',
  username: 'MyPlayer',
});
```

## Related Packages

- [phalanx-client](../phalanx-client) - Client library for connecting to Phalanx servers

## Requirements

- Node.js 18+

## License

MIT
