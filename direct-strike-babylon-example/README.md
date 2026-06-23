# Babylon RTS Demo

A real-time strategy (RTS) game demo built with [Babylon.js](https://www.babylonjs.com/) and TypeScript, showcasing Entity-Component-System (ECS) architecture principles.

## Features

- **3D RTS Gameplay**: Move units, attack enemies, and defend with towers
- **Two Teams**: Player team (Blue/Team1) vs Enemy team (Red/Team2)
- **Combat System**: Units and towers automatically attack enemies in range
- **Projectile System**: Visual projectiles with hit detection
- **Selection System**: Click to select units, right-click to move
- **Health System**: Entities take damage and can be destroyed
- **Multiplayer**: 1v1 deterministic lockstep via Phalanx Engine
- **Desync Detection**: State hash verification to ensure synchronized gameplay
- **Fixed-Point Math**: All simulation uses deterministic fixed-point arithmetic via `phalanx-math` for cross-platform consistency

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [pnpm](https://pnpm.io/) package manager

### Installation

```bash
# Clone the repository (if applicable)
git clone <repository-url>
cd babylon-ecs

# Install dependencies
pnpm install
```

### Development

Start the development server with hot reload:

```bash
pnpm dev
```

The game will be available at `http://localhost:5173` (default Vite port).

#### Access from Mobile Devices

The dev server is configured to be accessible from your local network. After running `pnpm dev`, you'll see output like:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
```

Use the **Network** URL to access the game from your mobile device. Make sure:

1. Your mobile device is on the same WiFi network as your development machine
2. Your firewall allows incoming connections on port 5173
3. You use the IP address shown in the terminal output

### Environment Configuration

The game server URL is configured via environment variables:

- **`.env`** - Default configuration (committed to git, points to production Heroku server)
- **`.env.local`** - Local overrides (not committed to git)

To use a local development server, create a `.env.local` file:

```bash
# .env.local
VITE_SERVER_URL=http://localhost:3000
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Available environment variables:

| Variable                | Description                     | Default                 |
| ----------------------- | ------------------------------- | ----------------------- |
| `VITE_SERVER_URL`       | Phalanx game server URL         | `http://localhost:3000` |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID for auth | (none - auth disabled)  |

### Authentication Setup

To enable Google Sign-In authentication:

1. **Create a Google OAuth Client ID**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create a new OAuth 2.0 Client ID
   - Set Application type to "Web application"
   - Add Authorized JavaScript origins:
     - `http://localhost:5173` (for development)
     - Your production domain
   - Add Authorized redirect URIs (same as origins):
     - `http://localhost:5173`
     - Your production domain
   - Copy both the **Client ID** and **Client Secret**

2. **Configure the client** (babylon-ecs):
   - Create `.env.local` with:
     ```bash
     VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     VITE_SERVER_URL=http://localhost:3000
     ```

3. **Configure the server** (e.g. `chapaev/server` or your own Phalanx server):
   - Create `.env` with:
     ```bash
     GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=your-client-secret
     ```
   - The client ID must match between client and server
   - The client secret is kept secure on the server (never exposed to browser)

**How it works:**
1. User clicks "Sign in with Google" → redirected to Google OAuth
2. After sign-in, Google redirects back with an authorization code
3. Client sends code to server's `/auth/token` endpoint
4. Server exchanges code for tokens using `client_secret` (secure!)
5. Client receives ID token and uses it for game authentication

When authentication is enabled:
- Users see "Sign in with Google" button in the lobby
- After signing in, "Find Game" button appears
- JWT tokens are sent to the server with WebSocket connections

### Build for Production

```bash
pnpm build:local
```

This compiles TypeScript and builds optimized assets into the `dist/` folder.

> **Note:** This package is excluded from the root `pnpm build` until it is migrated to the new phalanx-physics transform API. Use `pnpm build:local` here, or `pnpm build:direct-strike` from the repo root.

### Preview Production Build

```bash
pnpm preview
```

## Controls

| Action              | Input                      |
| ------------------- | -------------------------- |
| Select Unit         | Left-click on unit         |
| Move Selected Units | Right-click on ground      |
| Deselect            | Left-click on empty ground |

## Tech Stack

- **[Babylon.js](https://www.babylonjs.com/)** (v8.45) - 3D rendering engine
- **[TypeScript](https://www.typescriptlang.org/)** (v5.9) - Type-safe JavaScript
- **[Vite](https://vitejs.dev/)** (v7.2) - Fast build tool and dev server
- **[phalanx-math](../phalanx-math)** - Deterministic fixed-point math for lockstep synchronization

## Project Structure

```
src/
├── main.ts                    # Application entry point
├── core/                      # Core game infrastructure
│   ├── Game.ts                # Main orchestrator (thin coordinator)
│   ├── GameInitializer.ts     # World setup and entity creation
│   ├── GameEventCoordinator.ts # Game event subscriptions
│   ├── EntityCleanupService.ts # Entity destruction cleanup
│   ├── EntityFactory.ts       # Entity creation with ownership
│   ├── AssetManager.ts        # Asset preloading and management
│   ├── LockstepManager.ts     # Deterministic simulation sync
│   ├── NetworkCommands.ts     # Network command definitions
│   ├── UIManager.ts           # UI interactions and updates
│   ├── MathConversions.ts     # Fixed-point ↔ Babylon.js conversions
│   ├── SceneManager.ts        # Babylon.js scene setup
│   ├── ModelLoader.ts         # Utility for loading 3D models
│   └── GameRandom.ts          # Seeded random number generator
├── entities/                  # Game entities (Units, Towers, Bases)
├── components/                # ECS components (Health, Attack, Movement, etc.)
├── systems/                   # ECS systems (extend GameSystem from phalanx-ecs)
├── events/                    # Event types and constants
├── effects/                   # Visual effects (Explosions, Blood)
├── enums/                     # Enumerations (TeamTag)
├── visuals/                   # 3D model assets
└── interfaces/                # TypeScript interfaces
```

## Architecture

This project follows an **Entity-Component-System (ECS)** architecture pattern with **Single Responsibility Principle (SRP)** for core classes:

- **Entities** are containers that hold components (Unit, Tower, Base, PrismaUnit, LanceUnit, MutantUnit)
- **Components** are pure data containers (HealthComponent, AttackComponent, etc.)
- **Systems** extend `GameSystem` base class from `phalanx-ecs` and contain game logic
- **Game** acts as a thin orchestrator, delegating to specialized coordinator classes

For detailed architecture documentation and development guidelines, see [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md).

## License

This project is private and intended for demonstration purposes.
