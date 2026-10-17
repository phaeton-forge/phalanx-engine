import type { StateDump } from '../driver/SimDriver.js';

export interface FieldDiff {
  readonly entity: string;
  readonly component: string;
  readonly field: string;
  readonly peer: string;
  readonly reference: string;
}

/**
 * First recorded peer tick whose digest differs from the reference.
 * Ticks the peer never recorded (it had not joined, or it was
 * disconnected) are not a divergence. A later tick may match again,
 * so this is a forward scan, not a prefix search.
 */
export function firstDivergingTick(
  peer: ReadonlyMap<number, string>,
  reference: ReadonlyMap<number, string>
): number | null {
  const sorted = [...peer.keys()].sort((left, right) => left - right);
  for (const tick of sorted) {
    if (peer.get(tick) !== reference.get(tick)) return tick;
  }
  return null;
}

export function diffDumps(peer: StateDump, reference: StateDump): FieldDiff[] {
  const left = flatten(peer);
  const right = flatten(reference);
  const keys = new Set<string>([...left.keys(), ...right.keys()]);
  const sorted = [...keys].sort();
  const diffs: FieldDiff[] = [];
  for (const key of sorted) {
    const peerValue = left.get(key) ?? '<missing>';
    const referenceValue = right.get(key) ?? '<missing>';
    if (peerValue === referenceValue) continue;
    const parts = key.split('/');
    diffs.push({
      entity: parts[0] ?? '',
      component: parts[1] ?? '',
      field: parts.slice(2).join('/'),
      peer: peerValue,
      reference: referenceValue,
    });
    if (diffs.length >= 24) break;
  }
  return diffs;
}

function flatten(dump: StateDump): Map<string, string> {
  const out = new Map<string, string>();
  const entityIds = Object.keys(dump.entities).sort();
  for (const id of entityIds) {
    const components = dump.entities[id];
    if (components === undefined) continue;
    for (const component of Object.keys(components).sort()) {
      const fields = components[component];
      if (fields === undefined) continue;
      for (const field of Object.keys(fields).sort()) {
        const value = fields[field];
        if (value === undefined) continue;
        out.set(`${id}/${component}/${field}`, value);
      }
    }
  }
  dump.rng.forEach((word, index) => {
    out.set(`rng/${String(index)}`, word);
  });
  for (const key of Object.keys(dump.gas).sort()) {
    const value = dump.gas[key];
    if (value !== undefined) out.set(`gas/${key}`, value);
  }
  for (const slot of Object.keys(dump.bots).sort()) {
    const fields = dump.bots[slot];
    if (fields === undefined) continue;
    for (const field of Object.keys(fields).sort()) {
      const value = fields[field];
      if (value !== undefined) out.set(`bot/${slot}/${field}`, value);
    }
  }
  return out;
}
