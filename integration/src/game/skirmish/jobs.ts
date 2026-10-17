/** Respawn delay in ticks. */
export const RESPAWN_DELAY = 12;
export const JOB_SLOTS = 32;

export interface RespawnJob {
  used: boolean;
  at: number;
  kind: number;
  slot: number;
  team: number;
  x: bigint;
  z: bigint;
}

export function emptyJobs(): RespawnJob[] {
  const jobs: RespawnJob[] = [];
  for (let index = 0; index < JOB_SLOTS; index += 1) {
    jobs.push({
      used: false,
      at: 0,
      kind: 0,
      slot: 0,
      team: 0,
      x: 0n,
      z: 0n,
    });
  }
  return jobs;
}

export function scheduleRespawn(
  jobs: readonly RespawnJob[],
  at: number,
  kind: number,
  slot: number,
  team: number,
  x: bigint,
  z: bigint
): void {
  for (const job of jobs) {
    if (job.used) continue;
    job.used = true;
    job.at = at;
    job.kind = kind;
    job.slot = slot;
    job.team = team;
    job.x = x;
    job.z = z;
    return;
  }
}

/** Spawn due jobs in place. Does not allocate. */
export function flushRespawns(
  jobs: readonly RespawnJob[],
  tick: number,
  spawn: (job: RespawnJob) => void
): void {
  for (const job of jobs) {
    if (!job.used || job.at > tick) continue;
    job.used = false;
    spawn(job);
  }
}

export function pendingRespawns(jobs: readonly RespawnJob[]): number {
  let count = 0;
  for (const job of jobs) if (job.used) count += 1;
  return count;
}

export interface SavedJob {
  readonly at: number;
  readonly kind: number;
  readonly slot: number;
  readonly team: number;
  readonly x: bigint;
  readonly z: bigint;
}

export function usedJobs(jobs: readonly RespawnJob[]): RespawnJob[] {
  const used: RespawnJob[] = [];
  for (const job of jobs) if (job.used) used.push(job);
  return used;
}

export function loadJobs(
  jobs: readonly RespawnJob[],
  saved: readonly SavedJob[]
): void {
  for (const job of jobs) job.used = false;
  for (let index = 0; index < saved.length && index < jobs.length; index += 1) {
    const job = jobs[index];
    const row = saved[index];
    if (job === undefined || row === undefined) continue;
    job.used = true;
    job.at = row.at;
    job.kind = row.kind;
    job.slot = row.slot;
    job.team = row.team;
    job.x = row.x;
    job.z = row.z;
  }
}
