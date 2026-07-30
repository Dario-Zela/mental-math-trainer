/**
 * The weakness model. A bucket is a question TYPE (`op:operandClass`), not a
 * question instance — memorising 47×83 is useless; being slow at 2×2
 * multiplication is the signal. Per bucket we keep exponentially-decayed error
 * rate and mean answer time; the weakness score blends them so slow-but-right
 * still counts as weak.
 */
export interface BucketStats {
  attempts: number;
  errRate: number; // EWMA of miss ∈ {0,1}
  meanMs: number;  // EWMA of answer ms (misses-by-skip excluded — no time to learn from)
  /** EWMA of prompt-paint → first keystroke; the think-time half of the think/typing split. */
  meanFirstKeyMs: number;
}

export const LAMBDA = 0.9; // EWMA decay
export const ALPHA = 0.5;  // weight of the slowness term
export const MS_CLAMP = 20_000; // one phone distraction must not wreck a bucket's meanMs
export const COLD_START_ATTEMPTS = 5;

/**
 * Hand-set target times per bucket (ms). Deliberately not learned: good
 * enough, zero machinery, trivially tweakable when dogfooding says otherwise.
 */
const TARGET_MS_BY_OP: Record<string, number> = {
  add: 3000, sub: 3000,
  frac_add: 10_000, frac_mul: 10_000,
  pct_of: 6000, pct_change: 6000,
  recip: 4000,
};

const TARGET_MS_BY_BUCKET: Record<string, number> = {
  'add:3d3d': 5000, 'sub:3d3d': 5000,
  'mul:1x2': 4000, 'mul:2x2': 9000, 'mul:1x3': 8000, 'mul:zeta': 5000,
  'div:1x2': 5000, 'div:2x2': 10_000, 'div:1x3': 9000, 'div:zeta': 5000,
  'dec_mul:clean': 5000, 'dec_mul:ugly': 9000,
  'recip:rep': 5000,
  'fermi:mul': 12_000, 'fermi:div': 12_000, 'fermi:pct': 12_000,
};

export function targetMs(bucketId: string): number {
  const op = bucketId.split(':')[0] ?? '';
  return TARGET_MS_BY_BUCKET[bucketId] ?? TARGET_MS_BY_OP[op] ?? 6000;
}

export function freshBucket(): BucketStats {
  return { attempts: 0, errRate: 0, meanMs: 0, meanFirstKeyMs: 0 };
}

/**
 * Record one attempt. `ms === null` means "no timing signal" — skips (there is
 * no answer time to learn from) and focus-loss-voided untimed questions.
 * The first timed attempt seeds the EWMAs directly instead of decaying from 0.
 */
export function updateBucket(
  s: BucketStats,
  miss: boolean,
  ms: number | null,
  firstKeyMs: number | null = null,
): BucketStats {
  const errRate = s.attempts === 0 ? (miss ? 1 : 0) : LAMBDA * s.errRate + (1 - LAMBDA) * (miss ? 1 : 0);
  let meanMs = s.meanMs;
  if (ms !== null) {
    const clamped = Math.min(ms, MS_CLAMP);
    meanMs = s.meanMs === 0 ? clamped : LAMBDA * s.meanMs + (1 - LAMBDA) * clamped;
  }
  let meanFirstKeyMs = s.meanFirstKeyMs;
  if (firstKeyMs !== null) {
    const clamped = Math.min(firstKeyMs, MS_CLAMP);
    meanFirstKeyMs = s.meanFirstKeyMs === 0 ? clamped : LAMBDA * s.meanFirstKeyMs + (1 - LAMBDA) * clamped;
  }
  return { attempts: s.attempts + 1, errRate, meanMs, meanFirstKeyMs };
}

/**
 * Weakness score w = errRate + α·clamp(meanMs/target − 1, 0, 1).
 * No wall-clock decay: a stale-weak bucket keeps its score until resampled,
 * which the scheduler's base floor guarantees happens.
 */
export function weakness(s: BucketStats | undefined, bucketId: string): number {
  if (!s || s.attempts === 0) return 0;
  const slow = s.meanMs === 0 ? 0 : Math.min(Math.max(s.meanMs / targetMs(bucketId) - 1, 0), 1);
  return s.errRate + ALPHA * slow;
}
