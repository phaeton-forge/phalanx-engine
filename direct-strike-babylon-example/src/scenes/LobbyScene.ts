/**
 * Lobby Scene - connection and matchmaking UI for 1v1
 */

import { PhalanxClient } from 'phalanx-client';
import type {
  MatchFoundEvent,
  CountdownEvent,
  PhalanxAuthState,
} from 'phalanx-client';
import { SERVER_URL, authConfig } from '../config/constants';
import { GameRandom } from '../core/GameRandom';

export class LobbyScene {
  private client: PhalanxClient;
  private matchData: MatchFoundEvent | null = null;

  // DOM elements
  private lobbyElement: HTMLElement;
  private gameContainer: HTMLElement;
  private connectButton: HTMLButtonElement;
  private signInButton: HTMLButtonElement;
  private userInfoElement: HTMLElement;
  private statusElement: HTMLElement;

  // Callbacks
  private onGameStart:
    | ((client: PhalanxClient, matchData: MatchFoundEvent) => void)
    | null = null;

  // Network event unsubscribers (to clean up when returning to lobby)
  private networkUnsubscribers: (() => void)[] = [];

  constructor() {
    // Get DOM elements
    this.lobbyElement = document.getElementById('lobby')!;
    this.gameContainer = document.getElementById('game-container')!;
    this.connectButton = document.getElementById(
      'connect-btn'
    ) as HTMLButtonElement;
    this.signInButton = document.getElementById(
      'sign-in-btn'
    ) as HTMLButtonElement;
    this.userInfoElement = document.getElementById('user-info')!;
    this.statusElement = document.getElementById('status')!;

    // Create PhalanxClient with auth configuration
    this.client = new PhalanxClient({
      serverUrl: SERVER_URL,
      auth: authConfig.authEnabled ? {
        provider: 'google',
        google: {
          clientId: authConfig.googleClientId,
          tokenExchangeUrl: authConfig.tokenExchangeUrl,
        },
      } : undefined,
    });

    // Subscribe to auth events
    this.client.on('authStateChanged', (state) => {
      console.log('[LobbyScene] Auth state changed:', state);
      this.updateUIForAuthState(state);
    });

    this.client.on('authError', (error) => {
      console.error('[LobbyScene] Auth error:', error);
      this.setStatus(`Auth error: ${error.message}`, 'error');
      this.signInButton.disabled = false;
    });

    this.setupEventListeners();

    // Initial UI update
    this.updateUIForAuthState(this.client.getAuthState());
  }

  /**
   * Update UI based on authentication state
   */
  private updateUIForAuthState(authState: PhalanxAuthState): void {
    if (!authConfig.authEnabled) {
      // Auth disabled - show connect button directly (dev mode)
      this.signInButton.style.display = 'none';
      this.userInfoElement.style.display = 'none';
      this.connectButton.style.display = 'block';
      this.connectButton.textContent = 'Find Match (Dev Mode)';
      return;
    }

    if (authState.isLoading) {
      // Still loading auth state
      this.signInButton.style.display = 'none';
      this.userInfoElement.style.display = 'none';
      this.connectButton.style.display = 'none';
      this.setStatus('Loading...', 'info');
      return;
    }

    if (authState.isAuthenticated && authState.user) {
      // Signed in - show user info and Find Game button
      this.signInButton.style.display = 'none';

      // Update user info display
      this.userInfoElement.style.display = 'flex';
      const avatarImg = this.userInfoElement.querySelector('#user-avatar') as HTMLImageElement;
      const userName = this.userInfoElement.querySelector('#user-name') as HTMLSpanElement;
      const signOutBtn = this.userInfoElement.querySelector('#sign-out-btn') as HTMLButtonElement;

      if (avatarImg && authState.user.avatarUrl) {
        avatarImg.src = authState.user.avatarUrl;
        avatarImg.style.display = 'block';
      }
      if (userName) {
        userName.textContent = authState.user.username || authState.user.email || 'Player';
      }
      if (signOutBtn) {
        signOutBtn.onclick = () => void this.handleSignOut();
      }

      // Show Find Game button
      this.connectButton.style.display = 'block';
      this.connectButton.textContent = 'Find Game';
      this.connectButton.disabled = false;

      this.setStatus('', 'info');
    } else {
      // Not signed in - show Sign In button
      this.signInButton.style.display = 'flex';
      this.userInfoElement.style.display = 'none';
      this.connectButton.style.display = 'none';

      this.setStatus('Sign in to play', 'info');
    }
  }

  /**
   * Handle sign in button click
   */
  private handleSignIn(): void {
    this.signInButton.disabled = true;
    this.setStatus('Redirecting to sign-in...', 'info');
    this.client.login();
  }

  /**
   * Handle sign out
   */
  private async handleSignOut(): Promise<void> {
    await this.client.logout();
    this.setStatus('Signed out', 'info');
  }

  /**
   * Set callback for game start
   */
  setOnGameStart(
    callback: (client: PhalanxClient, matchData: MatchFoundEvent) => void
  ): void {
    this.onGameStart = callback;
  }

  /**
   * Setup UI event listeners
   */
  private setupEventListeners(): void {
    this.connectButton.addEventListener('click', () => {
      void this.handleConnect();
    });

    this.signInButton.addEventListener('click', () => {
      this.handleSignIn();
    });

    // Add touch feedback for better mobile UX
    this.connectButton.addEventListener('touchstart', () => {
      this.connectButton.style.transform = 'scale(0.95)';
    });

    this.connectButton.addEventListener('touchend', () => {
      this.connectButton.style.transform = 'scale(1)';
    });

    this.connectButton.addEventListener('touchcancel', () => {
      this.connectButton.style.transform = 'scale(1)';
    });

    // Touch feedback for sign-in button
    this.signInButton.addEventListener('touchstart', () => {
      this.signInButton.style.transform = 'scale(0.95)';
    });

    this.signInButton.addEventListener('touchend', () => {
      this.signInButton.style.transform = 'scale(1)';
    });

    this.signInButton.addEventListener('touchcancel', () => {
      this.signInButton.style.transform = 'scale(1)';
    });
  }

  /**
   * Handle connect button click
   */
  private async handleConnect(): Promise<void> {
    this.connectButton.disabled = true;

    try {
      await this.connectToServer();
    } catch (error) {
      this.setStatus(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
      this.connectButton.disabled = false;
    }
  }

  /**
   * Connect to server and start matchmaking
   */
  private async connectToServer(): Promise<void> {
    this.setStatus('Connecting to server...');

    // Setup event handlers (store unsubscribers for cleanup)
    this.networkUnsubscribers.push(
      this.client.on('disconnected', () => {
        this.setStatus('Disconnected from server', 'error');
        this.connectButton.disabled = false;
      })
    );

    this.networkUnsubscribers.push(
      this.client.on('error', (error) => {
        this.setStatus(`Error: ${error.message}`, 'error');
      })
    );

    // Connect
    await this.client.connect();
    this.setStatus('Connected! Joining queue...');

    // Join queue
    await this.client.joinQueue();
    this.setStatus('In queue. Waiting for another player...');

    // Wait for match
    this.matchData = await this.client.waitForMatch();
    this.setStatus('Match found! Starting countdown...');

    // Wait for countdown
    await this.client.waitForCountdown((event: CountdownEvent) => {
      this.setStatus(`Game starting in ${event.seconds}...`);
    });

    // Wait for game start and initialize deterministic RNG
    const gameStartEvent = await this.client.waitForGameStart();

    // Initialize deterministic RNG with server-provided seed
    if (gameStartEvent.randomSeed !== undefined) {
      GameRandom.initialize(gameStartEvent.randomSeed);
    } else {
      // Fallback for backward compatibility - use match ID hash
      console.warn(
        '[LobbyScene] No randomSeed in game-start event, using fallback'
      );
      const fallbackSeed =
        this.matchData.matchId
          .split('')
          .reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0) >>>
        0;
      GameRandom.initialize(fallbackSeed);
    }

    // Transition to game scene
    this.transitionToGame();
  }

  /**
   * Transition to game scene
   */
  private transitionToGame(): void {
    this.lobbyElement.style.display = 'none';
    this.gameContainer.style.display = 'block';

    if (this.onGameStart && this.matchData) {
      this.onGameStart(this.client, this.matchData);
    }
  }

  /**
   * Set status message
   */
  private setStatus(message: string, type: 'info' | 'error' = 'info'): void {
    this.statusElement.textContent = message;
    this.statusElement.style.color = type === 'error' ? '#ff6b6b' : '#ccc';
  }

  /**
   * Show lobby (called when returning from game)
   */
  show(): void {
    // Clean up network event handlers from previous session
    for (const unsubscribe of this.networkUnsubscribers) {
      unsubscribe();
    }
    this.networkUnsubscribers = [];

    this.lobbyElement.style.display = 'flex';
    this.gameContainer.style.display = 'none';
    this.connectButton.disabled = false;
    this.signInButton.disabled = false;
    this.setStatus('', 'info');
    this.matchData = null;

    // Refresh auth state
    this.updateUIForAuthState(this.client.getAuthState());
  }
}
