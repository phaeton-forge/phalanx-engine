import { UIManager } from './UIManager.ts';
import { MainMenuScreen } from './screens/MainMenu.ts';
import { MatchmakingScreen } from './screens/Matchmaking.ts';
import { GameHUDScreen } from './screens/GameHUD.ts';
import { MatchResultScreen } from './screens/MatchResult.ts';
import { ProfileScreen } from './screens/Profile.ts';
import { PauseOverlay } from './screens/PauseOverlay.ts';
import { PrivateMatchScreen } from './screens/PrivateMatch.ts';
import { LocalGameModeScreen } from './screens/LocalGameMode.ts';
import { SettingsScreen } from './screens/SettingsScreen.ts';
import { RulesScreen } from './screens/RulesScreen.ts';

export interface GameUICallbacks {
  // Main menu
  onFindMatch: (this: void) => void;
  onPrivateMatch: (this: void) => void;
  onLocalGame: (this: void) => void;
  onLocalGameVsAI: (this: void) => void;
  onLocalGameHotseat: (this: void) => void;
  onSignOut: (this: void) => void;

  // Matchmaking
  onCancelMatchmaking: (this: void) => void;

  // In-match
  onPause: (this: void) => void;
  onResume: (this: void) => void;
  onLeaveMatch: (this: void) => void | Promise<void>;

  // Match result
  onNewGame: (this: void) => void;
  onMainMenu: (this: void) => void | Promise<void>;

  // Private match
  onCreateRoom: (this: void) => void;
  onJoinRoom: (this: void, code: string) => void;
  onCancelPrivateMatch: (this: void) => void;
  getPrivateRoomShareUrl: (this: void, roomCode: string) => string;

  /** Whether we're currently in a live game (affects settings/rules nav). */
  isInGame: (this: void) => boolean;
}

/**
 * Constructs every UI screen and wires it to the callbacks supplied
 * by `Game`. Owns the trivial navigation handlers (e.g. "show settings
 * from main menu" vs. "show in-game settings overlay") so `Game`
 * isn't littered with `uiManager.hide/show/destroy` triplets.
 */
export class GameUIController {
  readonly uiManager = new UIManager();
  mainMenu!: MainMenuScreen;
  matchmaking!: MatchmakingScreen;
  gameHUD!: GameHUDScreen;
  matchResult!: MatchResultScreen;
  profileScreen!: ProfileScreen;
  privateMatch!: PrivateMatchScreen;
  localGameMode!: LocalGameModeScreen;
  pauseOverlay!: PauseOverlay;
  // @ts-expect-error — kept alive
  private settingsScreen!: SettingsScreen;
  // @ts-expect-error — kept alive
  private rulesScreen!: RulesScreen;

  build(cb: GameUICallbacks): void {
    this.mainMenu = new MainMenuScreen(this.uiManager, {
      onFindMatch: cb.onFindMatch,
      onPrivateMatch: cb.onPrivateMatch,
      onLocalGame: cb.onLocalGame,
      onSettings: () => this.showMenuSettings(),
      onSignOut: cb.onSignOut,
    });

    this.matchmaking = new MatchmakingScreen(this.uiManager, {
      onCancel: cb.onCancelMatchmaking,
    });

    this.gameHUD = new GameHUDScreen(this.uiManager, {
      onPause: cb.onPause,
      onSettings: () => this.showInGameSettings(),
    });

    this.matchResult = new MatchResultScreen(this.uiManager, {
      onRematch: () => {
        /* TODO: rematch */
      },
      onNewGame: cb.onNewGame,
      onMainMenu: cb.onMainMenu,
    });

    this.profileScreen = new ProfileScreen(this.uiManager, {
      onBack: () => {
        this.uiManager.hideScreen('profile');
        this.uiManager.showScreen('main-menu');
      },
    });

    this.pauseOverlay = new PauseOverlay(this.uiManager, {
      onResume: cb.onResume,
      onLeave: cb.onLeaveMatch,
    });

    this.privateMatch = new PrivateMatchScreen(this.uiManager, {
      onCreateRoom: cb.onCreateRoom,
      onJoinRoom: cb.onJoinRoom,
      onCancel: cb.onCancelPrivateMatch,
      getPrivateRoomShareUrl: cb.getPrivateRoomShareUrl,
      onBack: () => {
        this.uiManager.hideScreen('private-match');
        this.uiManager.showScreen('main-menu');
      },
    });

    this.localGameMode = new LocalGameModeScreen(this.uiManager, {
      onSelectAI: cb.onLocalGameVsAI,
      onSelectHotseat: cb.onLocalGameHotseat,
      onBack: () => {
        this.uiManager.hideScreen('local-game-mode');
        this.uiManager.showScreen('main-menu');
      },
    });

    this.settingsScreen = new SettingsScreen(this.uiManager, {
      onRules: () => {
        this.uiManager.hideScreen('settings');
        this.uiManager.destroyScreen('rules');
        if (cb.isInGame()) {
          this.uiManager.showOverlay('rules');
        } else {
          this.uiManager.showScreen('rules');
        }
      },
      onBack: () => {
        this.uiManager.hideScreen('settings');
        if (!cb.isInGame()) {
          this.uiManager.showScreen('main-menu');
        }
      },
    });

    this.rulesScreen = new RulesScreen(this.uiManager, {
      onBack: () => {
        this.uiManager.hideScreen('rules');
        this.uiManager.destroyScreen('settings');
        if (cb.isInGame()) {
          this.uiManager.showOverlay('settings');
        } else {
          this.uiManager.showScreen('settings');
        }
      },
    });
  }

  // ── Convenience navigation helpers ───────────────────────────────

  showMenuSettings(): void {
    this.uiManager.hideScreen('main-menu');
    this.uiManager.destroyScreen('settings');
    this.uiManager.showScreen('settings');
  }

  showInGameSettings(): void {
    this.uiManager.destroyScreen('settings');
    this.uiManager.showOverlay('settings');
  }

  showPrivateMatch(): void {
    this.uiManager.hideScreen('main-menu');
    this.privateMatch.showMenu();
    this.uiManager.showScreen('private-match');
  }

  showLocalGameMode(): void {
    this.uiManager.hideScreen('main-menu');
    this.uiManager.destroyScreen('local-game-mode');
    this.uiManager.showScreen('local-game-mode');
  }

  showMatchmaking(): void {
    this.uiManager.hideScreen('main-menu');
    this.uiManager.destroyScreen('matchmaking');
    this.uiManager.destroyScreen('countdown-local');
    this.uiManager.showScreen('matchmaking');
  }

  /**
   * Clean up all transient game/menu screens — used by `returnToMainMenu`.
   * `pause` and `match-result` etc. are destroyed (not hidden) so the
   * next match starts with a fresh DOM.
   */
  destroyTransientScreens(): void {
    for (const screen of [
      'game',
      'match-result',
      'pause',
      'countdown',
      'countdown-local',
      'matchmaking',
      'private-match',
      'local-game-mode',
      'settings',
      'rules',
    ] as const) {
      this.uiManager.destroyScreen(screen);
    }
  }

  dispose(): void {
    this.uiManager.dispose();
  }
}
