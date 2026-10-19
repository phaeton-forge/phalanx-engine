# @phalanx-engine/game

Game-facing facade for engine 0.3. One package, five subpaths. Fixed-point
math is only on `/math`. The root does not re-export it.

| Subpath      | Import                           | Contents                                               |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| `.`          | `@phalanx-engine/game`           | `@phalanx-engine/runtime` and the explicit ecs surface |
| `/math`      | `@phalanx-engine/game/math`      | `@phalanx-engine/math`                                 |
| `/physics`   | `@phalanx-engine/game/physics`   | `@phalanx-engine/physics`                              |
| `/abilities` | `@phalanx-engine/game/abilities` | `@phalanx-engine/abilities`                            |
| `/advanced`  | `@phalanx-engine/game/advanced`  | `@phalanx-engine/runtime/advanced`                     |

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
`MemoryMatchStore`, `IndexedDbMatchStore` and `MatchRunner.resumeLocal`)
and the ecs names games use (`GameWorld`, `GameSystem`, `Entity`, …).

`StateHelpers`, `spawnWithId`, `rebuildBroadphaseFromTransforms`,
`SaveHandler`, `CommandSchema`, `SaveSpec`, `StateMigration`, `WorldScope`,
`setWorldModuleHost`, `setEntityIdCounter`, `nextEntityId`, `PoolManager`,
`SoAComponentStore`, `TickFrameManager`, `TickFrameManagerConfig`,
`TYPED_ARRAY_CONSTRUCTORS`, `DebugPanel` and `DebugPanelConfig` are
`@phalanx-engine/game/advanced`.

`InterpolatedTransformSample` is `@phalanx-engine/game/physics`.
