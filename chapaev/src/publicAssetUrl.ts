/**
 * Absolute URL for a file from Vite's `public/` folder (textures, HDR, sounds, etc.).
 *
 * - **Development:** Vite serves `public/` at `BASE_URL` on the dev origin.
 * - **Production:** resolve from the built chunk (`…/assets/*.js`) via `../` so
 *   assets work when the page URL is not the game root (e.g. some iframes).
 */
const prodPublicRootUrl = new URL('../', import.meta.url);

export function publicAssetUrl(pathFromPublicRoot: string): string {
  const normalized = pathFromPublicRoot.replace(/^\.\//, '').replace(/^\/+/, '');
  if (import.meta.env.DEV) {
    const devRoot = new URL(import.meta.env.BASE_URL, window.location.href);
    return new URL(normalized, devRoot).href;
  }
  return new URL(normalized, prodPublicRootUrl).href;
}
