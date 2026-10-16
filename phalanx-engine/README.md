# @phalanx-engine/engine

Game-facing facade for engine 0.3. Import this package from a game:

```ts
import {
  defineComponent,
  defineCommands,
  defineGame,
  runLocalMatch,
} from '@phalanx-engine/engine';
```

It re-exports `@phalanx-engine/runtime`, `@phalanx-engine/ecs`,
`@phalanx-engine/abilities`, `@phalanx-engine/physics` and
`@phalanx-engine/math`.

`StateHelpers`, `spawnWithId`, `SaveHandler`, `CommandSchema` and
`WorldScope` are not included. Those live in
`@phalanx-engine/runtime/advanced`.
