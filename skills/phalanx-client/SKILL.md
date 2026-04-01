---
name: phalanx-client
description: Initialize and configure a Phalanx Engine multiplayer client. Use when the user wants to connect to a Phalanx server, set up matchmaking, handle game lifecycle events, implement tick/frame loops, send commands, handle reconnection, integrate with phalanx-ecs GameWorld, or implement desync detection on the client side.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx Client Skill

## When to Use This Skill

Use this skill when the user asks to:

- Connect a game client to a Phalanx multiplayer server
- Set up matchmaking, lobby, and game lifecycle (countdown, start, end)
- Implement the tick/frame game loop using PhalanxClient
- Send player commands to the server
- Handle reconnection after disconnects
- Integrate PhalanxClient with phalanx-ecs GameWorld
- Implement desync detection with StateHasher
- Set up OAuth authentication on the client
- Handle pause/resume in multiplayer

## Prerequisites

- A running Phalanx server (see `phalanx-server` skill)
- Node.js 18+ (or a browser environment)
- Socket.IO compatible transport

## Step-by-Step Instructions

### 1. Install the Client Library

Inside the monorepo:

```json
{
  "dependencies": {
    "phalanx-client": "workspace:*"
  }
}
```

Once published to npm:

```bash
npm install phalanx-client
```

### 2. Create and Connect a Client

There are two ways to create a client:

#### Static Factory (Recommended)

Creates the client and connects in one step:

```typescript
import { PhalanxClient } from 'phalanx-client';

const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'Alice',
});
```

#### Manual Construction

For more control over the connection lifecycle:

```typescript
const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'Alice',
  autoReconnect: true,
});

await client.connect();
```

### 3. Client Configuration

```typescript
interface PhalanxClientConfig {
  serverUrl: string;               // Server URL (e.g., 'http://localhost:3000')
  playerId?: string;               // Unique player ID (auto-generated if omitted)
  username?: string;               // Display name
  autoReconnect?: boolean;         // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts?: number;   // Max reconnection attempts (default: 5)
  reconnectDelayMs?: number;       // Delay between attempts (default: 1000)
  connectionTimeoutMs?: number;    // Connection timeout (default: 10000)
  tickRate?: number;               // Must match server (default: 20)
  debug?: boolean;                 // Enable debug logging (default: false)
  authToken?: string;              // Pre-existing auth token
  auth?: PhalanxAuthConfig;        // OAuth configuration
  pause?: PauseConfig;             // Pause/resume configuration
}
```

### 4. Matchmaking Flow

```typescript
// Option A: Step by step
await client.joinQueue();
const match = await client.waitForMatch();
const gameStart = await client.waitForGameStart();

// Option B: Combined
const match = await client.joinQueueAndWaitForMatch();
await client.waitForGameStart();

// Option C: Event-based
client.on('matchFound', (match) => {
  console.log(`Match: ${match.matchId}, Team: ${match.teamId}`);
  console.log(`Teammates:`, match.teammates);
  console.log(`Opponents:`, match.opponents);
});

client.on('countdown', (event) => {
  console.log(`Starting in ${event.seconds}...`);
});

client.on('gameStart', (event) => {
  console.log(`Game started! Match: ${event.matchId}`);
  // event.randomSeed is available for deterministic RNG
});

client.on('matchEnd', (event) => {
  console.log(`Match ended: ${event.reason}`);
  // event.reason can be: 'normal', 'desync', 'disconnect', 'ready-timeout', etc.
  // event.winner — winner info (null on desync)
  // event.details — additional details (e.g., desync info)
});

await client.joinQueue();
```

### 4b. Game Start Synchronization (Ready Handshake)

After `gameStart` fires, the server waits for **all** clients to call `sendReady()` before starting the tick loop. This prevents desync caused by clients with different asset loading times missing early ticks.

```typescript
client.on('gameStart', async () => {
  // Load assets, set up ECS world, initialize all systems
  await game.initialize();
  // Signal the server that this client is ready for ticks
  client.sendReady();
});
```

If any client fails to call `sendReady()` within 30 seconds, the match ends with reason `'ready-timeout'`.

### 5. Game Loop — Simplified API (Recommended)

The simplified API provides `onTick`, `onFrame`, and `sendCommand` for a clean game loop:

```typescript
// Register tick handler — called for each server tick with all player commands
const unsubTick = client.onTick((tick, commands) => {
  // commands: { tick: number, commands: { [playerId]: PlayerCommand[] } }

  // Process commands from all players
  for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
    for (const cmd of playerCommands) {
      if (cmd.type === 'move') {
        moveEntity(playerId, cmd.data.targetX, cmd.data.targetZ);
      }
    }
  }

  // Run deterministic simulation step
  physics.update();
  combat.update();
});

// Register frame handler — called every animation frame (~60fps)
const unsubFrame = client.onFrame((alpha, dt) => {
  // alpha: interpolation value 0-1 (progress between ticks)
  // dt: delta time in seconds since last frame

  // Interpolate entity positions for smooth visuals
  for (const entity of entities) {
    entity.renderX = lerp(entity.prevX, entity.currX, alpha);
    entity.renderZ = lerp(entity.prevZ, entity.currZ, alpha);
  }

  // Render the scene
  scene.render();
});

// Send commands — automatically batched and sent each frame
client.sendCommand('move', { targetX: 10, targetZ: 20 });
client.sendCommand('attack', { targetId: 'enemy-123' });

// Later: unsubscribe
unsubTick();
unsubFrame();
```

### 6. Game Loop — Legacy Event-Based API

For more control or backward compatibility:

```typescript
// Listen for tick sync
client.on('tick', (event) => {
  // Submit pending commands for the next tick
  client.submitCommandsAsync(event.tick + 1, pendingCommands);
  pendingCommands = [];
});

// Listen for command batches
client.on('commands', (event) => {
  for (const command of event.commands) {
    processCommand(command);
  }
});

// Submit commands with acknowledgment
const ack = await client.submitCommands(tick, [
  { type: 'move', data: { x: 10, y: 20 } },
]);
```

### 7. Integration with phalanx-ecs GameWorld

PhalanxClient implements the `ITickFrameProvider` interface, so it plugs directly into GameWorld:

```typescript
import { PhalanxClient } from 'phalanx-client';
import { GameWorld } from 'phalanx-ecs';

// Create client
const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'Alice',
});

// Create GameWorld with client as tick/frame provider
const world = new GameWorld({
  tickFrameProvider: client,
  componentTypes: Object.values(ComponentType),
});

// Register systems
world.registerSystems(
  [movementSystem, combatSystem, physicsSystem],  // Tick systems (deterministic)
  [interpolationSystem, healthBarSystem],          // Frame systems (visual)
);

// Start with lifecycle hooks
world.start({
  beforeTick(tick, commands) {
    // Snapshot positions for interpolation
    interpolationSystem.snapshotPositions();
    // Execute network commands before tick systems run
    lockstepManager.processTick(tick, commands);
  },
  afterTick(tick) {
    // Capture positions after simulation
    interpolationSystem.captureCurrentPositions();
    // Cleanup destroyed entities
    lockstepManager.cleanup();
    // Submit state hash for desync detection (optional)
    // lockstepManager.submitHashIfNeeded(tick, world.entityManager);
  },
  beforeFrame(alpha, dt) {
    cameraController.update(dt);
  },
  afterFrame(alpha, dt) {
    interpolationSystem.interpolate(alpha);
    scene.render();  // Must be called manually
  },
});

// Connect and join matchmaking
await client.connect();
await client.joinQueue();
```

Key points about GameWorld integration:
- `world.start(hooks?)` starts the loop — all registered systems run automatically
- Tick systems (`processTick`) run at fixed rate, deterministically
- Frame systems (`update`) run every render frame
- `scene.render()` must be called manually in `afterFrame` — GameWorld does NOT call it
- Do NOT call `processAllTicks()` or `updateAll()` manually

### 8. Desync Detection

Use `StateHasher` to compute deterministic hashes of game state:

```typescript
import { PhalanxClient, StateHasher } from 'phalanx-client';

// In your tick handler (or afterTick hook)
client.onTick((tick, commands) => {
  simulation.processTick(tick, commands);

  // Submit state hash every 20 ticks (once per second at 20 TPS)
  if (tick % 20 === 0) {
    const hash = computeStateHash(tick);
    client.submitStateHash(tick, hash);
  }
});

function computeStateHash(tick: number): string {
  const hasher = new StateHasher();

  hasher.addInt(tick);

  // Sort entities by ID for deterministic ordering
  const entities = [...allEntities].sort((a, b) => a.id - b.id);
  hasher.addInt(entities.length);

  for (const entity of entities) {
    hasher.addInt(entity.id);
    // Hash deterministic state only (fixed-point positions, not visual)
    const fpPos = entity.fpPosition;
    hasher.addFloat(FP.ToFloat(fpPos.x));
    hasher.addFloat(FP.ToFloat(fpPos.y));
    hasher.addFloat(FP.ToFloat(fpPos.z));
    hasher.addInt(entity.health);
  }

  return hasher.finalize();  // 8-char hex string
}

// Handle desync events
client.on('desync', (event) => {
  console.error(`Desync at tick ${event.tick}!`);
  console.error(`Local: ${event.localHash}, Remote:`, event.remoteHashes);
});

client.on('matchEnd', (event) => {
  if (event.reason === 'desync') {
    console.error('Match ended due to desync');
  }
});
```

#### Configuring Desync Detection

```typescript
// Disable desync detection
client.configureDesyncDetection({ enabled: false });

// Adjust stored hash limit
client.configureDesyncDetection({ maxStoredHashes: 50 });
```

#### StateHasher API

```typescript
const hasher = new StateHasher();
hasher.addInt(42);                    // Integer
hasher.addFloat(3.14159);             // Float (converted to fixed-point)
hasher.addString("entity-123");       // String
hasher.addBool(true);                 // Boolean
hasher.addIntArray([1, 2, 3]);        // Array of integers
hasher.addFloatArray([1.5, 2.5]);     // Array of floats
const hash = hasher.finalize();       // 8-char hex string (FNV-1a)
hasher.reset();                       // Reuse hasher
```

#### Best Practices for State Hashing

- Always sort entities by a stable ID before hashing
- Include only deterministic state: fixed-point positions, health, targets, cooldowns
- Exclude visual-only state: interpolated mesh positions, particles, animations
- Use `entity.fpPosition` (fixed-point), not `entity.position` (float)

### 9. Reconnection

```typescript
// Automatic reconnection (enabled by default)
const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelayMs: 1000,
});

// Manual reconnection
const state = await client.reconnectToMatch(matchId);

// Reconnection events
client.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

client.on('reconnectFailed', () => {
  console.log('Failed to reconnect');
});

client.on('reconnectState', (event) => {
  // event contains command history for fast-forward replay
  console.log(`Replaying to tick ${event.currentTick}, state: ${event.state}`);
  console.log(`Recent commands:`, event.recentCommands);
});
```

### 10. Pause/Resume (Multiplayer)

```typescript
// Request pause (server must confirm)
client.pauseGame();

// Request resume
client.resumeGame();

// Listen for pause/resume events
client.on('gamePaused', (event) => {
  console.log(`Game paused by ${event.requestedBy}, last tick: ${event.lastTick}`);
});

client.on('gameResumed', (event) => {
  console.log(`Game resumed by ${event.resumedBy}`);
});
```

When PhalanxClient is used as a `tickFrameProvider` in GameWorld, you can also use:

```typescript
world.pause();   // Calls client.requestPause() → client.pauseGame()
world.resume();  // Calls client.requestResume() → client.resumeGame()
```

> **Note:** `requestPause()` / `requestResume()` are ITickFrameProvider contract methods that delegate to `pauseGame()` / `resumeGame()`. Use the latter directly when calling on the client.

### 11. Authentication

```typescript
import { PhalanxClient, AuthManager, GoogleOAuthAdapter } from 'phalanx-client';

// Option A: Pre-existing token
const client = new PhalanxClient({
  serverUrl: 'https://game.example.com',
  authToken: 'your-jwt-token',
});

// Option B: OAuth configuration
const client = new PhalanxClient({
  serverUrl: 'https://game.example.com',
  auth: {
    provider: 'google',
    google: {
      clientId: 'your-google-client-id',
      redirectUri: window.location.origin + '/auth/callback',
    },
  },
});

// Check auth state
const authState = client.getAuthState();
if (!authState.isAuthenticated) {
  await client.login('google');  // Opens OAuth flow
}
```

### 12. State Getters

```typescript
const tick = client.getCurrentTick();
const matchId = client.getMatchId();
const playerId = client.getPlayerId();
const username = client.getUsername();
const clientState = client.getClientState();      // 'idle' | 'in-queue' | 'match-found' | 'countdown' | 'playing' | 'paused' | 'reconnecting' | 'finished'
const connectionState = client.getConnectionState(); // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
const isConnected = client.isConnected();
```

### 13. Cleanup

```typescript
// Disconnect (stops render loop, clears handlers)
client.disconnect();

// Full cleanup (disconnect + dispose all resources)
await client.destroy();
```

## All Client Events

```typescript
// Connection
client.on('connected', () => {});
client.on('disconnected', () => {});
client.on('reconnecting', (attempt: number) => {});
client.on('reconnectFailed', () => {});
client.on('error', (error: PhalanxError) => {});

// Auth
client.on('authStateChanged', (state: PhalanxAuthState) => {});
client.on('authError', (error: PhalanxError) => {});

// Queue
client.on('queueJoined', (status: QueueStatusEvent) => {});
client.on('queueLeft', () => {});
client.on('queueError', (error: PhalanxError) => {});

// Match lifecycle
client.on('matchFound', (event: MatchFoundEvent) => {});
client.on('countdown', (event: CountdownEvent) => {});
client.on('gameStart', (event: GameStartEvent) => {});
client.on('matchEnd', (event: MatchEndEvent) => {});

// Tick & commands
client.on('tick', (event: TickSyncEvent) => {});
client.on('commands', (event: CommandsBatchEvent) => {});

// Player events
client.on('playerDisconnected', (event: PlayerDisconnectedEvent) => {});
client.on('playerReconnected', (event: PlayerReconnectedEvent) => {});
client.on('playerReady', (event: PlayerReadyEvent) => {});

// Reconnection
client.on('reconnectState', (event: ReconnectStateEvent) => {});
client.on('reconnectStatus', (event: ReconnectStatusEvent) => {});

// Pause/resume
client.on('gamePaused', (event: GamePausedEvent) => {});
client.on('gameResumed', (event: GameResumedEvent) => {});

// Desync
client.on('desync', (event: DesyncEvent) => {});

// All listeners return unsubscribe functions
const unsub = client.on('tick', handler);
unsub();
```

## Client State Machine

```
idle → in-queue → match-found → countdown → playing → finished
                                                ↕
                                             paused
                                                ↕
                                          reconnecting
```

## Exports from phalanx-client

```typescript
// Main client
import { PhalanxClient } from 'phalanx-client';

// Utilities
import {
  EventEmitter,
  RenderLoop,
  SocketManager,
  DeterministicRandom,
  StateHasher,
  DesyncDetector,
} from 'phalanx-client';

// Fixed-point math (re-exported from phalanx-math)
import { FP, FPVector2, FPVector3, FixedPoint } from 'phalanx-client';
import type { FPVector2Interface, FPVector3Interface } from 'phalanx-client';

// Authentication
import { AuthManager, GoogleOAuthAdapter, LocalStorageAdapter, MemoryStorageAdapter } from 'phalanx-client';

// Types — Configuration
import type {
  PhalanxClientConfig, PhalanxAuthConfig, PauseConfig,
  RenderLoopConfig, CommandFlushCallback,
  SocketManagerConfig, SocketManagerCallbacks,
  AuthManagerConfig, AuthStorage,
} from 'phalanx-client';

// Types — Auth
import type {
  AuthAdapter, AuthResult, AuthState, AuthUser, AuthError,
  CallbackParams, LoginOptions,
  GoogleOAuthConfig, DiscordOAuthConfig, SteamAuthConfig, StoredAuthData,
  PhalanxAuthState, PhalanxAuthUser,
} from 'phalanx-client';

// Types — Commands & Handlers
import type {
  PlayerCommand, CommandsBatch,
  TickHandler, FrameHandler, PauseHandler, Unsubscribe,
} from 'phalanx-client';

// Types — Events
import type {
  MatchPlayerInfo, MatchFoundEvent, CountdownEvent,
  GameStartEvent, MatchEndEvent,
  TickSyncEvent, CommandsBatchEvent, QueueStatusEvent,
  PlayerDisconnectedEvent, PlayerReconnectedEvent, PlayerReadyEvent,
  GamePausedEvent, GameResumedEvent,
  ReconnectStateEvent, TickCommandsHistory, ReconnectStatusEvent,
  SubmitCommandsAck, HashComparisonEvent,
  PhalanxError,
} from 'phalanx-client';

// Types — State & Desync
import type {
  ConnectionState, ClientState,
  DesyncConfig, DesyncEvent,
  PhalanxClientEvents,
} from 'phalanx-client';
```

## Common Patterns

### Minimal Client

```typescript
const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
});

client.onTick((tick, commands) => { /* simulation */ });
client.onFrame((alpha, dt) => { /* render */ });

await client.joinQueue();
```

### Full Game Client with GameWorld

See section 7 above for the complete GameWorld integration pattern. This is the recommended approach for games using phalanx-ecs.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| Connection timeout | Check server URL. Use `http://` for dev, `wss://` for production TLS. |
| `tickRate` mismatch | Client tickRate must match server. Default is 20. |
| Commands not arriving | Ensure you are in `'playing'` state before sending commands. |
| Auth errors | Check that the token is valid and the server has auth enabled. |
| Desync detected | Check deterministic logic: no `Math.random()`, no `Date.now()`, use fixed-point math. |
