import { checkSideEffects } from './side-effects.mjs';

const { checked, found } = checkSideEffects(process.cwd());

if (checked.length === 0) {
  console.error('check-side-effects: no package sets "sideEffects"');
  process.exit(1);
}

if (found.length > 0) {
  console.error(
    'Modules in packages with "sideEffects": false must not do work on import:'
  );
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`check-side-effects: ok (${checked.join(', ')})`);
