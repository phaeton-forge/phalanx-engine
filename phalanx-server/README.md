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

  // === TLS/SSL (optional) ===
  // See "TLS/WSS Configuration" section below for details
  tls: {
    enabled: true,
    keyPath: '/path/to/privkey.pem',
    certPath: '/path/to/fullchain.pem',
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

## API

### Phalanx Class

```typescript
class Phalanx {
  constructor(config?: Partial<PhalanxConfig>);

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

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
| `game-start`          |      | ✅      | Countdown finished, load assets   |
| `client-ready`        | ✅   |         | Client finished loading, ready for ticks |
| `player-ready`        |      | ✅      | A player reported ready           |
| `match-end`           |      | ✅      | Match has ended                   |
| `submit-commands`     | ✅   |         | Send game commands                |
| `submit-commands-ack` |      | ✅      | Command acknowledgment            |
| `commands-batch`      |      | ✅      | All commands for a tick           |
| `tick-sync`           |      | ✅      | Periodic tick synchronization     |
| `countdown`           |      | ✅      | Countdown before game starts      |
| `reconnect-match`     | ✅   |         | Attempt to rejoin a match         |
| `reconnect-status`    |      | ✅      | Reconnection result               |
| `reconnect-state`     |      | ✅      | Game state for reconnection       |
| `player-disconnected` |      | ✅      | Another player disconnected       |
| `player-reconnected`  |      | ✅      | Another player reconnected        |

### Game Start Synchronization

After the countdown completes, the server emits `game-start` and enters a `waiting-for-ready` state. The tick loop does **not** start until all connected clients send `client-ready`. This prevents desync caused by clients with different asset loading times missing early ticks.

If a client does not send `client-ready` within 30 seconds, the match ends with reason `'ready-timeout'`.

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
import { Phalanx } from 'phalanx-client';

const phalanx = await Phalanx.init({
  serverUrl: 'wss://game.example.com', // Use wss:// instead of ws://
  playerId: 'player-123',
});
```

## Related Packages

- [phalanx-client](../phalanx-client) - Client library for connecting to Phalanx servers

## Requirements

- Node.js 18+

## License

MIT
