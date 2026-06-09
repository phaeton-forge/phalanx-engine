# Phalanx Engine

A game-agnostic deterministic lockstep multiplayer engine with authentication, matchmaking, and command synchronization.

> ⚠️ **NOT IN PRODUCTION** - This project is currently in active development and not yet published to npm. Please clone the repository to use it.

## Quick Links

- 📖 [Server Documentation](./phalanx-server/README.md)
- 📖 [Client Documentation](./phalanx-client/README.md)
- 📖 [ECS Documentation](./phalanx-ecs/README.md)
- 📖 [Physics Documentation](./phalanx-physics/README.md)
- 📖 [Abilities Documentation](./phalanx-abilities/README.md)
- 📖 [Math Documentation](./phalanx-math/README.md)
- 🎮 [Babylon RTS Demo](./direct-strike-babylon-example/README.md)

## Installation

**Clone the repository:**

```bash
git clone https://github.com/phaeton2040-AI/phalanx-engine.git
cd phalanx-engine
pnpm install
```

# Packages

This repository is a pnpm workspace containing the following publishable packages:

| Package                              | Description                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [phalanx-server](./phalanx-server)   | Server library for hosting multiplayer games (matchmaking, lockstep, rooms)  |
| [phalanx-client](./phalanx-client)   | Browser/Node client for connecting to Phalanx servers                        |
| [phalanx-ecs](./phalanx-ecs)         | Renderer-agnostic ECS library with `GameWorld` facade and SoA storage        |
| [phalanx-physics](./phalanx-physics) | Deterministic fixed-point physics (spatial hash, narrow phase, impulses)     |
| [phalanx-abilities](./phalanx-abilities) | Deterministic gameplay ability system (attributes, effects, tags) |
| [phalanx-math](./phalanx-math)       | Deterministic fixed-point math library for lockstep games                    |

In addition to the libraries, the workspace contains reference applications under `direct-strike-babylon-example/`, `chapaev/`, `arena-shooter/`, `game-test/`, and `game-test-server/`.

## Architecture

```
                        ┌─────────────────────────────┐
                        │       phalanx-server        │
                        │ matchmaking · rooms · ticks │
                        └──────────────┬──────────────┘
                                       │ Socket.IO (commands & events)
                                       ▼
   ┌────────────────────────────┐  ┌──────────────────────────────┐
   │      phalanx-client        │  │      phalanx-ecs (optional)  │
   │ connection · matchmaking · │──▶│  EntityManager · GameWorld · │
   │ command batching · auth ·  │  │  SoA storage · pooling       │
   │ room recovery · render     │  └────────────────┬─────────────┘
   │ loop (ITickFrameProvider)  │                   │
   └────────────────────────────┘                   ▼
                                       ┌────────────────────────────┐
                                       │     phalanx-physics        │
                                       │ deterministic FP physics · │
                                       │ spatial hash · collisions  │
                                       └──────────────┬─────────────┘
                                                      │
                        ┌─────────────────────────────┴─────────────────────────────┐
                        ▼                                                           ▼
           ┌────────────────────────────┐                         ┌────────────────────────────┐
           │    phalanx-abilities       │                         │       phalanx-math         │
           │ GAS-style attributes ·     │                         │ FP fixed-point arithmetic  │
           │ effects · tags             │                         └────────────────────────────┘
           └────────────────────────────┘
```

`phalanx-client` and `phalanx-ecs` both implement the `ITickFrameProvider` interface, so a `GameWorld` can be driven by either an internal `TickFrameManager` (single-player) or by the multiplayer client (`PhalanxClient` is fed the server's authoritative ticks).

## Features

- **Deterministic Lockstep**: Synchronizes only player commands, game logic runs deterministically on each client
- **Fixed-Point Math**: Platform-independent fixed-point arithmetic via `phalanx-math` ensures identical calculations across all clients
- **Matchmaking**: Built-in support for various game modes (1v1, 2v2, 3v3, 4v4, FFA)
- **Private Rooms**: Invite-code rooms with host recovery so mobile players can share links without losing their room
- **Tick System**: Configurable tick rate with command batching
- **Game Start Synchronization**: Ready handshake ensures all clients finish loading before the tick loop begins
- **Reconnection Support**: Players can rejoin matches after disconnection
- **Mobile-Friendly Room Recovery**: `visibilitychange`/`pageshow`/`online` lifecycle listeners, exponential-backoff retry, localStorage persistence across hard reloads, and a pre-game stall watchdog — all opt-in via a single config flag
- **TypeScript**: Full TypeScript support with exported types

## Game Start Synchronization

Phalanx uses a **ready handshake** protocol to ensure all clients are fully initialized before the simulation begins. This prevents desync caused by clients with different asset download speeds missing early ticks.

### How it works

1. Server emits `game-start` after the countdown completes and enters a `waiting-for-ready` state
2. Each client receives `game-start`, loads assets, sets up the game world, and initializes all systems
3. Each client calls `client.sendReady()` to emit `client-ready` to the server
4. Server receives `client-ready` from **all** connected players, then starts the tick loop
5. All clients are guaranteed to be subscribed to tick events before tick 0

If any client fails to send `client-ready` within 30 seconds, the match ends with reason `'ready-timeout'`.

### Usage

Clients **must** call `sendReady()` after initialization:

```typescript
client.on('gameStart', async () => {
  await game.initialize(); // Load assets, set up ECS, etc.
  client.sendReady();      // Tell the server we're ready
});
```

## Mobile-Friendly Room Recovery

Private rooms on mobile browsers face a specific challenge: when a host shares the invite link (e.g. copies it into Telegram), the OS may kill the WebSocket while the tab is backgrounded. Without recovery the room is silently lost and the host sees an empty waiting screen.

Phalanx-client ships a built-in `RoomRecoveryController` (opt-in via `roomRecovery: { enabled: true }`) that handles the full recovery lifecycle so every game gets it for free.

### What it does automatically

| Concern | Mechanism |
|---|---|
| Tab returns to foreground | `visibilitychange` + `pageshow` (bfcache) listeners trigger `room-recover` |
| Socket reconnects | `connected` event triggers `room-recover` |
| Network comes back | `online` event gates the attempt behind stabilization |
| Network quality | `navigator.connection` adapts the recover ack timeout (10s normal / 15s 3G / 25s slow-2G) |
| Transport on mobile | `mobileFriendlyTransports: true` picks `polling` on mobile UAs, `websocket` on desktop |
| Stable guest identity | `persistGuestPlayerId: true` keeps the same anonymous id across hard reloads |
| Cold-start recovery | `localStorage` persists the active room code so a full-page reload can reclaim the room |
| Pre-game stall | Watchdog fires `forceRecover` if `matchFound→countdown→gameStart` goes silent |

### Quick setup

```typescript
const client = new PhalanxClient({
  serverUrl: 'https://game.example.com',
  mobileFriendlyTransports: true,      // auto polling-on-mobile
  persistGuestPlayerId: true,          // stable id for cold-start recovery
  roomRecovery: { enabled: true },     // arm the recovery controller
});

// Startup: attempt cold-start recovery if the previous tab persisted a room
const coldStartCode = client.roomRecovery!.loadColdStartCode();
if (coldStartCode) {
  client.roomRecovery!.resumeTrackingHost(coldStartCode);
  await client.roomRecovery!.tryRecover();
}

// After creating a private room:
const { code } = await client.createRoom();
client.roomRecovery!.startTrackingHost(code);

// After joining a private room (guest side):
client.roomRecovery!.trackGuestJoin(code);

// When the match starts (host side):
client.roomRecovery!.stop(); // clears persistence and disarms hooks

// Listen to recovery events for UI updates:
client.on('recoveryStatus', (e) => {
  if (e.phase === 'recovering')      showStatus('Reconnecting…');
  else if (e.phase === 'retrying')   showStatus(`Retry in ${e.nextRetryMs! / 1000}s`);
  else if (e.phase === 'gave-up')    showStatus('Could not reconnect');
  else                               clearStatus();
});

client.on('roomTerminated', (e) => {
  if (e.reason === 'expired') showError('Room expired — start a new one');
  returnToMenu();
});
```

See the [Client Documentation](./phalanx-client/README.md#mobile-friendly-room-recovery) for the full API reference.

## Quick Start

> **Note**: Packages are not yet published to npm. Work from the cloned monorepo and consume packages via `workspace:*`.

### Server

```typescript
import { Phalanx } from 'phalanx-server';

const server = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameMode: '3v3',
});

await server.start();
console.log('Phalanx server running on port 3000');
```

### Client

```typescript
import { PhalanxClient } from 'phalanx-client';

const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'MyPlayer',
});

const match = await client.joinQueueAndWaitForMatch();
await client.waitForGameStart();

// After loading assets, tell the server we're ready for ticks.
client.sendReady();

client.onTick((tick, commands) => {
  // Run deterministic simulation using `commands`
});

client.onFrame((alpha, dt) => {
  // Render with interpolation between ticks
});
```

### Single-player ECS + Physics

```typescript
import { GameWorld } from 'phalanx-ecs';
import { PhysicsWorld, PhysicsBodyComponent } from 'phalanx-physics';
import { FP } from 'phalanx-math';

const world = new GameWorld({ tickRate: 20 });

const physics = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
});

const { physicsSystem } = physics.getSystems();
world.registerSystems([physicsSystem], []);

world.start({
  beforeTick(tick) {
    if (tick === 0) {
      physics.setTransformStore(world.entityManager.getOrCreateSoAStore(MyTransformSchema), {
        fpPositionX: 'fpPositionX',
        fpPositionY: 'fpPositionY',
        fpPositionZ: 'fpPositionZ',
      });
    }
  },
});
```

## Documentation

- [Server Documentation](./phalanx-server/README.md)
- [Client Documentation](./phalanx-client/README.md)
- [ECS Documentation](./phalanx-ecs/README.md)
- [Physics Documentation](./phalanx-physics/README.md)
- [Math Documentation](./phalanx-math/README.md)
- [Babylon RTS Demo & Dev Guide](./direct-strike-babylon-example/README.md)

## Workspace Commands

All commands are run from the repository root.

| Command                   | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `pnpm install`            | Install workspace dependencies                                     |
| `pnpm build`              | Build every workspace package (`pnpm -r build`)                    |
| `pnpm clean`              | Run each package's `clean` script                                  |
| `pnpm test`               | Run all package test suites (Vitest)                               |
| `pnpm test:server`        | Run only `phalanx-server` tests                                    |
| `pnpm test:client`        | Run only `phalanx-client` tests                                    |
| `pnpm test:watch`         | Run package test suites in watch mode                              |
| `pnpm dev:server`         | `tsc --watch` for `phalanx-server`                                 |
| `pnpm dev:client`         | `tsc --watch` for `phalanx-client`                                 |
| `pnpm dev:game`           | Dev-mode reference game (`game-test`)                              |
| `pnpm dev:game-server`    | Dev-mode reference game server (`game-test-server`)                |
| `pnpm build:game-server`  | Build the reference game server                                    |
| `pnpm lint` / `lint:fix`  | ESLint over the workspace                                          |
| `pnpm format` / `format:check` | Prettier over the workspace                                   |

## Requirements

- Node.js 24.x (`>=24.0.0 <25.0.0`)
- pnpm 10.x (install with `corepack enable && corepack prepare pnpm@10.33.2 --activate`)
- Socket.IO compatible transport (HTTP or HTTPS / WSS)

## License

MIT
