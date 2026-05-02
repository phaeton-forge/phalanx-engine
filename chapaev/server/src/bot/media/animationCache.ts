import { InputFile } from 'grammy';
import { existsSync } from 'node:fs';
import type { Logger } from '../../log.js';

const cache = new Map<string, string>();

export async function getAnimationInput(
  assetPath: string,
  log: Logger,
): Promise<InputFile | string | null> {
  const cached = cache.get(assetPath);
  if (cached) return cached;

  if (!existsSync(assetPath)) {
    log.warn({ assetPath }, 'gameplay.mp4 not found — text-only fallback');
    return null;
  }

  return new InputFile(assetPath);
}

export function cacheFileId(assetPath: string, fileId: string): void {
  cache.set(assetPath, fileId);
}
