/** Latest in-memory snapshot per match. Not durable across a process restart. */
export class SnapshotStore {
  private readonly byMatch = new Map<
    string,
    { tick: number; bytes: Uint8Array }
  >();

  put(matchId: string, tick: number, bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.byMatch.set(matchId, { tick, bytes: copy });
  }

  get(matchId: string): { tick: number; bytes: Uint8Array } | undefined {
    return this.byMatch.get(matchId);
  }

  delete(matchId: string): void {
    this.byMatch.delete(matchId);
  }
}
