import { Game } from './core/Game.ts';
import type { GameMode } from './core/Game.ts';
import { installDebugConsole } from './debug/installDebugConsole.ts';
import { detectPlatform } from './platform/detectPlatform.ts';
import type { PlatformAdapter } from './platform/PlatformAdapter.ts';
import { setLanguage } from './i18n/i18n.ts';
import { installInteractionGuards } from './installInteractionGuards.ts';
import { assetManager } from './rendering/AssetManager.ts';
import { LoaderOverlay } from './ui/LoaderOverlay.ts';

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
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  const errorElement = document.createElement('div');
  errorElement.setAttribute('role', 'alert');
  errorElement.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b00;color:#fff;padding:16px;font-family:sans-serif;font-size:14px;';
  errorElement.textContent = `Failed to start game: ${message}`;
  document.body.appendChild(errorElement);
}

async function bootstrap(): Promise<void> {
  installInteractionGuards();
  await installDebugConsole();

  // ── Platform detection & adapter instantiation ────────────────────
  // Use dynamic imports so only the active platform's SDK is downloaded.
  const platform = detectPlatform();
  document.documentElement.dataset.platform = platform;
  let adapter: PlatformAdapter;

  switch (platform) {
    case 'telegram': {
      const { TelegramAdapter } = await import('./platform/TelegramAdapter.ts');
      adapter = new TelegramAdapter();
      break;
    }
    case 'yandex': {
      const { YandexAdapter } = await import('./platform/YandexAdapter.ts');
      adapter = new YandexAdapter();
      break;
    }
    case 'crazygames': {
      const { CrazyGamesAdapter } =
        await import('./platform/CrazyGamesAdapter.ts');
      adapter = new CrazyGamesAdapter();
      break;
    }
    case 'capacitor': {
      const { CapacitorAdapter } =
        await import('./platform/CapacitorAdapter.ts');
      adapter = new CapacitorAdapter();
      break;
    }
    default: {
      const { StandaloneAdapter } =
        await import('./platform/StandaloneAdapter.ts');
      adapter = new StandaloneAdapter();
    }
  }

  await adapter.init();

  // ── i18n ──────────────────────────────────────────────────────────
  const lang = adapter.getLanguage();
  if (lang) setLanguage(lang);

  // ── Safe-area → CSS vars ──────────────────────────────────────────
  function applySafeAreaToCss(): void {
    const insets = adapter.getSafeAreaInsets();
    const style = document.documentElement.style;
    style.setProperty('--sai-top', `${insets.top}px`);
    style.setProperty('--sai-right', `${insets.right}px`);
    style.setProperty('--sai-bottom', `${insets.bottom}px`);
    style.setProperty('--sai-left', `${insets.left}px`);
  }
  applySafeAreaToCss();
  adapter.onSafeAreaChange(applySafeAreaToCss);

  // ── Preload all assets before building the scene ──────────────────
  const loader = new LoaderOverlay();
  loader.show();

  try {
    await assetManager.preloadAll();
  } catch (error) {
    // Never leave the spinner hanging; funnel the failure through the same
    // reportStartupError path used for the rest of bootstrap.
    loader.hide();
    throw error;
  }

  // Assets are ready — hide the spinner so the menu is interactive.
  loader.hide();

  // ── Game construction ─────────────────────────────────────────────
  const game = new Game(canvasElement, adapter, mode);

  // Expose for debugging in devtools.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__game'] = game;
  }

  game.start();

  // `adapter.ready()` is called by Game after the first frame is rendered
  // (via game.firstFrameRendered promise). See Game.ts for the hook.
  void game.firstFrameRendered.then(() => {
    adapter.ready();
  });
}

void bootstrap().catch((error: unknown) => {
  reportStartupError(error);
});
