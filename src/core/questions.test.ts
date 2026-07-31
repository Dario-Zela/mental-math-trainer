import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32 } from './rng';
import {
  ALL_BUCKETS, ZETA_BUCKETS, FERMI_BUCKETS, OPTIVER_BUCKETS, CODEC_BUCKETS, generateQuestion, bucketOp,
  MINUS, TIMES, DIVIDE, ARROW, RECIP_SET, RECIP_REP_SET, type QuestionSpec,
} from './questions';
import { type Rational, rat, ratAdd, ratSub, ratMul, ratDiv, ratEq, isInteger, isTerminating, decimalPlaces } from './rational';

const EVERY_BUCKET = [...ALL_BUCKETS, ...ZETA_BUCKETS, ...FERMI_BUCKETS, 'chain:mix'];

/**
 * Independent evaluator: parse the prompt string back into an expression and
 * evaluate it with rational arithmetic. Deliberately separate from the
 * generators — a shared bug can't cancel itself out.
 */
function evalPrompt(spec: QuestionSpec): Rational {
  // strip thousands-group commas (fermi prompts) without touching the
  // list comma in "240 → 252, % change"
  let p0 = spec.prompt;
  for (let prev = ''; prev !== p0; ) {
    prev = p0;
    p0 = p0.replace(/(\d),(\d{3})/g, '$1$2');
  }
  spec = { ...spec, prompt: p0 };
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
  // chains are strictly left-associative: strip the parens and fold
  if (spec.op === 'chain') {
    const tokens = p.replace(/[()]/g, '').split(' ').filter((t) => t.length > 0);
    let v = num(tokens[0] as string);
    for (let i = 1; i < tokens.length; i += 2) {
      const o = num(tokens[i + 1] as string);
      v = tokens[i] === TIMES ? ratMul(v, o)
        : tokens[i] === MINUS ? ratSub(v, o)
        : tokens[i] === DIVIDE ? ratDiv(v, o)
        : ratAdd(v, o);
    }
    return v;
  }
  // missing-operand: a × ? = b — the answer IS the hidden operand, b ÷ a
  const missing = p.match(new RegExp(`^([\\d.]+) ${TIMES} \\? = ([\\d.]+)$`));
  if (missing) return ratDiv(num(missing[2] as string), num(missing[1] as string));
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

  it('every exactly-graded answer satisfies the representability invariant', () => {
    // fermi is exempt by design: it grades at ±5% relative error, so its
    // answers are never typed exactly and need not be exactly typeable.
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET.filter((b) => !b.startsWith('fermi:'))), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        expect(isRepresentable(q.answer)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('grading mode follows the bucket: exact everywhere except recip:rep (sig3) and fermi (rel5)', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...EVERY_BUCKET), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        const expected = bucket.startsWith('fermi:') ? 'rel5' : bucket === 'recip:rep' ? 'sig3' : 'exact';
        expect(q.grading).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('codec bucket universe is append-only: v1 indices are pinned forever', () => {
    // Challenge URLs index into CODEC_BUCKETS by bit position — these
    // assertions failing means every shared link in the wild just broke.
    expect(CODEC_BUCKETS.slice(23, 27)).toEqual([...ZETA_BUCKETS]);
    expect(CODEC_BUCKETS[22]).toBe('recip:term');
    expect(CODEC_BUCKETS.indexOf('recip:rep')).toBe(27);
    expect(CODEC_BUCKETS.slice(31)).toEqual([
      'missing:mul', 'dec_add:2dp', 'dec_div:1dp', 'mul:1x1', 'add:1d1d', 'sub:1d1d', 'chain:mix',
    ]);
    for (const b of EVERY_BUCKET) expect(CODEC_BUCKETS).toContain(b);
    expect(new Set(CODEC_BUCKETS).size).toBe(CODEC_BUCKETS.length);
  });

  it('the Optiver sim mix contains only evidence-backed, exact-graded buckets', () => {
    for (const b of OPTIVER_BUCKETS) {
      expect(ALL_BUCKETS).toContain(b); // real custom-drill buckets, never zeta/fermi
      // no percentages, no standalone reciprocals: absent from every candidate account
      expect(b).not.toMatch(/^(pct_of|pct_change|recip):/);
    }
    // the distinctive shapes ARE present: 2×2 mults, decimal ±/÷, missing operand
    for (const required of ['mul:2x2', 'div:2x2', 'dec_add:2dp', 'dec_div:1dp', 'missing:mul']) {
      expect(OPTIVER_BUCKETS).toContain(required);
    }
  });

  it('missing-operand: known factor from the times tables, hidden factor int or 1dp', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const q = generateQuestion('missing:mul', mulberry32(seed), 0);
        const known = parseInt(q.prompt.split(` ${TIMES} `)[0] as string, 10);
        expect(known).toBeGreaterThanOrEqual(2);
        expect(known).toBeLessThanOrEqual(19);
        expect(isTerminating(q.answer)).toBe(true);
        expect(decimalPlaces(q.answer)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  it('decimal ± answers stay exact at ≤ 2dp; decimal ÷ answers are integers', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const add = generateQuestion('dec_add:2dp', mulberry32(seed), 0);
        expect(isTerminating(add.answer)).toBe(true);
        expect(decimalPlaces(add.answer)).toBeLessThanOrEqual(2);
        expect(add.answer.num).toBeGreaterThanOrEqual(0); // sub variant is the inverse of add
        const div = generateQuestion('dec_div:1dp', mulberry32(seed), 0);
        expect(isInteger(div.answer)).toBe(true);
      }),
      { numRuns: 500 },
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
      'add:1d1d': [[2, 9], [2, 9]],
      'mul:1x1': [[2, 9], [2, 9]],
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

  it('recip classes draw from their own sets: term terminating, rep repeating', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom('term', 'rep'), (seed, cls) => {
        const q = generateQuestion(`recip:${cls}`, mulberry32(seed), 0);
        const n = parseInt(q.prompt.split('/')[1] as string, 10);
        if (cls === 'term') {
          expect(RECIP_SET).toContain(n);
          expect(isTerminating(q.answer)).toBe(true);
        } else {
          expect(RECIP_REP_SET).toContain(n);
          expect(isTerminating(q.answer)).toBe(false);
        }
      }),
      { numRuns: 300 },
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

  it('difficulty anneals operand ceilings within the class; zeta ignores it', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        // mul:2x2 at difficulty 0: both operands confined to the bottom 40% of 10..99
        const easy = generateQuestion('mul:2x2', mulberry32(seed), 0, [], 0);
        const [a, b] = easy.prompt.split(` ${TIMES} `).map(Number) as [number, number];
        expect(a).toBeLessThanOrEqual(46);
        expect(b).toBeLessThanOrEqual(46);
        // zeta parity never anneals: full 2..100 range stays reachable
        const zeta = generateQuestion('mul:zeta', mulberry32(seed), 0, [], 0);
        const ops = zeta.prompt.split(` ${TIMES} `).map(Number) as [number, number];
        expect(Math.max(...ops)).toBeLessThanOrEqual(100);
      }),
      { numRuns: 500 },
    );
    // and at difficulty 0 the zeta range is still the FULL range: over many
    // draws something above the annealed ceiling must appear
    const rng = mulberry32(7);
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) {
      const q = generateQuestion('mul:zeta', rng, 0, [], 0);
      seen.push(...(q.prompt.split(` ${TIMES} `).map(Number) as number[]));
    }
    expect(Math.max(...seen)).toBeGreaterThan(61); // annealed ceiling would be 2+round(98·0.4)=41
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
