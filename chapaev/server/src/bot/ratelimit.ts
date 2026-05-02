const buckets = new Map<number, { tokens: number; lastRefill: number }>();

const CAPACITY = 5;
const REFILL_MS = 60_000;
/** Evict buckets idle longer than this (10 × refill window). */
const EVICT_AFTER_MS = REFILL_MS * 10;
/** Run eviction at most once per refill window to keep overhead low. */
const EVICT_INTERVAL_MS = REFILL_MS;
let lastEviction = 0;

function evictIdleBuckets(now: number): void {
  if (now - lastEviction < EVICT_INTERVAL_MS) return;
  lastEviction = now;
  for (const [id, bucket] of buckets) {
    if (now - bucket.lastRefill > EVICT_AFTER_MS) {
      buckets.delete(id);
    }
  }
}

export function consume(telegramId: number): boolean {
  const now = Date.now();
  evictIdleBuckets(now);

  let bucket = buckets.get(telegramId);

  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefill: now };
    buckets.set(telegramId, bucket);
  }

  const elapsed = now - bucket.lastRefill;
  if (elapsed >= REFILL_MS) {
    bucket.tokens = CAPACITY;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}
