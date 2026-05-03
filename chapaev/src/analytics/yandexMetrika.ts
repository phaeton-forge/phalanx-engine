/** Yandex.Metrika counter id (must match `index.html` init). */
export const YANDEX_METRIKA_ID = 109024389;

type MetrikaParams = Record<string, string | number | boolean>;

function getYm(): ((id: number, ...args: unknown[]) => void) | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ym?: (id: number, ...args: unknown[]) => void })
    .ym;
}

function reachGoal(goal: string, params?: MetrikaParams): void {
  const ym = getYm();
  if (typeof ym !== 'function') return;
  try {
    if (params && Object.keys(params).length > 0) {
      ym(YANDEX_METRIKA_ID, 'reachGoal', goal, params);
    } else {
      ym(YANDEX_METRIKA_ID, 'reachGoal', goal);
    }
  } catch {
    // Metrika unavailable or blocked
  }
}

/** Goal: match_found — public queue or private room opponent joined. */
export function trackMatchFound(matchType: 'public' | 'private'): void {
  reachGoal('match_found', { match_type: matchType });
}

/** Goal: game_start — `game_type` describes the session (e.g. online, local_ai). */
export function trackGameStart(gameType: string): void {
  reachGoal('game_start', { game_type: gameType });
}

/** Goal: game_end — natural match end; `duration_ms` is session length. */
export function trackGameEnd(gameType: string, durationMs: number): void {
  reachGoal('game_end', {
    game_type: gameType,
    duration_ms: Math.max(0, Math.round(durationMs)),
  });
}

/** Goal: game_exit — player left mid-session (menu / pause leave). */
export function trackGameExit(gameType: string): void {
  reachGoal('game_exit', { game_type: gameType });
}
