# Phalanx Client

Client library for [Phalanx Engine](../README.md) - a game-agnostic deterministic lockstep multiplayer engine.

## Installation

```bash
npm install phalanx-client
```

## Quick Start

```typescript
import { PhalanxClient } from 'phalanx-client';

// Create and connect client
const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'MyPlayer',
});

// Subscribe to match events
client.on('matchFound', (match) => {
  console.log(`Match found: ${match.matchId}`);
});

client.on('countdown', (event) => {
  console.log(`Starting in ${event.seconds}...`);
});

client.on('gameStart', () => {
  console.log('Game started!');
});

// Join matchmaking queue
await client.joinQueue();

// --- SIMPLIFIED GAME LOOP API ---

// Register tick handler - called for each server tick with all player commands
client.onTick((tick, commands) => {
  // Process commands from all players
  for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
    for (const cmd of playerCommands) {
      processCommand(playerId, cmd);
    }
  }
  // Run deterministic simulation
  simulation.step();
});

// Register frame handler - called every animation frame (~60fps)
client.onFrame((alpha, dt) => {
  // Interpolate positions for smooth rendering
  for (const entity of entities) {
    entity.position = lerp(entity.prevPosition, entity.currPosition, alpha);
  }
  // Render the scene
  renderer.render();
});

// Send commands - automatically batched and sent each frame
client.sendCommand('move', { targetX: 10, targetZ: 20 });

// Disconnect when done
await client.destroy();
```

## API Reference

### Configuration

```typescript
interface PhalanxClientConfig {
  serverUrl: string; // Server URL (e.g., 'http://localhost:3000')
  playerId: string; // Unique player identifier
  username: string; // Display name
  autoReconnect?: boolean; // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts?: number; // Max reconnection attempts (default: 5)
  reconnectDelayMs?: number; // Delay between attempts (default: 1000)
  connectionTimeoutMs?: number; // Connection timeout (default: 10000)
  tickRate?: number; // Ticks per second, must match server (default: 20)
  debug?: boolean; // Enable debug logging (default: false)
}
```

### Connection

```typescript
// Recommended: Create and connect in one step
const client = await PhalanxClient.create({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'MyPlayer',
});

// Alternative: Manual connection
const client = new PhalanxClient(config);
await client.connect();

// Disconnect (stops render loop, clears handlers)
client.disconnect();

// Destroy (disconnect + cleanup all resources)
await client.destroy();

// Check connection status
const connected = client.isConnected();

// Get connection state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
const state = client.getConnectionState();
```

### Matchmaking

```typescript
// Join queue
const status = await client.joinQueue();

// Leave queue
client.leaveQueue();

// Wait for match
const match = await client.waitForMatch();

// Or combine both:
const match = await client.joinQueueAndWaitForMatch();
```

### Game Lifecycle

```typescript
// Wait for countdown
await client.waitForCountdown((event) => {
  console.log(`${event.seconds} seconds remaining`);
});

// Wait for game start
const gameStart = await client.waitForGameStart();

// After loading assets and initializing game systems, report ready.
// The server will not start the tick loop until ALL clients call sendReady().
await loadAssets();
initializeGameWorld();
client.sendReady();
```

#### sendReady(): void

Notify the server that this client has finished loading and is ready to receive ticks. **Must** be called after assets are loaded and game systems are initialized. The server will not start the tick loop until all clients report ready.

```typescript
// Example: in your game-start handler
client.on('gameStart', async () => {
  await game.initialize(); // downloads assets, sets up ECS
  client.sendReady();       // signals server to start tick loop
});
```

### Commands

```typescript
// Submit commands with acknowledgment
const ack = await client.submitCommands(tick, [
  { type: 'move', data: { x: 10, y: 20 } },
  { type: 'attack', data: { targetId: 'enemy1' } },
]);

// Submit commands without waiting for ack (fire and forget)
client.submitCommandsAsync(tick, commands);
```

### Simplified Game Loop API (Recommended)

The `onTick` and `onFrame` methods provide a simplified API for building game loops. They handle timing, command batching, and interpolation automatically.

#### onTick(handler): Unsubscribe

Register a callback for simulation ticks. Called when the server sends a tick with commands from all players.

```typescript
const unsubscribe = client.onTick((tick, commands) => {
  // tick: current tick number
  // commands: { tick, commands: { [playerId]: PlayerCommand[] } }

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

// Later: stop receiving tick events
unsubscribe();
```

#### onFrame(handler): Unsubscribe

Register a callback for render frames. Called every animation frame (~60fps) with interpolation alpha for smooth rendering. The render loop starts automatically when the first handler is registered.

```typescript
const unsubscribe = client.onFrame((alpha, dt) => {
  // alpha: interpolation value 0-1 (progress between ticks)
  // dt: delta time in seconds since last frame

  // Interpolate entity positions for smooth visuals
  for (const entity of entities) {
    entity.mesh.position.x = lerp(entity.prevX, entity.currX, alpha);
    entity.mesh.position.z = lerp(entity.prevZ, entity.currZ, alpha);
  }

  // Render the scene
  scene.render();
});

// Later: stop receiving frame events (render loop stops when no handlers remain)
unsubscribe();
```

#### sendCommand(type, data): void

Queue a command to be sent to the server. Commands are automatically batched and sent each frame.

```typescript
// Send movement command
client.sendCommand('move', { targetX: 10, targetZ: 20 });

// Send attack command
client.sendCommand('attack', { targetId: 'enemy-123' });

// Commands are automatically flushed to the server each frame
```

#### Interpolation Explained

The `alpha` value in `onFrame` represents how far we are between the last tick and the next expected tick:

- `alpha = 0`: Render at the position from the last received tick
- `alpha = 0.5`: Render halfway between last tick and expected next tick
- `alpha = 1`: Render at the expected next tick position

This allows smooth 60fps rendering even though the server only sends 20 ticks per second.

### Reconnection

```typescript
// Manual reconnection to a match
const state = await client.reconnectToMatch(matchId);

// Automatic reconnection with retries
await client.attemptReconnection();
```

### Desync Detection

Desync detection helps identify when game state diverges between clients. This is critical for deterministic lockstep games where all clients must maintain identical simulation state.

#### How It Works

1. **Game computes state hashes** at regular intervals (e.g., every 20 ticks)
2. **Client submits hashes** to the server via `submitStateHash()`
3. **Server compares hashes** from all clients
4. **Server broadcasts results** to all clients
5. **Client emits `desync` event** if hashes don't match

#### Submitting State Hashes

```typescript
import { PhalanxClient, StateHasher } from 'phalanx-client';

// In your tick handler
client.onTick((tick, commands) => {
  // Run simulation
  simulation.processTick(tick, commands);

  // Submit state hash every 20 ticks (once per second at 20 TPS)
  if (tick % 20 === 0) {
    const hash = computeStateHash(tick);
    client.submitStateHash(tick, hash);
  }
});
```

#### Using StateHasher

The `StateHasher` utility provides a deterministic FNV-1a hash implementation:

```typescript
import { StateHasher } from 'phalanx-client';

function computeStateHash(tick: number): string {
  const hasher = new StateHasher();

  // Add tick number
  hasher.addInt(tick);

  // Add entity data (sorted by ID for determinism)
  const sortedEntities = [...entities].sort((a, b) => a.id.localeCompare(b.id));
  hasher.addInt(sortedEntities.length);

  for (const entity of sortedEntities) {
    hasher.addString(entity.id);
    hasher.addFloat(entity.x);
    hasher.addFloat(entity.y);
    hasher.addFloat(entity.z);
    hasher.addInt(entity.health);
    hasher.addString(entity.state);
  }

  return hasher.finalize();
}
```

#### StateHasher API

```typescript
const hasher = new StateHasher();

// Add primitive values
hasher.addInt(42);                    // Integer
hasher.addFloat(3.14159);             // Float (converted to fixed-point)
hasher.addString("entity-123");       // String
hasher.addBool(true);                 // Boolean

// Add arrays
hasher.addIntArray([1, 2, 3]);        // Array of integers
hasher.addFloatArray([1.5, 2.5]);     // Array of floats

// Get final hash (8-char hex string)
const hash = hasher.finalize();       // e.g., "a1b2c3d4"

// Reset for reuse
hasher.reset();
```

#### Handling Desync Events

```typescript
// Listen for desync events
client.on('desync', (event) => {
  console.error('Desync detected!');
  console.error(`Tick: ${event.tick}`);
  console.error(`Local hash: ${event.localHash}`);
  console.error(`Remote hashes:`, event.remoteHashes);

  // Options:
  // 1. Log for debugging
  // 2. Show error to players
  // 3. Attempt recovery (rare)
});

// Listen for match end due to desync
client.on('matchEnd', (event) => {
  if (event.reason === 'desync') {
    console.error('Match ended due to desync');
    console.error('Details:', event.details);
    // event.details contains { tick, hashes }
  }
});
```

#### Configuring Desync Detection

```typescript
// Enable/disable desync detection
client.configureDesyncDetection({ enabled: true });

// Limit stored hashes (for memory optimization)
client.configureDesyncDetection({ maxStoredHashes: 50 });
```

#### Server Configuration

The server can be configured to take different actions on desync:

```typescript
// phalanx-server configuration
const phalanx = new Phalanx({
  enableStateHashing: true,
  desync: {
    enabled: true,
    action: 'end-match',      // 'log-only' | 'end-match'
    gracePeriodTicks: 1,      // Consecutive desyncs before action
  },
});
```

| Option             | Description                                        | Default      |
| ------------------ | -------------------------------------------------- | ------------ |
| `enabled`          | Enable desync detection                            | `true`       |
| `action`           | Action on confirmed desync                         | `'end-match'`|
| `gracePeriodTicks` | Consecutive desyncs required before taking action  | `1`          |

#### Testing Desync Detection

To test desync detection during development:

```typescript
// Intentionally cause a desync for testing
client.onTick((tick, commands) => {
  simulation.processTick(tick, commands);

  if (tick % 20 === 0) {
    let hash = computeStateHash(tick);

    // Force desync on a specific tick for testing
    if (tick === 100 && client.getPlayerId() === 'player-1') {
      hash = 'intentionally-wrong-hash';
    }

    client.submitStateHash(tick, hash);
  }
});
```

### State Getters

```typescript
const tick = client.getCurrentTick();
const matchId = client.getMatchId();
const playerId = client.getPlayerId();
const username = client.getUsername();
const clientState = client.getClientState();
```

### Events

```typescript
// Connection events
client.on('connected', () => {});
client.on('disconnected', () => {});
client.on('reconnecting', (attempt) => {});
client.on('reconnectFailed', () => {});
client.on('error', (error) => {});

// Queue events
client.on('queueJoined', (status) => {});
client.on('queueLeft', () => {});
client.on('queueError', (error) => {});

// Match events
client.on('matchFound', (event) => {});
client.on('countdown', (event) => {});
client.on('gameStart', (event) => {});
client.on('matchEnd', (event) => {});

// Tick events
client.on('tick', (event) => {});
client.on('commands', (event) => {});

// Player events
client.on('playerDisconnected', (event) => {});
client.on('playerReconnected', (event) => {});
client.on('playerReady', (event) => {});  // A player reported ready (local or remote)

// Reconnection events
client.on('reconnectState', (event) => {});
client.on('reconnectStatus', (event) => {});

// Desync detection events
client.on('desync', (event) => {});  // Local hash mismatch detected

// Unsubscribe
const unsubscribe = client.on('tick', handler);
unsubscribe();

// Or manual
client.off('tick', handler);

// Remove all listeners
client.removeAllListeners();
```

## Client States

The client tracks its lifecycle state:

| State          | Description                        |
| -------------- | ---------------------------------- |
| `idle`         | Not in queue or match              |
| `in-queue`     | Waiting in matchmaking queue       |
| `match-found`  | Match found, waiting for countdown |
| `countdown`    | Countdown in progress              |
| `playing`      | Game is active                     |
| `reconnecting` | Attempting to reconnect to match   |
| `finished`     | Match has ended                    |


## Example: Complete Game Loop (Simplified API)

```typescript
import { PhalanxClient, type CommandsBatch } from 'phalanx-client';

class GameClient {
  private client: PhalanxClient | null = null;
  private entities: Map<string, Entity> = new Map();
  private unsubscribers: (() => void)[] = [];

  async start(serverUrl: string, playerId: string, username: string): Promise<void> {
    // Create and connect client
    this.client = await PhalanxClient.create({
      serverUrl,
      playerId,
      username,
      autoReconnect: true,
    });

    // Subscribe to match lifecycle events
    this.unsubscribers.push(
      this.client.on('matchFound', (match) => {
        console.log(`Match found: ${match.matchId}`);
        this.initializeEntities(match);
      })
    );

    this.unsubscribers.push(
      this.client.on('gameStart', () => {
        console.log('Game started!');
      })
    );

    this.unsubscribers.push(
      this.client.on('matchEnd', ({ reason }) => {
        console.log(`Match ended: ${reason}`);
        this.stop();
      })
    );

    // Register tick handler - deterministic simulation
    this.unsubscribers.push(
      this.client.onTick((tick, commands) => {
        this.handleTick(tick, commands);
      })
    );

    // Register frame handler - rendering with interpolation
    this.unsubscribers.push(
      this.client.onFrame((alpha, dt) => {
        this.handleFrame(alpha, dt);
      })
    );

    // Join matchmaking queue
    await this.client.joinQueue();
  }

  private initializeEntities(match: MatchFoundEvent): void {
    // Create entities for all players
    const allPlayers = [
      { playerId: match.playerId, username: 'You' },
      ...match.teammates,
      ...match.opponents,
    ];
    for (const player of allPlayers) {
      this.entities.set(player.playerId, new Entity(player.playerId));
    }
  }

  private handleTick(tick: number, commands: CommandsBatch): void {
    // Store previous positions for interpolation
    for (const entity of this.entities.values()) {
      entity.prevX = entity.currX;
      entity.prevZ = entity.currZ;
    }

    // Process commands from all players
    for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
      for (const cmd of playerCommands) {
        this.processCommand(playerId, cmd);
      }
    }

    // Run deterministic simulation step
    this.simulate();
  }

  private handleFrame(alpha: number, dt: number): void {
    // Interpolate entity positions for smooth 60fps rendering
    for (const entity of this.entities.values()) {
      entity.renderX = lerp(entity.prevX, entity.currX, alpha);
      entity.renderZ = lerp(entity.prevZ, entity.currZ, alpha);
    }

    // Render the scene
    renderer.render();
  }

  private processCommand(playerId: string, cmd: PlayerCommand): void {
    const entity = this.entities.get(playerId);
    if (!entity) return;

    if (cmd.type === 'move') {
      entity.targetX = cmd.data.targetX;
      entity.targetZ = cmd.data.targetZ;
    }
  }

  private simulate(): void {
    // Move entities toward their targets
    for (const entity of this.entities.values()) {
      entity.moveTowardTarget();
    }
  }

  // Call this when player clicks to move
  move(targetX: number, targetZ: number): void {
    this.client?.sendCommand('move', { targetX, targetZ });
  }

  async stop(): Promise<void> {
    // Unsubscribe from all events
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Cleanup client
    await this.client?.destroy();
    this.client = null;
  }
}

// Usage
const game = new GameClient();
await game.start('http://localhost:3000', 'player-1', 'Alice');

// Handle player input
canvas.addEventListener('click', (e) => {
  const worldPos = screenToWorld(e.clientX, e.clientY);
  game.move(worldPos.x, worldPos.z);
});
```

## Example: Legacy Event-Based API

For more control or backward compatibility, you can use the event-based API:

```typescript
import { PhalanxClient, TickSyncEvent, PlayerCommand } from 'phalanx-client';

class LegacyGameClient {
  private client: PhalanxClient;
  private pendingCommands: PlayerCommand[] = [];

  constructor(serverUrl: string, playerId: string, username: string) {
    this.client = new PhalanxClient({
      serverUrl,
      playerId,
      username,
      autoReconnect: true,
    });
  }

  async start(): Promise<void> {
    // Connect and find match
    await this.client.connect();
    await this.client.joinQueueAndWaitForMatch();
    await this.client.waitForGameStart();

    // Setup event handlers
    this.client.on('tick', this.handleTick.bind(this));
    this.client.on('commands', this.handleCommands.bind(this));
    this.client.on('playerDisconnected', ({ playerId }) => {
      console.log(`Player ${playerId} disconnected`);
    });
    this.client.on('matchEnd', ({ reason }) => {
      console.log(`Match ended: ${reason}`);
    });

    // Start your own render loop
    this.startRenderLoop();
  }

  private handleTick(event: TickSyncEvent): void {
    // Submit any pending commands for next tick
    if (this.pendingCommands.length > 0) {
      this.client.submitCommandsAsync(event.tick + 1, this.pendingCommands);
      this.pendingCommands = [];
    }
  }

  private handleCommands(event: { tick: number; commands: PlayerCommand[] }): void {
    // Process commands from all players for deterministic simulation
    for (const command of event.commands) {
      this.processCommand(command);
    }
  }

  private processCommand(command: PlayerCommand): void {
    console.log('Processing command:', command);
  }

  private startRenderLoop(): void {
    const loop = () => {
      // Your rendering logic here
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  addCommand(type: string, data: unknown): void {
    this.pendingCommands.push({ type, data });
  }

  stop(): void {
    this.client.disconnect();
  }
}

// Usage
const game = new GameClient('http://localhost:3000', 'player1', 'Alice');
await game.start();

// Add commands based on player input
game.addCommand('move', { x: 100, y: 200 });
```

## License

MIT
