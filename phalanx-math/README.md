# Phalanx Math

Deterministic fixed-point math library for Phalanx Engine. Ensures identical calculations across all platforms and hardware for lockstep multiplayer games.

## Overview

This library wraps `@hastom/fixed-point` to provide a Unity/Quantum-style API for deterministic arithmetic. All clients using the same operations will produce identical results, preventing desync in lockstep multiplayer games.

## Installation

```bash
pnpm add @phalanx-engine/math
```

## Usage

```typescript
import { FP, FPVector2, FPVector3, FPQuaternion } from '@phalanx-engine/math';

// Create fixed-point numbers
const speed = FP.FromFloat(5.5);
const deltaTime = FP.FromFloat(0.016);

// Arithmetic operations
const distance = FP.Mul(speed, deltaTime);

// 2D vectors
const velocity = FPVector2.FromFloat(3, 4);
const length = FPVector2.Magnitude(velocity); // 5

// 3D positions (for game entities)
const position = FPVector3.FromFloat(10, 0, 20);
const target = FPVector3.FromFloat(15, 0, 25);
const dist = FPVector3.Distance(position, target);

// Quaternion rotations (deterministic, XYZ Euler order)
const yaw = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.PiOver2); // 90° around +Y
const facing = FPQuaternion.RotateVector(yaw, FPVector3.Forward); // rotate a direction
const blended = FPQuaternion.Slerp(
  FPQuaternion.Identity(),
  yaw,
  FP.FromFloat(0.5)
);

// Convert back to numbers for rendering
console.log(FP.ToFloat(dist));
console.log(FPQuaternion.ToFloat(blended)); // { x, y, z, w }
```

## API

### FP

Unified namespace for fixed-point operations (Unity/Quantum style):

#### Creation

- `FP.FromFloat(value: number)` - Create from JavaScript number
- `FP.FromString(value: string)` - Create from string representation
- `FP.FromInt(value: number | bigint)` - Create from integer
- `FP.ToFloat(fp: FixedPoint)` - Convert back to JavaScript number (**presentation only** — never use on the tick path to derive simulation state; see `ToInt` for the deterministic alternative)
- `FP.ToInt(fp: FixedPoint)` - Truncate to an integer as a plain JS number, via raw bigint division — **no float round-trip**. The FP-native inverse of `FromInt` and the deterministic replacement for `Math.trunc(FP.ToFloat(fp))`. Use it on the tick path when a simulation value (ability level, count, index) must drive a branch or table lookup. Assumes default precision (10^5); for custom precision, scale `FP.ToRaw` manually.

#### Constants

- `FP._0`, `FP._1` - Zero and One (Quantum naming)
- `FP.Pi`, `FP.Pi2`, `FP.PiOver2` - Pi constants

#### Arithmetic

- `FP.Add`, `FP.Sub`, `FP.Mul`, `FP.Div`, `FP.Neg` - Basic arithmetic

#### Math Functions

- `FP.Sqrt`, `FP.Abs` - Unary operations
- `FP.Floor`, `FP.Ceil`, `FP.Round` - Rounding
- `FP.Min`, `FP.Max`, `FP.Clamp` - Range operations
- `FP.Lerp` - Linear interpolation

#### Comparison

- `FP.Eq`, `FP.Lt`, `FP.Lte`, `FP.Gt`, `FP.Gte` - Comparisons

#### Trigonometry

- `FP.Sin`, `FP.Cos`, `FP.Atan2` - Deterministic approximations
- `FP.Acos` - Arccosine via the `atan2` identity; input clamped to `[-1, 1]`, returns radians in `[0, PI]`

### FPVector2

2D vector operations for game logic:

#### Creation

- `FPVector2.Create(x, y)` - Create from FixedPoint values
- `FPVector2.FromFloat(x, y)` - Create from numbers

#### Constants

- `FPVector2.Zero`, `FPVector2.One` - Common vectors
- `FPVector2.Up`, `FPVector2.Right` - Direction vectors

#### Operations

- `FPVector2.Add`, `FPVector2.Sub`, `FPVector2.Scale` - Vector arithmetic
- `FPVector2.Magnitude`, `FPVector2.SqrMagnitude` - Length (Unity naming)
- `FPVector2.Normalize`, `FPVector2.Dot` - Geometric operations
- `FPVector2.Distance`, `FPVector2.SqrDistance` - Distance calculations
- `FPVector2.Lerp` - Interpolation
- `FPVector2.ToFloat` - Convert for rendering

### FPVector3

3D vector operations for entity positions:

#### Creation

- `FPVector3.Create(x, y, z)` - Create from FixedPoint values
- `FPVector3.FromFloat(x, y, z)` - Create from numbers

#### Constants

- `FPVector3.Zero`, `FPVector3.One` - Common vectors
- `FPVector3.Up`, `FPVector3.Right`, `FPVector3.Forward` - Direction vectors

#### Operations

- `FPVector3.Add`, `FPVector3.Sub`, `FPVector3.Scale` - Vector arithmetic
- `FPVector3.Magnitude`, `FPVector3.SqrMagnitude` - Length (Unity naming)
- `FPVector3.Normalize`, `FPVector3.Dot`, `FPVector3.Cross` - Geometric operations
- `FPVector3.Distance`, `FPVector3.SqrDistance` - Distance calculations
- `FPVector3.Lerp` - Interpolation
- `FPVector3.ToFloat` - Convert for rendering

### FPQuaternion

Deterministic fixed-point quaternion for entity rotations. Stored in `(x, y, z, w)` order where `w` is the scalar component. All conversions use the XYZ Euler order (matching Unity's `Transform`), with intermediate math kept in `FixedPoint` for lockstep determinism. The `FPQuaternion` type/interface is also exported as `FPQuaternionInterface`.

#### Creation

- `FPQuaternion.Identity()` - Identity rotation `{ 0, 0, 0, 1 }`
- `FPQuaternion.Create(x, y, z, w)` - Create from FixedPoint components
- `FPQuaternion.FromFloat(x, y, z, w)` - Create from numbers

#### Rotation constructors

- `FPQuaternion.FromAxisAngle(axis: FPVector3, angle: FixedPoint)` - Rotation of `angle` radians around `axis`. The `axis` is assumed to be unit length (the caller's responsibility).
- `FPQuaternion.LookRotation(forwardDir: FPVector3, upDir?: FPVector3)` - Rotation aligning +Z with `forwardDir`, using `upDir` (default `FPVector3.Up`) as the reference up. Falls back to `Identity()` for degenerate inputs (zero-length forward, or up parallel to forward).
- `FPQuaternion.FromEulerXYZ(euler: FPVector3)` - Build from Euler angles (radians) applied in XYZ order
- `FPQuaternion.ToEulerXYZ(q: FPQuaternion)` - Extract Euler angles (radians, XYZ order); pitch sine is clamped to `[-1, 1]` to avoid NaN at the gimbal poles

#### Base operations

- `FPQuaternion.Mul(a, b)` - Hamilton product `a * b` (applies rotation `b` first, then `a`)
- `FPQuaternion.Dot(a, b)` - Dot product
- `FPQuaternion.Magnitude`, `FPQuaternion.SqrMagnitude` - Length (Unity naming)
- `FPQuaternion.Normalize(q)` - Normalize; returns `Identity()` if magnitude is zero
- `FPQuaternion.Conjugate(q)` - Conjugate `{ -x, -y, -z, w }`
- `FPQuaternion.Inverse(q)` - Inverse `Conjugate(q) / sqrMagnitude`; returns `Identity()` if magnitude is zero

#### Interpolation

- `FPQuaternion.Slerp(a, b, t: FixedPoint)` - Spherical linear interpolation along the shortest arc; falls back to normalized LERP for near-parallel inputs
- `FPQuaternion.RotateVector(q, v: FPVector3)` - Rotate a vector by a quaternion (`q * [v, 0] * Conjugate(q)`)

#### Conversion

- `FPQuaternion.ToFloat(q)` - Convert to `{ x, y, z, w }` floats for display/serialization

## Why Fixed-Point?

JavaScript's `Number` type uses IEEE 754 floating-point, which can produce slightly different results on different platforms/hardware. In lockstep multiplayer, even tiny differences compound over time, causing desync.

Fixed-point math uses integer arithmetic with a fixed decimal scale, guaranteeing identical results everywhere.

## Performance Considerations

Fixed-point operations using BigInt are slower than native floats. For most games, this overhead is negligible. If you encounter performance issues:

1. Profile to confirm fixed-point math is the bottleneck
2. Consider batching operations
3. Only use fixed-point for deterministic simulation; use floats for visual-only calculations
