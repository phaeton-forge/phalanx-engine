import { checkLayerDeps } from './layers.mjs';

const root = process.argv[2] ?? process.cwd();
const violations = checkLayerDeps(root);
if (violations.length > 0) {
  for (const line of violations) {
    console.error(line);
  }
  process.exit(1);
}
