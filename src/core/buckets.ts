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
  /**
   * Within-bucket difficulty ∈ [0,1]: operand ranges anneal toward the user's
   * edge (fast correct answers push it up, misses pull it down). Snapshotted
   * into the session config like the weights, so replays stay byte-identical.
   * Zetamac-parity and fermi buckets ignore it.
   */
  difficulty: number;
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

export const DIFFICULTY_START = 0.5;
const DIFFICULTY_UP = 0.02;   // fast correct answer
const DIFFICULTY_DOWN = 0.03; // miss
const DIFFICULTY_DRIFT = 0.01; // correct but slower than target

export function freshBucket(): BucketStats {
  return { attempts: 0, errRate: 0, meanMs: 0, meanFirstKeyMs: 0, difficulty: DIFFICULTY_START };
}

/**
 * Record one attempt. `ms === null` means "no timing signal" — skips (there is
 * no answer time to learn from) and focus-loss-voided untimed questions.
 * The first timed attempt seeds the EWMAs directly instead of decaying from 0.
 * `bucketId` (when given) drives the difficulty anneal: fast-and-right climbs
 * toward harder operands, misses back off — asymmetric so the edge is
 * approached from below.
 */
export function updateBucket(
  s: BucketStats,
  miss: boolean,
  ms: number | null,
  firstKeyMs: number | null = null,
  bucketId?: string,
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
  let difficulty = s.difficulty;
  if (bucketId !== undefined) {
    const step = miss ? -DIFFICULTY_DOWN
      : ms !== null && ms <= targetMs(bucketId) ? DIFFICULTY_UP
      : ms !== null ? -DIFFICULTY_DRIFT
      : 0;
    difficulty = Math.min(1, Math.max(0, difficulty + step));
  }
  return { attempts: s.attempts + 1, errRate, meanMs, meanFirstKeyMs, difficulty };
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
