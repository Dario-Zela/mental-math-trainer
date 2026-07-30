import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32 } from './rng';
import {
  ALL_BUCKETS, ZETA_BUCKETS, generateQuestion, bucketOp,
  MINUS, TIMES, DIVIDE, ARROW, RECIP_SET, type QuestionSpec,
} from './questions';
import { type Rational, rat, ratAdd, ratSub, ratMul, ratDiv, ratEq, isInteger, isTerminating, decimalPlaces } from './rational';

const EVERY_BUCKET = [...ALL_BUCKETS, ...ZETA_BUCKETS];

/**
 * Independent evaluator: parse the prompt string back into an expression and
 * evaluate it with rational arithmetic. Deliberately separate from the
 * generators — a shared bug can't cancel itself out.
 */
function evalPrompt(spec: QuestionSpec): Rational {
  const num = (s: string): Rational => {
    if (s.includes('/')) {
      const [n, d] = s.split('/');
      return rat(parseInt(n as string, 10), parseInt(d as string, 10));
    }
    if (s.includes('.')) {
      const [i, f] = s.split('.') as [string, string];
      return rat(parseInt(i + f, 10), Math.pow(10, f.length));
    }
    return rat(parseInt(s, 10));
  };
  const p = spec.prompt;
  const pctOf = p.match(/^(\d+)% of (\d+)$/);
  if (pctOf) return ratMul(rat(parseInt(pctOf[1] as string, 10), 100), num(pctOf[2] as string));
  const pctChange = p.match(new RegExp(`^(\\d+) ${ARROW} (\\d+), % change$`));
  if (pctChange) {
    const from = num(pctChange[1] as string);
    const to = num(pctChange[2] as string);
    return ratMul(ratDiv(ratSub(to, from), from), rat(100));
  }
  for (const [sym, fn] of [
    [` + `, ratAdd], [` ${MINUS} `, ratSub], [` ${TIMES} `, ratMul], [` ${DIVIDE} `, ratDiv],
  ] as const) {
    if (p.includes(sym)) {
      const [a, b] = p.split(sym) as [string, string];
      return fn(num(a), num(b));
    }
  }
  // recip: the prompt is the value itself ("1/32")
  return num(p);
}

/** §3 invariant: integer | small fraction | terminating decimal ≤ 4 dp. */
function isRepresentable(a: Rational): boolean {
  if (isInteger(a)) return true;
  if (isTerminating(a) && decimalPlaces(a) <= 4) return true;
  return a.den <= 144; // small fraction (frac buckets: lcm of dens ≤ 12·11)
}

const seedArb = fc.integer({ min: 0, max: 0xffffffff });

describe('generators', () => {
  it('every answer verifies against the independent evaluator, for every bucket', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        expect(q.bucketId).toBe(bucket);
        expect(ratEq(evalPrompt(q), q.answer)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('every answer satisfies the representability invariant (no tolerance grading anywhere)', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        expect(isRepresentable(q.answer)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('div answers are integers, sub answers are never negative', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET.filter((b) => /^(div|sub):/.test(b))), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        if (bucketOp(bucket) === 'div') expect(isInteger(q.answer)).toBe(true);
        else expect(q.answer.num).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('operands respect the declared class ranges', () => {
    const RANGES: Record<string, [number, number][]> = {
      'add:2d2d': [[10, 99], [10, 99]],
      'add:3d3d': [[100, 999], [100, 999]],
      'mul:1x2': [[2, 9], [10, 99]],
      'mul:2x2': [[10, 99], [10, 99]],
      'mul:1x3': [[2, 9], [100, 999]],
      'mul:zeta': [[2, 12], [2, 100]],
      'add:zeta': [[2, 100], [2, 100]],
    };
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...Object.keys(RANGES)), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        const [op1, op2] = q.prompt.split(/ [+×] /).map(Number);
        const [r1, r2] = RANGES[bucket] as [[number, number], [number, number]];
        // operand order is randomised, so match against either assignment
        const fits = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;
        expect(
          (fits(op1 as number, r1) && fits(op2 as number, r2)) ||
          (fits(op1 as number, r2) && fits(op2 as number, r1)),
        ).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('degenerate operands 0 and 1 never appear in add/sub/mul/div prompts', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET.filter((b) => /^(add|sub|mul|div):(?!zeta)/.test(b))), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        const operands = q.prompt.split(new RegExp(` [+${MINUS}${TIMES}${DIVIDE}] `)).map(Number);
        for (const o of operands) {
          expect(o).not.toBe(0);
          expect(o).not.toBe(1);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('recip draws only from the terminating set', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const q = generateQuestion('recip:term', mulberry32(seed), 0);
        const n = parseInt(q.prompt.split('/')[1] as string, 10);
        expect(RECIP_SET).toContain(n);
      }),
      { numRuns: 200 },
    );
  });

  it('pct_change is the only op that can produce negative answers', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET.filter((b) => !b.startsWith('pct_change'))), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        expect(q.answer.num).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('ugly pct answers terminate at ≤ 2 dp', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom('pct_of:ugly', 'pct_change:ugly'), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        expect(isTerminating(q.answer)).toBe(true);
        expect(decimalPlaces(q.answer)).toBeLessThanOrEqual(2);
      }),
      { numRuns: 1000 },
    );
  });

  it('the ring buffer suppresses exact repeats', () => {
    const rng = mulberry32(42);
    const recent: string[] = [];
    for (let i = 0; i < 200; i++) {
      const q = generateQuestion('recip:term', rng, 0, recent);
      expect(recent).not.toContain(q.prompt);
      recent.push(q.prompt);
      if (recent.length > 10) recent.shift();
    }
  });
});
