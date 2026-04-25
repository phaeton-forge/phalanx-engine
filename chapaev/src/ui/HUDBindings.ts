import type { GameWorld } from 'phalanx-ecs';
import { ComponentType, GameStateComponent } from '../components';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  GAME_OVER,
  TURN_CHANGED,
  CHECKER_ELIMINATED,
  ROUND_STARTED,
  ROUND_OVER,
} from '../events';
import type {
  GameOverEvent,
  TurnChangedEvent,
  CheckerEliminatedEvent,
  RoundStartedEvent,
  RoundOverEvent,
} from '../events';
import type { GameHUDScreen } from './screens/GameHUD.ts';

interface HotseatOptions {
  mode: 'hotseat';
}

interface OnlineOptions {
  mode: 'online';
  /** Team controlled by the local player — used to phrase win/loss toasts. */
  localTeam: TeamTag;
  /**
   * Called when GAME_OVER fires; receives whether the local team won so
   * the caller can decide whether to schedule a redirect to the menu.
   */
  onGameOver: (isLocalWin: boolean) => void;
}

type HUDBindingOptions = HotseatOptions | OnlineOptions;

/**
 * Wires `world.eventBus` events to `GameHUDScreen` updates. The two game
 * modes diverge only in the toast wording for round / match outcomes —
 * shared subscriptions (turn indicator, checker counts, round counter)
 * are identical. Keeping this in one place removes ~80 lines of
 * duplicated subscriptions across `startHotseat` / `startOnlineGame`.
 */
export function bindHUDToWorld(
  world: GameWorld,
  hud: GameHUDScreen,
  opts: HUDBindingOptions
): void {
  const isHotseat = opts.mode === 'hotseat';

  world.eventBus.on<TurnChangedEvent>(TURN_CHANGED, (event) => {
    if (isHotseat) {
      const team = event.team === TeamTag.White ? 'white' : 'black';
      hud.updateTurnIndicator(true, team);
    } else {
      hud.updateTurnIndicator(event.team === opts.localTeam);
    }
  });

  world.eventBus.on<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (event) => {
    const gsEntities = world.entityManager.queryEntities(
      ComponentType.GameState
    );
    const gs = gsEntities[0]?.getComponent<GameStateComponent>(
      ComponentType.GameState
    );
    if (!gs) return;
    if (event.team === TeamTag.White) {
      hud.updateCheckerCount(0, gs.whiteAliveCount, 8);
    } else {
      hud.updateCheckerCount(1, gs.blackAliveCount, 8);
    }
  });

  world.eventBus.on<RoundStartedEvent>(ROUND_STARTED, (event) => {
    hud.updateRound(event.roundNumber);
    hud.updateCheckerCount(0, 8, 8);
    hud.updateCheckerCount(1, 8, 8);
  });

  world.eventBus.on<RoundOverEvent>(ROUND_OVER, (event) => {
    if (event.winner === null) {
      hud.showToast('Ничья в раунде', 'info');
    } else if (isHotseat) {
      hud.showToast(
        event.winner === TeamTag.White
          ? 'Белые выиграли раунд!'
          : 'Чёрные выиграли раунд!',
        'success'
      );
    } else if (event.winner === opts.localTeam) {
      hud.showToast('Раунд выигран!', 'success');
    } else {
      hud.showToast('Раунд проигран', 'defeat');
    }
  });

  world.eventBus.on<GameOverEvent>(GAME_OVER, (event) => {
    if (isHotseat) {
      hud.showToast(
        event.winner === TeamTag.White
          ? '🏆 Белые победили!'
          : '🏆 Чёрные победили!',
        'success',
        4000
      );
      return;
    }
    const isLocalWin = event.winner === opts.localTeam;
    console.log(
      `[Game] GAME OVER! Winner: ${event.winner}. ${isLocalWin ? 'You win!' : 'You lose.'}`
    );
    hud.showToast(
      isLocalWin ? '🏆 Победа в партии!' : 'Поражение',
      isLocalWin ? 'success' : 'defeat',
      3000
    );
    opts.onGameOver(isLocalWin);
  });
}
