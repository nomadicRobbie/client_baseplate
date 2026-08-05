import assert from 'node:assert/strict';

// Self-check for resolvePinned in ../src/lib/pins-context.tsx. Kept in sync by
// hand (that file imports React Native, so it can't be imported under node).
// Run: node scripts/pins.check.mjs
const MAX = 2;
function resolvePinned(available, stored, max = MAX) {
  const picked = stored.filter((h) => available.includes(h));
  const fill = available.filter((h) => !picked.includes(h));
  return [...picked, ...fill].slice(0, Math.min(max, available.length));
}

const A = ['/a', '/b', '/c'];

// No picks → first two available.
assert.deepEqual(resolvePinned(A, []), ['/a', '/b']);
// Respects the user's order and picks.
assert.deepEqual(resolvePinned(A, ['/c', '/a']), ['/c', '/a']);
// Drops stored hrefs that are no longer available, backfills the gap.
assert.deepEqual(resolvePinned(A, ['/x', '/c']), ['/c', '/a']);
// Never exceeds the number of available modules.
assert.deepEqual(resolvePinned(['/a'], ['/a']), ['/a']);
assert.deepEqual(resolvePinned([], ['/a']), []);
// Caps at max even if stored has more.
assert.deepEqual(resolvePinned(A, ['/a', '/b', '/c']), ['/a', '/b']);

console.log('pins.check OK');
