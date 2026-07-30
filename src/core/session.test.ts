import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Session, makeConfig, isBenchmark, type SessionConfig } from './session';
import { ZETA_BUCKETS, ALL_BUCKETS } from './questions';
import { encodeSession, decodeSession } from './encode';
import { freshBucket, type BucketStats } from './buckets';
import { type Rational, ratToDecimalString, isTerminating } from './rational';

/** A correct answer in the input grammar: decimal when it terminates, fraction otherwise. */
function answerText(a: Rational): string {
  return isTerminating(a) ? ratToDecimalString(a) : `${a.num}/${a.den}`;
}

const zetaConfig = (): SessionConfig => makeConfig('zetamac', [...ZETA_BUCKETS], {}, 0xdeadbeef, 120);

function runPrompts(config: SessionConfig, n: number): string[] {
  const s = new Session(config);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = s.next();
    out.push(q.prompt);
    s.answer(answerText(q.answer), 1500, 600); // answer correctly
  }
  return out;
}

describe('session determinism', () => {
  it('same (seed, config) → byte-identical question sequence', () => {
    expect(runPrompts(zetaConfig(), 40)).toEqual(runPrompts(zetaConfig(), 40));
  });

  it('golden sequence for a pinned seed (breaks if generation order ever changes)', () => {
    expect(runPrompts(zetaConfig(), 12)).toMatchSnapshot();
  });

  it('different seeds → different sequences', () => {
    const other = { ...zetaConfig(), seed: 0x12345678 };
    expect(runPrompts(zetaConfig(), 20)).not.toEqual(runPrompts(other, 20));
  });

  it('no exact repeats within the 10-question ring window', () => {
    const prompts = runPrompts(makeConfig('focus', ['recip:term'], {}, 99), 100);
    for (let i = 0; i < prompts.length; i++) {
      expect(prompts.slice(Math.max(0, i - 10), i)).not.toContain(prompts[i]);
    }
  });
});

describe('session scoring & weakness updates', () => {
  it('correct answers score and update the bucket EWMA', () => {
    const s = new Session(makeConfig('focus', ['mul:2x2'], {}, 5));
    const q = s.next();
    const { verdict, delta } = s.answer(ratToDecimalString(q.answer), 3000, 1200);
    expect(verdict).toBe('correct');
    expect(delta).toBe(1);
    const b = s.bucketStats()['mul:2x2'] as BucketStats;
    expect(b.attempts).toBe(1);
    expect(b.errRate).toBe(0);
    expect(b.meanMs).toBe(3000);
    expect(b.meanFirstKeyMs).toBe(1200);
  });

  it('skips count as misses for errRate but never touch meanMs', () => {
    const s = new Session(makeConfig('optiver', ['add:2d2d'], {}, 5));
    s.next();
    const { verdict, delta } = s.answer(null, 4000, null);
    expect(verdict).toBe('skip');
    expect(delta).toBe(0);
    const b = s.bucketStats()['add:2d2d'] as BucketStats;
    expect(b.errRate).toBe(1);
    expect(b.meanMs).toBe(0); // no time signal recorded
  });

  it('optiver wrong answers cost a point; net score can go negative', () => {
    const s = new Session(makeConfig('optiver', ['add:2d2d'], {}, 5));
    s.next();
    s.answer('1', 2000, 500);
    s.next();
    s.answer('1', 2000, 500);
    expect(s.score).toBe(-2);
  });

  it('time expiry mid-question discards the pending question untouched', () => {
    const s = new Session(zetaConfig());
    s.next();
    s.discardCurrent();
    expect(s.log).toHaveLength(0);
    expect(Object.keys(s.bucketStats())).toHaveLength(0);
    expect(s.isDone(120_000)).toBe(true);
    expect(s.isDone(119_999)).toBe(false);
  });

  it('optiver finishes at 80 questions even with time left', () => {
    const s = new Session(makeConfig('optiver', ['add:2d2d'], {}, 5));
    for (let i = 0; i < 80; i++) {
      s.next();
      s.answer(null, null, null);
    }
    expect(s.isDone(60_000)).toBe(true);
  });

  it('sim mode hides the running score; zetamac shows it', () => {
    expect(new Session(makeConfig('optiver', ['add:2d2d'], {}, 1)).scorer.rules.showRunningScore).toBe(false);
    expect(new Session(zetaConfig()).scorer.rules.showRunningScore).toBe(true);
  });

  it('voided timing (focus loss, untimed) still counts correctness', () => {
    const s = new Session(makeConfig('focus', ['add:2d2d'], {}, 5));
    const q = s.next();
    s.answer(ratToDecimalString(q.answer), null, null);
    const b = s.bucketStats()['add:2d2d'] as BucketStats;
    expect(b.attempts).toBe(1);
    expect(b.meanMs).toBe(0);
    expect(s.score).toBe(1);
  });

  it('summary aggregates score, accuracy, median and per-bucket counts', () => {
    const s = new Session(makeConfig('optiver', ['add:2d2d'], {}, 5));
    const q1 = s.next();
    s.answer(ratToDecimalString(q1.answer), 1000, 400);
    s.next();
    s.answer('1', 3000, 900);
    s.next();
    s.answer(null, null, null);
    const sum = s.summary(1_700_000_000_000);
    expect(sum.score).toBe(0); // +1 −1 +0
    expect(sum.answered).toBe(3);
    expect(sum.correct).toBe(1);
    expect(sum.accuracy).toBeCloseTo(1 / 3);
    expect(sum.medianMs).toBe(2000);
    expect(sum.perBucket['add:2d2d']).toEqual({ n: 3, misses: 2 });
    expect(sum.benchmark).toBe(false);
  });
});

describe('benchmark detection & weight snapshots', () => {
  it('zeta buckets at 120s are the benchmark; anything custom is not', () => {
    expect(isBenchmark(zetaConfig())).toBe(true);
    expect(isBenchmark(makeConfig('zetamac', [...ZETA_BUCKETS], {}, 1, 300))).toBe(false);
    expect(isBenchmark(makeConfig('zetamac', ['add:2d2d'], {}, 1, 120))).toBe(false);
    expect(isBenchmark(makeConfig('optiver', [...ZETA_BUCKETS], {}, 1))).toBe(false);
  });

  it('zetamac-parity sessions sample ops uniformly even with skewed stats', () => {
    const skewed: Record<string, BucketStats> = {};
    for (const b of ZETA_BUCKETS) skewed[b] = { attempts: 50, errRate: 0.9, meanMs: 15_000, meanFirstKeyMs: 5000 };
    expect(makeConfig('zetamac', [...ZETA_BUCKETS], skewed, 1, 120).weights).toEqual([0, 0, 0, 0]);
  });

  it('custom sessions snapshot weakness into the config', () => {
    const stats: Record<string, BucketStats> = {
      'add:2d2d': { attempts: 50, errRate: 0.8, meanMs: 9000, meanFirstKeyMs: 2000 },
      'mul:2x2': { attempts: 50, errRate: 0, meanMs: 4000, meanFirstKeyMs: 1500 },
    };
    const config = makeConfig('optiver', ['add:2d2d', 'mul:2x2'], stats, 1);
    expect(config.weights[0]).toBeGreaterThan(config.weights[1] as number);
  });

  it('cold-start stats produce an all-zero snapshot', () => {
    const stats = { 'add:2d2d': { ...freshBucket(), attempts: 2 } };
    expect(makeConfig('optiver', ['add:2d2d', 'mul:2x2'], stats, 1).weights).toEqual([0, 0]);
  });
});

describe('URL codec', () => {
  const configArb: fc.Arbitrary<SessionConfig> = fc
    .record({
      mode: fc.constantFrom('zetamac' as const, 'optiver' as const, 'focus' as const),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      bucketIdx: fc.uniqueArray(fc.integer({ min: 0, max: ALL_BUCKETS.length - 1 }), { minLength: 1, maxLength: 8 }),
      durationSec: fc.constantFrom(30, 60, 120, 300),
      weightSeed: fc.integer({ min: 0, max: 15 }),
    })
    .map(({ mode, seed, bucketIdx, durationSec, weightSeed }) => {
      const buckets = mode === 'focus'
        ? [ALL_BUCKETS[bucketIdx[0] as number] as string]
        : bucketIdx.sort((a, b) => a - b).map((i) => ALL_BUCKETS[i] as string);
      return {
        mode, seed, buckets,
        weights: buckets.map((_, i) => (weightSeed + i) % 16),
        durationSec: mode === 'zetamac' ? durationSec : mode === 'optiver' ? 480 : null,
        replay: true,
      };
    });

  it('round-trips every config (property)', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const decoded = decodeSession(encodeSession(config));
        expect(decoded).toEqual(config);
      }),
      { numRuns: 500 },
    );
  });

  it('replaying a decoded config reproduces the exact question sequence', () => {
    const original = makeConfig('optiver', ['mul:2x2', 'frac_add:small', 'pct_of:clean'], {}, 0xcafe01);
    const shared = decodeSession(encodeSession(original)) as SessionConfig;
    expect(shared.replay).toBe(true);
    expect(runPrompts(shared, 30)).toEqual(runPrompts(original, 30));
  });

  it('malformed input never throws, always null', () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        expect(() => decodeSession(junk)).not.toThrow();
      }),
      { numRuns: 500 },
    );
    expect(decodeSession('m=z&s=xyz&b=1')).toBeNull();
    expect(decodeSession('m=q&s=ff&b=1&t=120')).toBeNull();
    expect(decodeSession('m=z&s=ff&b=0&t=120')).toBeNull();
    expect(decodeSession('m=z&s=ff&b=1')).toBeNull(); // zetamac needs a duration
    expect(decodeSession('m=z&s=ff&b=1&t=5')).toBeNull(); // absurd duration
    expect(decodeSession('')).toBeNull();
  });
});
