/** Client → server. State digest for one tick. */
export interface StateHashEvent {
  tick: number;
  hash: string;
}

/** Server → clients, on `hash-comparison`. */
export interface HashComparisonEvent {
  tick: number;
  hashes: { [playerId: string]: string };
}
