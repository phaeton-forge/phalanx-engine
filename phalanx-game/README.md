# @phalanx-engine/game

Game-facing facade for engine 0.3. One package, six subpaths. Fixed-point
math is only on `/math`. The root does not re-export it.

| Subpath      | Import                           | Contents                                               |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| `.`          | `@phalanx-engine/game`           | `@phalanx-engine/runtime` and the explicit ecs surface |
| `/math`      | `@phalanx-engine/game/math`      | `@phalanx-engine/math`                                 |
| `/physics`   | `@phalanx-engine/game/physics`   | `@phalanx-engine/physics`                              |
| `/abilities` | `@phalanx-engine/game/abilities` | `@phalanx-engine/abilities`                            |
| `/advanced`  | `@phalanx-engine/game/advanced`  | `@phalanx-engine/runtime/advanced`                     |
| `/server`    | `@phalanx-engine/game/server`    | `@phalanx-engine/runtime/server`                       |

```ts
import {
  defineComponent,
  defineCommands,
  defineGame,
  runLocalMatch,
} from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';
```

The root re-exports `@phalanx-engine/runtime` (including `MatchStore`,
`MemoryMatchStore`, `IndexedDbMatchStore`, `MatchRunner.resumeLocal`,
`attachDebug`, `AttachDebugOptions`, `DebugAttachment` and
`DebugDataProvider`) and the ecs names games use (`GameWorld`,
`GameSystem`, `Entity`, …).

`StateHelpers`, `spawnWithId`,
`SaveHandler`, `CommandSchema`, `SaveSpec`, `StateMigration`, `WorldScope`,
`setEntityIdCounter`, `nextEntityId`, `PoolManager`,
`SoAComponentStore`, `TickFrameManager`, `TickFrameManagerConfig`,
`TYPED_ARRAY_CONSTRUCTORS`, `DebugPanel` and `DebugPanelConfig` are
`@phalanx-engine/game/advanced`, along with the transport port types
`Transport`, `TransportKind`, `TransportJoin`, `TransportCatchUp`,
`CommandEnvelope` and `TransportCommand`.

`createServerSim`, `ServerSimConfig` and `GameModuleSpec` are
`@phalanx-engine/game/server`:

```ts
import { createServerSim } from '@phalanx-engine/game/server';

new Phalanx({
  sim: createServerSim({ games: [{ module: './myGame.js' }] }),
});
```

`InterpolatedTransformSample` is `@phalanx-engine/game/physics`.
