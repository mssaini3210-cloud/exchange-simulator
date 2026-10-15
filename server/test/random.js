// A tiny seeded random number generator (mulberry32). The same seed always
// gives the same numbers, so a failing random test can be replayed exactly.
function createRandom(seed) {
  let state = seed >>> 0;

  // A number from 0 (inclusive) to 1 (exclusive), like Math.random().
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // A whole number from min to max, both included.
  function int(min, max) {
    return min + Math.floor(next() * (max - min + 1));
  }

  // One item from a non-empty array.
  function pick(items) {
    return items[int(0, items.length - 1)];
  }

  return { next, int, pick };
}

module.exports = { createRandom };
