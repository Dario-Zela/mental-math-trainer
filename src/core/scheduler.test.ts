import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { pickBucket, snapshotWeights, BASE, BETA, WEIGHT_LEVELS, WEAKNESS_MAX, SESSION_CAP } from './scheduler';
import { freshBucket, type BucketStats } from './buckets';

const BUCKETS = ['add:2d2d', 'mul:2x2', 'frac_add:small', 'pct_of:clean'];

function draw(weights: number[], n: number, seed = 7): Record<string, number> {
  const rng = mulberry32(seed);
  const freq: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    // independent draws: no session counts, so the cap never interferes
    const b = pickBucket(rng, BUCKETS, weights);
    freq[b] = (freq[b] ?? 0) + 1;
  }
  return freq;
}

/** Pearson chi-squared against expected proportions; generous 99.9% critical value. */
function chiSquared(freq: Record<string, number>, expected: number[], n: number): number {
  return BUCKETS.reduce((acc, b, i) => {
    const e = (expected[i] as number) * n;
    const o = freq[b] ?? 0;
    return acc + ((o - e) * (o - e)) / e;
  }, 0);
}
const CHI2_CRIT_DF3 = 16.27; // p = 0.999, df = 3

describe('scheduler', () => {
  it('frequencies match (base + w)^β within chi-squared tolerance', () => {
    const weights = [0, 5, 10, 15];
    const props = weights.map((q) => Math.pow(BASE + (q / WEIGHT_LEVELS) * WEAKNESS_MAX, BETA));
    const total = props.reduce((a, b) => a + b, 0);
    const expected = props.map((p) => p / total);
    const freq = draw(weights, 10_000);
    expect(chiSquared(freq, expected, 10_000)).toBeLessThan(CHI2_CRIT_DF3);
  });

  it('cold start samples uniformly', () => {
    const stats: Record<string, BucketStats> = { [BUCKETS[0] as string]: { ...freshBucket(), attempts: 3 } };
    const weights = snapshotWeights(BUCKETS, stats); // some bucket < 5 attempts ⇒ all zeros
    expect(weights).toEqual([0, 0, 0, 0]);
    const freq = draw(weights, 10_000);
    expect(chiSquared(freq, [0.25, 0.25, 0.25, 0.25], 10_000)).toBeLessThan(CHI2_CRIT_DF3);
  });

  it('raising a bucket\'s errRate strictly raises its sampling share', () => {
    const mk = (errRate: number): Record<string, BucketStats> => {
      const stats: Record<string, BucketStats> = {};
      for (const b of BUCKETS) stats[b] = { attempts: 20, errRate: 0.1, meanMs: 2000, meanFirstKeyMs: 800, difficulty: 0.5 };
      stats[BUCKETS[1] as string] = { attempts: 20, errRate, meanMs: 2000, meanFirstKeyMs: 800, difficulty: 0.5 };
      return stats;
    };
    const low = draw(snapshotWeights(BUCKETS, mk(0.2)), 10_000);
    const high = draw(snapshotWeights(BUCKETS, mk(0.8)), 10_000);
    expect(high[BUCKETS[1] as string] ?? 0).toBeGreaterThan(low[BUCKETS[1] as string] ?? 0);
  });

  it('slow-but-right counts as weak: high meanMs raises share with zero errors', () => {
    const stats: Record<string, BucketStats> = {};
    for (const b of BUCKETS) stats[b] = { attempts: 20, errRate: 0, meanMs: 2000, meanFirstKeyMs: 800, difficulty: 0.5 };
    (stats['mul:2x2'] as BucketStats).meanMs = 18_000; // target 9000 ⇒ slowness term saturates
    const freq = draw(snapshotWeights(BUCKETS, stats), 10_000);
    expect((freq['mul:2x2'] as number) / 10_000).toBeGreaterThan(0.3);
  });

  it('the 30% session cap holds over a full session', () => {
    const rng = mulberry32(3);
    const weights = [15, 0, 0, 0]; // pathological: one catastrophic bucket
    const counts: Record<string, number> = {};
    for (let served = 0; served < 100; served++) {
      const b = pickBucket(rng, BUCKETS, weights, counts, served);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    const cap = Math.max(3, Math.ceil(SESSION_CAP * 100));
    for (const b of BUCKETS) expect(counts[b] ?? 0).toBeLessThanOrEqual(cap + 1);
  });

  it('the base floor keeps every enabled bucket in rotation', () => {
    const freq = draw([15, 0, 0, 0], 10_000);
    for (const b of BUCKETS) expect(freq[b] ?? 0).toBeGreaterThan(0);
  });

  it('a single enabled bucket (focus drill) always wins', () => {
    const rng = mulberry32(1);
    expect(pickBucket(rng, ['mul:2x2'], [0])).toBe('mul:2x2');
  });
});
