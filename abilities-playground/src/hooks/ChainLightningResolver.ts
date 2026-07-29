import type { IRandom } from '@phalanx-engine/ecs';
import type { EntityManager } from '@phalanx-engine/ecs';
import type { FixedPoint } from '@phalanx-engine/math';
import { FP } from '@phalanx-engine/math';
import type { PhysicsWorld } from '@phalanx-engine/physics';
import { ComponentType, StatsComponent, TeamComponent } from '../components';

export interface ChainLink {
  /** Entity that emitted this link (caster for jump 0, previous target otherwise). */
  sourceId: number;
  /** Entity struck by this link. */
  targetId: number;
  /** 0 = caster -> closest hostile; 1+ = random jumps. */
  jumpIndex: number;
}

/**
 * Deterministically resolves a chain-lightning strike.
 *
 * 1. Picks the closest alive hostile to the caster within `detectionRadius`.
 * 2. Repeats `randomJumps` times: from the previous target, picks a random
 *    unvisited alive hostile within `jumpRadius` using the shared deterministic
 *    RNG.
 * 3. Returns the ordered list of links so effect application order is identical
 *    on every peer.
 */
export function resolveChainLightning(
  casterId: number,
  randomJumps: number,
  detectionRadius: FixedPoint,
  jumpRadius: FixedPoint,
  physics: PhysicsWorld,
  entityManager: EntityManager,
  rng: IRandom
): ChainLink[] {
  const caster = entityManager.getEntity(casterId);
  if (!caster) return [];

  const casterTeam = caster.getComponent<TeamComponent>(ComponentType.Team);
  if (!casterTeam) return [];

  const casterPos = physics.getEntityPosition(casterId);
  if (!casterPos) return [];

  const firstTargetId = pickClosestHostile(
    casterId,
    casterTeam.teamId,
    casterPos.x,
    casterPos.z,
    physics.spatialGrid.queryRadius(casterPos.x, casterPos.z, detectionRadius),
    physics,
    entityManager
  );
  if (firstTargetId === null) return [];

  const links: ChainLink[] = [
    { sourceId: casterId, targetId: firstTargetId, jumpIndex: 0 },
  ];
  const visited = new Set<number>([casterId, firstTargetId]);
  let currentNode = firstTargetId;

  for (let jumpIndex = 1; jumpIndex <= randomJumps; jumpIndex++) {
    const currentPos = physics.getEntityPosition(currentNode);
    if (!currentPos) break;

    const nextTargetId = pickRandomHostile(
      casterId,
      casterTeam.teamId,
      visited,
      currentPos.x,
      currentPos.z,
      physics.spatialGrid.queryRadius(currentPos.x, currentPos.z, jumpRadius),
      jumpRadius,
      physics,
      entityManager,
      rng
    );
    if (nextTargetId === null) break;

    links.push({ sourceId: currentNode, targetId: nextTargetId, jumpIndex });
    visited.add(nextTargetId);
    currentNode = nextTargetId;
  }

  return links;
}

function isValidHostile(
  selfId: number,
  selfTeam: number,
  entityId: number,
  entityManager: EntityManager
): boolean {
  if (entityId === selfId) return false;

  const entity = entityManager.getEntity(entityId);
  if (!entity) return false;
  if (!entity.hasComponent(ComponentType.UnitType)) return false;

  const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
  if (!stats?.alive) return false;

  const team = entity.getComponent<TeamComponent>(ComponentType.Team);
  if (!team || team.teamId === selfTeam) return false;

  return true;
}

function pickClosestHostile(
  selfId: number,
  selfTeam: number,
  cx: FixedPoint,
  cz: FixedPoint,
  nearbyIds: readonly number[],
  physics: PhysicsWorld,
  entityManager: EntityManager
): number | null {
  const candidates: { id: number; d2: FixedPoint }[] = [];

  for (const id of nearbyIds) {
    if (!isValidHostile(selfId, selfTeam, id, entityManager)) continue;

    const pos = physics.getEntityPosition(id);
    if (!pos) continue;

    const dx = FP.Sub(pos.x, cx);
    const dz = FP.Sub(pos.z, cz);
    candidates.push({ id, d2: FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz)) });
  }

  candidates.sort((a, b) =>
    FP.Lt(a.d2, b.d2) ? -1 : FP.Gt(a.d2, b.d2) ? 1 : a.id - b.id
  );

  return candidates[0]?.id ?? null;
}

function pickRandomHostile(
  selfId: number,
  selfTeam: number,
  visited: Set<number>,
  cx: FixedPoint,
  cz: FixedPoint,
  nearbyIds: readonly number[],
  jumpRadius: FixedPoint,
  physics: PhysicsWorld,
  entityManager: EntityManager,
  rng: IRandom
): number | null {
  const candidates: number[] = [];
  const radiusSq = FP.Mul(jumpRadius, jumpRadius);

  for (const id of nearbyIds) {
    if (visited.has(id)) continue;
    if (!isValidHostile(selfId, selfTeam, id, entityManager)) continue;

    const pos = physics.getEntityPosition(id);
    if (!pos) continue;

    const dx = FP.Sub(pos.x, cx);
    const dz = FP.Sub(pos.z, cz);
    const d2 = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
    if (FP.Lte(d2, radiusSq)) {
      candidates.push(id);
    }
  }

  if (candidates.length === 0) return null;

  // Deterministic selection: the candidate list is already in entity-id order
  // from the spatial grid, but sorting again makes the contract explicit.
  candidates.sort((a, b) => a - b);
  return rng.pick(candidates);
}
