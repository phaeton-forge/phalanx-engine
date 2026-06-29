# Phalanx Engine

[![npm](https://img.shields.io/npm/v/@phalanx-engine/server)](https://www.npmjs.com/package/@phalanx-engine/server)
[![npm](https://img.shields.io/npm/v/@phalanx-engine/client)](https://www.npmjs.com/package/@phalanx-engine/client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A game-agnostic deterministic lockstep multiplayer engine with authentication, matchmaking, and command synchronization.

## Table of Contents

- [What is Phalanx Engine?](#what-is-phalanx-engine)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Examples](#examples)
- [Packages](#packages)
- [Installation](#installation)
- [Requirements](#requirements)
- [Contributing](#contributing)
- [License](#license)

## What is Phalanx Engine?

Phalanx is a TypeScript multiplayer game engine built around **deterministic lockstep netcode**. The server does not simulate the game world; it only collects player commands, synchronizes them across clients, and enforces match lifecycle rules. Every client runs the exact same deterministic simulation locally, which keeps bandwidth low and game state consistent across platforms.

It is a good fit for RTS, MOBA, tactical, and turn-based games where simulation determinism is more important than hiding latency.

## Features

- **Deterministic Lockstep**: Synchronizes only player commands; game logic runs deterministically on each client.
- **Fixed-Point Math**: Platform-independent fixed-point arithmetic via `@phalanx-engine/math` ensures identical calculations everywhere.
- **Matchmaking**: Built-in support for game modes such as 1v1, 2v2, 3v3, 4v4, and FFA.
- **Private Rooms**: Invite-code rooms with host recovery so players can share links without losing their room.
- **Tick System**: Configurable tick rate with command batching.
- **Game Start Synchronization**: A ready handshake ensures all clients finish loading before the tick loop begins.
- **Reconnection Support**: Players can rejoin matches after disconnecting.
- **Mobile-Friendly Room Recovery**: Opt-in lifecycle recovery for mobile browsers.
- **TypeScript**: Full TypeScript support with exported types.

## Architecture

```
                        ┌─────────────────────────────┐
                        │   @phalanx-engine/server    │
                        │ matchmaking · rooms · ticks │
                        └──────────────┬──────────────┘
                                       │ Socket.IO (commands & events)
                                       ▼
   ┌────────────────────────────┐  ┌──────────────────────────────┐
   │  @phalanx-engine/client    │  │ @phalanx-engine/ecs (opt)    │
   │ connection · matchmaking · │──▶│ EntityManager · GameWorld ·  │
   │ command batching · auth ·  │  │ SoA storage · pooling        │
   │ room recovery · render     │  └────────────────┬─────────────┘
   │ loop (ITickFrameProvider)  │                   │
   └────────────────────────────┘                   ▼
                                       ┌────────────────────────────┐
                                       │ @phalanx-engine/physics    │
                                       │ deterministic FP physics · │
                                       │ spatial hash · collisions  │
                                       └──────────────┬─────────────┘
                                                      │
                        ┌─────────────────────────────┴─────────────────────────────┐
                        ▼                                                           ▼
           ┌────────────────────────────┐                         ┌────────────────────────────┐
           │ @phalanx-engine/abilities  │                         │   @phalanx-engine/math     │
           │ GAS-style attributes ·     │                         │ FP fixed-point arithmetic  │
           │ effects · tags             │                         └────────────────────────────┘
           └────────────────────────────┘
```

`@phalanx-engine/client` and `@phalanx-engine/ecs` both implement the `ITickFrameProvider` interface, so a `GameWorld` can be driven by either an internal `TickFrameManager` (single-player) or by the multiplayer client (`PhalanxClient` is fed the server's authoritative ticks).

## Quick Start

> 🚧 **Coming soon** — a step-by-step quick start guide is in progress.

In the meantime, see the per-package documentation linked below and the [`abilities-playground`](./abilities-playground) example.

## Examples

> 🚧 More examples are coming soon.

| Example                                                            | Status     | Description                          |
| ------------------------------------------------------------------ | ---------- | ------------------------------------ |
| [`abilities-playground`](./abilities-playground)                   | Available  | Local sandbox for the ability system |
| [`direct-strike-babylon-example`](./direct-strike-babylon-example) | Deprecated | Will be removed in a future release  |

## Packages

This repository is a pnpm workspace containing the following publishable packages:

| Package                                          | Description                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [@phalanx-engine/server](./phalanx-server)       | Server library for hosting multiplayer games (matchmaking, lockstep, rooms) |
| [@phalanx-engine/client](./phalanx-client)       | Browser/Node client for connecting to Phalanx servers                       |
| [@phalanx-engine/ecs](./phalanx-ecs)             | Renderer-agnostic ECS library with `GameWorld` facade and SoA storage       |
| [@phalanx-engine/physics](./phalanx-physics)     | Deterministic fixed-point physics (spatial hash, narrow phase, impulses)    |
| [@phalanx-engine/abilities](./phalanx-abilities) | Deterministic gameplay ability system (attributes, effects, tags)           |
| [@phalanx-engine/math](./phalanx-math)           | Deterministic fixed-point math library for lockstep games                   |

## Installation

### From npm

Install the packages your project needs:

```bash
npm install @phalanx-engine/server @phalanx-engine/client
```

Optional simulation packages:

```bash
npm install @phalanx-engine/ecs @phalanx-engine/physics @phalanx-engine/abilities @phalanx-engine/math
```

### From source

```bash
git clone https://github.com/phaeton-forge/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm build
```

When working inside the monorepo, packages are linked automatically via `workspace:*`.

## Requirements

- Node.js `>= 24.0.0`

## Contributing

Contributions are welcome. Please open an issue or pull request on [GitHub](https://github.com/phaeton-forge/phalanx-engine).

Before submitting a change:

1. Run `pnpm install` and `pnpm build` to ensure the workspace builds.
2. Run `pnpm test` to make sure all tests pass.
3. Run `pnpm lint` and `pnpm format:check` to verify code style.

## License

MIT
