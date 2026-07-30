/**
 * Seeded PRNG (mulberry32). A session is (seed, config) — the same seed must
 * reproduce the same question sequence forever, so this implementation is
 * frozen: any change to it breaks every shared challenge link in the wild.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [lo, hi], inclusive on both ends. */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Uniform pick from a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined && items.length === 0) throw new Error('pick from empty array');
  return item as T;
}

/** Random 32-bit seed for new sessions (callers pass Math.random-derived entropy in from the shell). */
export function randomSeed(entropy: number): number {
  return Math.floor(entropy * 0xffffffff) >>> 0;
}
