# Phalanx Engine

A game-agnostic deterministic lockstep multiplayer engine with authentication, matchmaking, and command synchronization.

> ⚠️ **NOT IN PRODUCTION** - This project is currently in active development and not yet published to npm. Please clone the repository to use it.

## Quick Links

- 📖 [Server Documentation](./phalanx-server/README.md)
- 📖 [Client Documentation](./phalanx-client/README.md)
- 📖 [ECS Documentation](./phalanx-ecs/README.md)
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

This repository contains the following packages:

| Package                            | Description                                                |
| ---------------------------------- | ---------------------------------------------------------- |
| [phalanx-server](./phalanx-server) | Server library for hosting multiplayer games               |
| [phalanx-client](./phalanx-client) | Client library for connecting to Phalanx servers           |
| [phalanx-ecs](./phalanx-ecs)       | Renderer-agnostic ECS library with GameWorld facade        |
| [phalanx-math](./phalanx-math)     | Deterministic fixed-point math library for lockstep games  |

## Features

- **Deterministic Lockstep**: Synchronizes only player commands, game logic runs deterministically on each client
- **Fixed-Point Math**: Platform-independent fixed-point arithmetic via `phalanx-math` ensures identical calculations across all clients
- **Matchmaking**: Built-in support for various game modes (1v1, 2v2, 3v3, 4v4, FFA)
- **Tick System**: Configurable tick rate with command batching
- **Game Start Synchronization**: Ready handshake ensures all clients finish loading before the tick loop begins
- **Reconnection Support**: Players can rejoin matches after disconnection
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

## Quick Start

> **Note**: Since the packages are not yet published to npm, use the local packages from the cloned repository.

### Server

From the cloned repository, navigate to the server package:

```bash
cd phalanx-server
npm install
```

```typescript
import { Phalanx } from 'phalanx-server';

const server = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameMode: '3v3',
});

server.start().then(() => {
  console.log('Phalanx server running on port 3000');
});
```

### Client

From the cloned repository, navigate to the client package:

```bash
cd phalanx-client
pnpm install
```

```typescript
import { PhalanxClient } from 'phalanx-client';

const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'MyPlayer',
});

await client.connect();
const match = await client.joinQueueAndWaitForMatch();
await client.waitForGameStart();

client.on('tick', (data) => {
  console.log(`Tick ${data.tick}`);
});
```

## Documentation

- [Server Documentation](./phalanx-server/README.md)
- [Client Documentation](./phalanx-client/README.md)
- [ECS Documentation](./phalanx-ecs/README.md)
- [Math Documentation](./phalanx-math/README.md)
- [Babylon RTS Demo & Dev Guide](./direct-strike-babylon-example/README.md)

## Requirements

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)
- Socket.IO compatible transport

## License

MIT
