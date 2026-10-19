import { GameWorldEvents, type GameWorld } from '@phalanx-engine/ecs';
import { DebugDataProvider } from './DebugDataProvider.js';
import { DebugPanel } from './DebugPanel.js';
import type { DebugPanelConfig } from './types.js';

export interface AttachDebugOptions {
  readonly updateInterval?: number;
  readonly panel?: DebugPanelConfig;
}

export interface DebugAttachment {
  readonly provider: DebugDataProvider;
  readonly panel: DebugPanel | null;
  detach(): void;
}

/**
 * Subscribe a debug provider to an existing world. The world stores nothing
 * about the attachment; {@link DebugAttachment.detach} is the only teardown.
 */
export function attachDebug(
  world: GameWorld,
  options?: AttachDebugOptions
): DebugAttachment {
  if (options?.panel !== undefined && !hostHasDocument()) {
    throw new Error('attachDebug: panel requires a DOM');
  }

  const provider = new DebugDataProvider(world.entityManager, world.pools, {
    updateInterval: options?.updateInterval,
  });
  provider.paused = world.paused;

  const onPaused = (): void => {
    provider.paused = true;
  };
  const onResumed = (): void => {
    provider.paused = false;
  };
  const unsubscribePaused = world.eventBus.on(GameWorldEvents.PAUSED, onPaused);
  const unsubscribeResumed = world.eventBus.on(
    GameWorldEvents.RESUMED,
    onResumed
  );

  provider.start();

  const panel =
    options?.panel !== undefined
      ? new DebugPanel(provider, options.panel)
      : null;

  let detached = false;
  return {
    provider,
    panel,
    detach(): void {
      if (detached) return;
      detached = true;
      unsubscribePaused();
      unsubscribeResumed();
      panel?.destroy();
      provider.dispose();
    },
  };
}

function hostHasDocument(): boolean {
  const host: unknown = globalThis;
  if (typeof host !== 'object' || host === null || !('document' in host)) {
    return false;
  }
  return host.document !== undefined && host.document !== null;
}
