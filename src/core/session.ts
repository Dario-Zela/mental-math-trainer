/**
 * Session state machine — pure: no DOM, no clocks. The shell passes timestamps
 * in; the core hands questions and verdicts back. A session is fully
 * determined by its config (which includes the seed and the quantised weight
 * snapshot), so shared links replay byte-identically anywhere.
 */
import { mulberry32, type Rng } from './rng';
import { generateQuestion, type QuestionSpec, ZETA_BUCKETS } from './questions';
import { type BucketStats, freshBucket, updateBucket } from './buckets';
import { pickBucket, snapshotWeights } from './scheduler';
import { makeScorer, type Mode, type Scorer, type Verdict, ZETAMAC_DEFAULT_SEC, OPTIVER_SEC } from './scoring';
import { parseAnswer } from './answer';

export interface SessionConfig {
  mode: Mode;
  seed: number;
  /** Enabled buckets for this session (focus drill: exactly one). */
  buckets: string[];
  /** Quantised weakness snapshot aligned with `buckets` (0..15 each). */
  weights: number[];
  /** Zetamac-style sessions only; optiver is fixed 480, focus untimed. */
  durationSec: number | null;
  /** Opened from a shared link → buckets update normally, PBs/streaks don't. */
  replay: boolean;
}

/** True Zetamac parity: locked ranges, locked 120s — the only sessions plotted on the benchmark line. */
export function isBenchmark(config: SessionConfig): boolean {
  return (
    config.mode === 'zetamac' &&
    config.durationSec === ZETAMAC_DEFAULT_SEC &&
    config.buckets.length === ZETA_BUCKETS.length &&
    ZETA_BUCKETS.every((b, i) => config.buckets[i] === b)
  );
}

/** Build a fresh session config from the user's current stats. */
export function makeConfig(
  mode: Mode,
  buckets: string[],
  stats: Record<string, BucketStats>,
  seed: number,
  durationSec: number | null = null,
): SessionConfig {
  const dur = mode === 'zetamac' ? durationSec ?? ZETAMAC_DEFAULT_SEC : mode === 'optiver' ? OPTIVER_SEC : null;
  const zetaParity = mode === 'zetamac' && buckets.every((b) => b.endsWith(':zeta'));
  return {
    mode, seed, buckets, durationSec: dur, replay: false,
    weights: snapshotWeights(buckets, stats, zetaParity),
  };
}

export interface QuestionRecord {
  spec: QuestionSpec;
  /** Raw input text; null = skip or discarded. */
  given: string | null;
  verdict: Verdict;
  delta: number;
  /** Prompt-paint → submit, ms. Null when timing was voided (focus loss on an untimed question). */
  ms: number | null;
  /** Prompt-paint → first keystroke, ms — the think-time/typing-time split. */
  firstKeyMs: number | null;
}

export interface SessionSummary {
  id: string;
  startedAt: number; // epoch ms
  mode: Mode;
  benchmark: boolean;
  replay: boolean;
  score: number;
  answered: number;
  correct: number;
  accuracy: number; // correct / answered, skips included in the denominator
  medianMs: number | null;
  durationSec: number | null;
  focusLosses: number;
  perBucket: Record<string, { n: number; misses: number }>;
  seedHex: string;
}

const RING_SIZE = 10;

export class Session {
  readonly config: SessionConfig;
  readonly scorer: Scorer;
  readonly log: QuestionRecord[] = [];
  score = 0;
  focusLosses = 0;
  current: QuestionSpec | null = null;

  private readonly rng: Rng;
  private readonly ring: string[] = [];
  private readonly counts: Record<string, number> = {};
  private stats: Record<string, BucketStats>;

  constructor(config: SessionConfig, initialStats: Record<string, BucketStats> = {}) {
    this.config = config;
    this.scorer = makeScorer(config.mode, config.durationSec);
    this.rng = mulberry32(config.seed);
    // Clone: bucket EWMAs update live during the session but only commit to the
    // store when the session finishes — an aborted sim discards everything.
    this.stats = {};
    for (const [k, v] of Object.entries(initialStats)) this.stats[k] = { ...v };
  }

  /** Updated bucket stats to merge into the store on finish. */
  bucketStats(): Record<string, BucketStats> {
    return this.stats;
  }

  /** Draw the next question. Deterministic given (seed, config). */
  next(now = 0): QuestionSpec {
    const bucket = pickBucket(this.rng, this.config.buckets, this.config.weights, this.counts, this.log.length);
    const q = generateQuestion(bucket, this.rng, now, this.ring);
    this.ring.push(q.prompt);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    this.counts[bucket] = (this.counts[bucket] ?? 0) + 1;
    this.current = q;
    return q;
  }

  /**
   * Grade the current question. `given` is the raw input text (null = skip).
   * `ms` may be null when timing was voided; skips always feed null into the
   * time EWMA (no answer time to learn from) but count as misses for errRate.
   */
  answer(given: string | null, ms: number | null, firstKeyMs: number | null): { verdict: Verdict; delta: number } {
    const spec = this.current;
    if (!spec) throw new Error('no current question');
    const parsed = given === null ? null : parseAnswer(given);
    const { verdict, delta } = this.scorer.onAnswer(spec, parsed, ms);
    this.score += delta;
    this.log.push({ spec, given, verdict, delta, ms: verdict === 'skip' ? null : ms, firstKeyMs });

    const miss = verdict !== 'correct';
    const timeSignal = verdict === 'skip' ? null : ms;
    const firstKeySignal = verdict === 'skip' ? null : firstKeyMs;
    this.stats[spec.bucketId] = updateBucket(this.stats[spec.bucketId] ?? freshBucket(), miss, timeSignal, firstKeySignal);
    this.current = null;
    return { verdict, delta };
  }

  /** Time expired mid-question: the pending question is discarded, untouched. */
  discardCurrent(): void {
    this.current = null;
  }

  isDone(elapsedMs: number): boolean {
    return this.scorer.isDone({ elapsedMs, answered: this.log.length });
  }

  summary(startedAt: number): SessionSummary {
    const answered = this.log.length;
    const correct = this.log.filter((r) => r.verdict === 'correct').length;
    const times = this.log.map((r) => r.ms).filter((m): m is number => m !== null).sort((a, b) => a - b);
    const mid = times.length === 0 ? null
      : times.length % 2 === 1 ? (times[(times.length - 1) / 2] as number)
      : ((times[times.length / 2 - 1] as number) + (times[times.length / 2] as number)) / 2;
    const perBucket: Record<string, { n: number; misses: number }> = {};
    for (const r of this.log) {
      const e = (perBucket[r.spec.bucketId] ??= { n: 0, misses: 0 });
      e.n++;
      if (r.verdict !== 'correct') e.misses++;
    }
    return {
      id: `${this.config.seed.toString(16)}-${startedAt}`,
      startedAt,
      mode: this.config.mode,
      benchmark: isBenchmark(this.config),
      replay: this.config.replay,
      score: this.score,
      answered,
      correct,
      accuracy: answered === 0 ? 0 : correct / answered,
      medianMs: mid,
      durationSec: this.config.durationSec,
      focusLosses: this.focusLosses,
      perBucket,
      seedHex: this.config.seed.toString(16).padStart(8, '0'),
    };
  }

}
