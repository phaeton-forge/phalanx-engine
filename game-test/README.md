# Phalanx Test Game

A simple multiplayer game to test the Phalanx Engine using Babylon.js.

## Game Description

- **Lobby Scene**: Players enter their username and wait for matchmaking to find an opponent
- **Game Scene**: A 2m x 4m ground where players control spheres by clicking to issue move commands

## Authentication

This test game uses **anonymous authentication** - no OAuth or external login required:

- Players simply enter a username in the lobby
- No Google/Discord/Steam login buttons
- Server accepts connections without auth tokens
- Ideal for quick testing and development

To enable OAuth authentication in production, see the [phalanx-client authentication docs](../phalanx-client/README.md).

## Features

- Fixed timestep game loop using accumulator algorithm
- Network synchronization via Phalanx Engine
- Smooth interpolation for rendering
- 1v1 matchmaking
- Exit button to leave the game
- Warning when trying to reload the page during a game
- Notifications when other player disconnects/leaves

## How Phalanx Engine is Used

This test game demonstrates the **deterministic lockstep** multiplayer architecture provided by Phalanx Engine. Here's how it's integrated:

### 1. **Client-Server Architecture**

#### Server Setup (`src/server/main.ts`)

The Phalanx server is configured for 1v1 matchmaking:

- **Port**: 3000
- **Game Mode**: '1v1'
- **Tick Rate**: 20 ticks/second
- **Countdown**: 5 seconds before game starts

#### Client Connection (`LobbyScene.ts`)

The `PhalanxClient` handles:

- **Connection**: Creates client and connects to the server with unique player ID and username via `PhalanxClient.create()`
- **Matchmaking**: Joins the queue and waits for an opponent
- **Match Events**: Listens for `matchFound` and `countdown` events

### 2. **Deterministic Lockstep Synchronization**

The game uses Phalanx Engine's lockstep system to ensure all clients see the same game state:

#### Command Submission (`GameScene.ts`)

When a player clicks on the ground:

1. A `MoveCommand` is created with target coordinates
2. Command is sent to the server via `client.sendCommand('move', data)`
3. Server queues and broadcasts the command to all clients at the next tick

#### Command Batch Processing

The game uses the simplified `onTick` API. Every tick, the client invokes the registered tick handler with:

- Commands from ALL players for that tick
- Tick number for synchronization

#### Deterministic Simulation (`GameSimulation.ts`)

- Receives commands from `commands-batch` event
- Applies commands in a deterministic order (sorted by player ID)
- Updates game state identically on all clients
- No physics randomness - pure deterministic logic

### 3. **Fixed Timestep Game Loop**

The `GameLoop.ts` implements the **accumulator algorithm**:

```
Frame Time Accumulation:
  accumulator += deltaTime

Fixed Updates (50ms per tick):
  while (accumulator >= FIXED_TIMESTEP)
    - Apply network commands
    - Update simulation
    - accumulator -= FIXED_TIMESTEP

Rendering with Interpolation:
  alpha = accumulator / FIXED_TIMESTEP
  Interpolate between previous and current positions
```

This ensures:

- ✅ Simulation runs at consistent 20 ticks/sec regardless of FPS
- ✅ Smooth visual rendering even if frame rate varies
- ✅ Network and simulation stay in sync

### 4. **Network Event Flow**

```
Player Action (Click)
  ↓
Submit Command to Server
  ↓
Server Queues Command for Next Tick
  ↓
Server Broadcasts commands-batch at tick N
  ↓
All Clients Receive Same Commands
  ↓
All Clients Apply Commands Deterministically
  ↓
Game State Synchronized Across All Clients
```

### 5. **Event Handling**

The client listens to Phalanx Engine events:

| Event                 | Handler                | Purpose                        |
| --------------------- | ---------------------- | ------------------------------ |
| `matchFound`          | LobbyScene             | Match details and player list  |
| `countdown`           | LobbyScene             | Countdown before game starts   |
| `gameStart`           | LobbyScene → GameScene | Transition to game             |
| `onTick` handler      | GameScene              | Tick commands from all players |
| `matchEnd`            | GameScene              | Handle match ending            |

### 6. **Key Integration Points**

#### Connection Flow

```typescript
const client = await PhalanxClient.create({
  serverUrl: SERVER_URL,
  playerId: uniqueId,
  username: playerName,
});

const match = await client.joinQueueAndWaitForMatch();
```

#### Command Submission

```typescript
client.sendCommand('move', {
  targetX: x,
  targetZ: z,
});
```

#### Receiving Synchronized Commands

```typescript
client.onTick((tick, commands) => {
  // All players' commands for this tick
  for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
    for (const cmd of playerCommands) {
      simulation.processCommand(playerId, cmd);
    }
  }
  simulation.step();
});
```

### 7. **Why This Architecture Works**

**Traditional Approach (Server Authority):**

- Client sends input → Server simulates → Server sends positions
- High latency, server bottleneck, bandwidth intensive

**Phalanx Lockstep Approach:**

- Client sends input → Server broadcasts input → All clients simulate
- Low latency, minimal bandwidth, scalable
- Perfect for RTS, turn-based, and strategy games

**Trade-offs:**

- ✅ Minimal network traffic (only commands, not game state)
- ✅ No server-side simulation needed
- ✅ Clients can predict and rollback if needed
- ⚠️ Requires deterministic game logic
- ⚠️ All clients must wait for slowest client's commands

## Setup

1. Build the Phalanx packages first:

   ```bash
   # From the root phalanx-engine folder
   pnpm install
   pnpm build
   ```

2. Install game dependencies:
   ```bash
   cd game-test
   pnpm install
   ```

## Running

Start the server:

```bash
pnpm run server
```

In a separate terminal, start the client:

```bash
pnpm run dev
```

Open two browser windows at `http://localhost:3001` to test multiplayer.

**Or use the root commands:**

```bash
# From the root phalanx-engine folder
pnpm dev:game    # Starts the Vite dev server
```

Then run the server separately:

```bash
pnpm --filter game-test server
```

## Controls

- **Left Click** on the ground to move your unit
- **Exit** button to leave the game and return to lobby

## Important Notes

- **Page Reload Warning**: If you try to reload or close the page during a game, you'll see a warning "You will be kicked out of the game!"
- **Other Player Notifications**: When another player leaves (by reload, closing the tab, or clicking Exit), you'll see a notification and be returned to the lobby

## Architecture

- `src/main.ts` - Client entry point
- `src/scenes/LobbyScene.ts` - Connection and matchmaking UI
- `src/scenes/GameScene.ts` - Babylon.js game rendering with notifications
- `src/game/GameLoop.ts` - Fixed timestep loop with accumulator
- `src/game/GameSimulation.ts` - Deterministic game logic
- `src/game/Unit.ts` - Unit movement logic
- `src/server/main.ts` - Phalanx server configuration
