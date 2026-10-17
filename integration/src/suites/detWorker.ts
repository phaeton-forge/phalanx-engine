import { createCurrentDriver } from '../adapters/current.js';
import type { MatchSpec } from '../driver/SimDriver.js';
import { parseJson } from '../util/json.js';

interface Request {
  readonly spec: MatchSpec;
  readonly ticks: number;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const request = parseRequest(parseJson(raw));
  const driver = createCurrentDriver();
  const match = driver.createMatch(request.spec);
  try {
    const peer = match.createPeer('A', { role: 'authority' });
    const digests: string[] = [];
    for (let tick = 0; tick < request.ticks; tick += 1) {
      if (peer.status() === 'ended' || peer.status() === 'failed') break;
      peer.step(1);
      digests.push(peer.digest());
    }
    process.stdout.write(`${JSON.stringify({ digests })}\n`);
  } finally {
    match.dispose();
  }
}

function parseRequest(value: unknown): Request {
  if (typeof value !== 'object' || value === null) {
    throw new Error('det worker: expected an object');
  }
  if (!('spec' in value) || !('ticks' in value)) {
    throw new Error('det worker: missing spec or ticks');
  }
  const ticks = value.ticks;
  if (typeof ticks !== 'number' || !Number.isInteger(ticks)) {
    throw new Error('det worker: ticks must be an integer');
  }
  return { spec: parseSpec(value.spec), ticks };
}

function parseSpec(value: unknown): MatchSpec {
  const record = asRecord(value, 'spec');
  const options = asRecord(record['options'], 'options');
  const army = options['armySize'];
  return {
    seed: asInt(record['seed'], 'seed'),
    inputDelayTicks: asInt(record['inputDelayTicks'], 'inputDelayTicks'),
    slots: asArray(record['slots'], 'slots').map(parseSlot),
    options: army === undefined ? {} : { armySize: asInt(army, 'armySize') },
  };
}

function parseSlot(value: unknown): MatchSpec['slots'][number] {
  const record = asRecord(value, 'slot');
  const kind = record['kind'];
  if (kind !== 'human' && kind !== 'bot') {
    throw new Error('det worker: slot.kind must be human or bot');
  }
  const team = asInt(record['team'], 'team');
  if (kind === 'human') return { kind, team };
  const policy = record['policy'];
  return {
    kind,
    team,
    ...(typeof policy === 'string' ? { policy } : {}),
    level: 1,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`det worker: ${label} must be an object`);
  }
  // JSON object. Keys are data, not a prototype.
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new Error(`det worker: ${label} must be an array`);
  return value;
}

function asInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`det worker: ${label} must be an integer`);
  }
  return value;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    process.stdin.on('error', reject);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
