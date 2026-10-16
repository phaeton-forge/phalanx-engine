import { fileURLToPath } from 'node:url';

/** `integration/` directory. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Repository root. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
