# @phalanx-engine/math

Fixed-point math for Phalanx. JavaScript `number` is IEEE-754, and two
CPUs can disagree on the last bit. Lockstep cannot afford that. Every
simulation value in Phalanx is a `FixedPoint`: an integer with a fixed
scale of 5 decimal places, so the same operations produce the same bits
everywhere.

```bash
pnpm add @phalanx-engine/math
```

Games import it as `@phalanx-engine/game/math`. The package wraps
`@hastom/fixed-point` in a small, Unity-style surface: `FP`, vectors,
quaternions, and the match RNG.

## A tick's worth of math

```ts
import {
  DeterministicRandom,
  FP,
  FPQuaternion,
  FPVector2,
  FPVector3,
} from '@phalanx-engine/math';

const speed = FP.FromFloat(5.5);
const step = FP.Mul(speed, FP.FromFloat(0.05));
const velocity = FPVector2.FromFloat(3, 4);
const length = FPVector2.Magnitude(velocity);

const position = FPVector3.FromFloat(10, 0, 20);
const target = FPVector3.FromFloat(15, 0, 25);
const dist = FPVector3.Distance(position, target);

const yaw = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.PiOver2);
const facing = FPQuaternion.RotateVector(yaw, FPVector3.Forward);

const rng = new DeterministicRandom(12345);
const damage = rng.intRange(10, 20);
const saved = rng.getState();
rng.setState(saved);
```

`FP.ToFloat`, `FPVector3.ToFloat`, and `FPQuaternion.ToFloat` are for the
frame. A float that came from them must not be written back into
simulation state. On the tick, `FP.ToInt` truncates with integer
arithmetic.

`FP.FromFloat` parses `toFixed(5)`. Hoist it to module scope. Do not call
it per entity.

`FP.Div` throws on a zero denominator. Guard it.

SoA columns store the raw integer: write `FP.ToRaw(fp)`, read
`FP.FromRaw(raw)`.

## FP

Creation: `FromFloat`, `FromString`, `FromInt`, `ToFloat`, `ToInt`,
`ToRaw`, `FromRaw`.

Constants: `FP._0`, `FP._1`, `FP.Pi`, `FP.Pi2`, `FP.PiOver2`. Use these.
Do not rebuild them.

Arithmetic: `Add`, `Sub`, `Mul`, `Div`, `Neg`.

Functions: `Sqrt`, `Abs`, `Floor`, `Ceil`, `Round`, `Min`, `Max`,
`Clamp`, `Lerp`.

Compare with `Eq`, `Lt`, `Lte`, `Gt`, `Gte`. Tests should use these, not
`toBeCloseTo`, on values that are still fixed-point.

Trigonometry: `Sin`, `Cos`, `Atan2`, and `Acos` (input clamped to
`[-1, 1]`, result in `[0, π]`).

A zero-length vector or a zero quaternion returns a safe fallback
(`FPQuaternion.Identity()` or a zero vector). Helpers do not return
`NaN` and do not throw on degenerate geometry.

## FPVector2 and FPVector3

`Create` from fixed-point components, `FromFloat` from numbers.
Constants: `Zero`, `One`, and the axis directions (`Up`, `Right`, and
`Forward` on `FPVector3`).

`Add`, `Sub`, `Scale`, `Magnitude`, `SqrMagnitude`, `Normalize`, `Dot`,
`Distance`, `SqrDistance`, `Lerp`. `FPVector3` also has `Cross`.
`ToFloat` is presentation.

Squared distances use the `Sq` suffix (`SqrMagnitude`, `SqrDistance`) so
a hot loop can skip the square root.

## FPQuaternion

Stored as `(x, y, z, w)` with `w` scalar. Euler conversions use XYZ
order, matching Unity, and stay in fixed-point. The interface is also
exported as `FPQuaternionInterface`.

- `Identity()`, `Create`, `FromFloat`
- `FromAxisAngle(axis, angleRadians)` — `axis` is the caller's unit vector
- `LookRotation(forward, up?)` — `Identity()` when the inputs are degenerate
- `FromEulerXYZ` / `ToEulerXYZ` — pitch sine is clamped to `[-1, 1]`
- `Mul` (Hamilton product: `b` applies first), `Dot`, `Magnitude`,
  `SqrMagnitude`, `Normalize`, `Conjugate`, `Inverse`
- `Slerp(a, b, t)` along the shortest arc
- `RotateVector(q, v)`
- `ToFloat` for the renderer

## DeterministicRandom

The match RNG is `xoroshiro128plus`. Construct it from
`PhalanxClient.randomSeed` or from the runtime config seed, and pass it
as `GameWorldConfig.random`.

```ts
const rng = new DeterministicRandom(seed);
rng.int(6); // 0..5
rng.intRange(1, 6); // inclusive

const state = rng.getState(); // four safe integers, draws nothing
const continued = DeterministicRandom.fromState(state);
rng.setState(state);
```

`getState` does not draw. `fromState` and `setState` continue the same
sequence. Snapshots store these four words.

Simulation code uses `int` and `intRange` only. `float`, `floatRange`,
and `boolean` still compile and are deprecated. `getGenerator` and
`setGenerator` are deprecated in favour of `getState`, `setState`, and
`fromState`.

## License

MIT
