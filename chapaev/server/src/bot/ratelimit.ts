const buckets = new Map<number, { tokens: number; lastRefill: number }>();

const CAPACITY = 5;
const REFILL_MS = 60_000;

export function consume(telegramId: number): boolean {
  const now = Date.now();
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
