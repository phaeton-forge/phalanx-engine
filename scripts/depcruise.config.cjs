/**
 * Dependency rules generated from phalanx.layer. The matrix is scripts/layers.mjs.
 * golden fixture, runtime → dev integration would be a cycle
 */
module.exports = import('./layers.mjs').then(({ buildDepcruiseConfig }) =>
  buildDepcruiseConfig(process.cwd(), {
    allow: [
      {
        from: 'phalanx-runtime/tests/golden/snapshots.test.ts',
        to: 'integration/src/facade/v65.js',
      },
    ],
  })
);
