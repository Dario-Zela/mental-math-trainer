/**
 * Sampling distribution over buckets: p(b) ∝ (base + w(b))^β.
 * No SM-2/Anki intervals — sessions are minutes apart, not days, so decayed
 * error rates are the honest model (see README).
 *
 * Weights are SNAPSHOTTED at session start and quantised into the session
 * config. This is what makes a session a pure function of (seed, config):
 * challenge links replay byte-identically on any machine, because the
 * receiver samples from the sharer's encoded weights, not their own stats.
 *  - Cold start (any enabled bucket < 5 attempts): all-zero snapshot ⇒ uniform.
 *  - base floor keeps every enabled bucket in rotation even at weight 0.
 *  - Session cap: post-cold-start no bucket exceeds ~30% of a session, so the
 *    sampler can't serve a demoralising monoculture of your worst bucket or
 *    starve other buckets' EWMAs of fresh data.
 */
import type { Rng } from './rng';
import { type BucketStats, weakness, COLD_START_ATTEMPTS } from './buckets';

export const BASE = 0.2;
export const BETA = 2;
export const SESSION_CAP = 0.3;

/** Weakness scores live in [0, 1.5]; quantised to 4 bits for the URL codec. */
export const WEIGHT_LEVELS = 15;
export const WEAKNESS_MAX = 1.5;

export function quantiseWeakness(w: number): number {
  return Math.round(Math.min(Math.max(w / WEAKNESS_MAX, 0), 1) * WEIGHT_LEVELS);
}

export function isColdStart(enabled: readonly string[], stats: Record<string, BucketStats>): boolean {
  return enabled.some((b) => (stats[b]?.attempts ?? 0) < COLD_START_ATTEMPTS);
}

/**
 * Quantised weight snapshot for a new session, aligned with `enabled`.
 * `uniform: true` forces an all-zero snapshot (Zetamac-parity mode samples ops
 * uniformly, exactly as Zetamac does — weakness weighting there would skew the
 * benchmark's difficulty mix).
 */
export function snapshotWeights(
  enabled: readonly string[],
  stats: Record<string, BucketStats>,
  uniform = false,
): number[] {
  if (uniform || isColdStart(enabled, stats)) return enabled.map(() => 0);
  return enabled.map((b) => quantiseWeakness(weakness(stats[b], b)));
}

function samplingWeight(quantised: number): number {
  const w = (quantised / WEIGHT_LEVELS) * WEAKNESS_MAX;
  return Math.pow(BASE + w, BETA);
}

/**
 * Pick the next bucket for a session. `weights` is the quantised snapshot
 * aligned with `enabled`; `sessionCounts`/`served` describe this session only.
 * A single enabled bucket (focus drill) bypasses everything.
 */
export function pickBucket(
  rng: Rng,
  enabled: readonly string[],
  weights: readonly number[],
  sessionCounts: Record<string, number> = {},
  served = 0,
): string {
  if (enabled.length === 0) throw new Error('no buckets enabled');
  if (enabled.length === 1) return enabled[0] as string;

  // Grace of 3 questions per bucket so the cap doesn't thrash at session start.
  const cap = Math.max(3, Math.ceil(SESSION_CAP * (served + 1)));
  let idx: number[] = [];
  for (let i = 0; i < enabled.length; i++) {
    if ((sessionCounts[enabled[i] as string] ?? 0) + 1 <= cap) idx.push(i);
  }
  if (idx.length === 0) idx = enabled.map((_, i) => i);

  const ws = idx.map((i) => samplingWeight(weights[i] ?? 0));
  const total = ws.reduce((a, w) => a + w, 0);
  let r = rng() * total;
  for (let j = 0; j < idx.length; j++) {
    r -= ws[j] as number;
    if (r <= 0) return enabled[idx[j] as number] as string;
  }
  return enabled[idx[idx.length - 1] as number] as string;
}
