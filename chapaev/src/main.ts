import { Game } from './core/Game.ts';
import type { GameMode } from './core/Game.ts';
import { installDebugConsole } from './debug/installDebugConsole.ts';
import { NoopPlatformAds, YandexSDK } from './platform/YandexSDK.ts';
import type { IPlatformAds } from './platform/YandexSDK.ts';
import { setLanguage } from './i18n/i18n.ts';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Canvas element with id 'app' not found");
}

const canvasElement = canvas;

// Switch between hot-seat, AI, and online via query param: ?mode=hotseat | ai | online.
// Default is 'online' for Stage 2.
const params = new URLSearchParams(window.location.search);
const rawMode = params.get('mode');
const mode: GameMode =
  rawMode === 'hotseat' || rawMode === 'online' || rawMode === 'ai'
    ? rawMode
    : 'online';

console.log(`[Chapayev] Starting in ${mode} mode`);

function reportStartupError(error: unknown): void {
  console.error('[Chapayev] Failed to start game', error);
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  const errorElement = document.createElement('div');
  errorElement.setAttribute('role', 'alert');
  errorElement.textContent = `Failed to start game: ${message}`;
  // @ts-ignore
  const mountTarget = canvasElement.parentElement ?? document.body;
  mountTarget.appendChild(errorElement);
}

async function bootstrap(): Promise<void> {
  await installDebugConsole();

  let platformAds: IPlatformAds = new NoopPlatformAds();
  try {
    const yandexSDK = new YandexSDK();
    await yandexSDK.init();
    const lang = yandexSDK.getLanguage();
    if (lang) setLanguage(lang);
    platformAds = yandexSDK;
  } catch (e: unknown) {
    console.warn('[Chapayev] Yandex SDK init failed; continuing without ads', e);
  }

  const game = new Game(canvasElement, platformAds, mode);

  // Expose for debugging in devtools
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__game'] = game;
  }

  game.start();
}

void bootstrap().catch((error: unknown) => {
  reportStartupError(error);
});

