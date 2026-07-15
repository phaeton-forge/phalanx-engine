import * as THREE from 'three';

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Soft radial alpha disc for Points sprites (shared, do not dispose per-cue). */
let softCircleTexture: THREE.CanvasTexture | null = null;

export function getSoftCircleTexture(): THREE.CanvasTexture {
  if (softCircleTexture) return softCircleTexture;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const mid = size * 0.5;
  const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  softCircleTexture = new THREE.CanvasTexture(canvas);
  softCircleTexture.needsUpdate = true;
  return softCircleTexture;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}
