import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32 } from './rng';
import {
  ALL_BUCKETS, ZETA_BUCKETS, FERMI_BUCKETS, generateQuestion, gradingFor,
  type QuestionSpec, type Op,
} from './questions';
import { rat } from './rational';
import { TECHNIQUES, technique, explain, answerDisplay } from './tricks';

const EVERY_BUCKET = [...ALL_BUCKETS, ...ZETA_BUCKETS, ...FERMI_BUCKETS, 'chain:mix'];

function spec(op: Op, operandClass: string, prompt: string, answer: ReturnType<typeof rat>): QuestionSpec {
  const bucketId = `${op}:${operandClass}`;
  return { op, operandClass, bucketId, prompt, answer, grading: gradingFor(bucketId), generatedAt: 0 };
}

describe('technique catalogue', () => {
  it('ids are unique and practice buckets are real', () => {
    expect(new Set(TECHNIQUES.map((t) => t.id)).size).toBe(TECHNIQUES.length);
    for (const t of TECHNIQUES) {
      expect(EVERY_BUCKET).toContain(t.practiceBucket);
    }
  });
});

describe('explain — coverage contract', () => {
  it('every generatable question in every bucket gets a worked solution', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(...EVERY_BUCKET), (seed, bucket) => {
        const q = generateQuestion(bucket, mulberry32(seed), 0);
        const e = explain(q);
        expect(e.steps.length).toBeGreaterThanOrEqual(1);
        expect(technique(e.techniqueId).id).toBe(e.techniqueId); // resolves in the catalogue
      }),
      { numRuns: 2000 },
    );
  });

  it('for exactly-graded questions the final step lands on the canonical answer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.constantFrom(...EVERY_BUCKET.filter((b) => !b.startsWith('fermi:'))),
        (seed, bucket) => {
          const q = generateQuestion(bucket, mulberry32(seed), 0);
          const e = explain(q);
          expect(e.steps[e.steps.length - 1]).toContain(answerDisplay(q));
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('explain — pinned worked examples (the trick chosen matches the operands)', () => {
  it('addition near a round number compensates; otherwise left-to-right', () => {
    expect(explain(spec('add', '2d2d', '47 + 38', rat(85)))).toEqual({
      techniqueId: 'round-compensate',
      steps: ['47 + 40 = 87', '2 too many → 87 − 2 = 85'],
    });
    expect(explain(spec('add', '2d2d', '47 + 32', rat(79)))).toEqual({
      techniqueId: 'left-to-right',
      steps: ['47 + 30 = 77', '77 + 2 = 79'],
    });
  });

  it('subtraction: overshoot and pay back', () => {
    expect(explain(spec('sub', '2d2d', '132 − 48', rat(84)))).toEqual({
      techniqueId: 'round-compensate',
      steps: ['132 − 50 = 82', '2 too many → 82 + 2 = 84'],
    });
  });

  it('multiplication picks fives, elevens, squares or the split', () => {
    expect(explain(spec('mul', '1x2', '86 × 5', rat(430)))).toEqual({
      techniqueId: 'times-five',
      steps: ['86 × 10 = 860', 'halve → 430'],
    });
    expect(explain(spec('mul', 'zeta', '52 × 11', rat(572))).techniqueId).toBe('eleven');
    expect(explain(spec('mul', '2x2', '47 × 53', rat(2491)))).toEqual({
      techniqueId: 'diff-squares',
      steps: ['midpoint 50, distance 3', '50² − 3² = 2500 − 9 = 2491'],
    });
    expect(explain(spec('mul', '2x2', '47 × 83', rat(3901)))).toEqual({
      techniqueId: 'split',
      steps: ['47 × 80 = 3760', '47 × 3 = 141', '3760 + 141 = 3901'],
    });
  });

  it('researched multiplication tricks fire on their exact patterns', () => {
    // squares ending in 5: X·(X+1) | 25
    expect(explain(spec('mul', '2x2', '35 × 35', rat(1225)))).toEqual({
      techniqueId: 'square-end-5',
      steps: ['3 × 4 = 12', 'append 25 → 1225'],
    });
    // general squares near a round number
    expect(explain(spec('mul', '2x2', '47 × 47', rat(2209)))).toEqual({
      techniqueId: 'near-square',
      steps: ['(50 − 3)²', '2500 − 300 + 9 = 2209'],
    });
    // same tens, units summing to 10
    expect(explain(spec('mul', '2x2', '47 × 43', rat(2021)))).toEqual({
      techniqueId: 'same-tens',
      steps: ['same tens, units 7+3 = 10', '4 × 5 = 20 | 7 × 3 = 21', '→ 2021'],
    });
    // Vedic near-100 base method
    expect(explain(spec('mul', '2x2', '94 × 98', rat(9212)))).toEqual({
      techniqueId: 'near-100',
      steps: ['deficits from 100: 6 and 2', '94 − 2 = 92 | 6 × 2 = 12', '→ 9212'],
    });
    // double one, halve the other
    expect(explain(spec('mul', '2x2', '16 × 35', rat(560)))).toEqual({
      techniqueId: 'double-halve',
      steps: ['halve 16 → 8, double 35 → 70', '8 × 70 = 560'],
    });
    // ×4 by doubling twice
    expect(explain(spec('mul', '1x2', '4 × 76', rat(304)))).toEqual({
      techniqueId: 'double-twice',
      steps: ['76 × 2 = 152', '× 2 again → 304'],
    });
  });

  it('researched division tricks: ÷5 doubles, ÷4 halves', () => {
    expect(explain(spec('div', '1x2', '435 ÷ 5', rat(87)))).toEqual({
      techniqueId: 'divide-by-five',
      steps: ['double: 435 × 2 = 870', '÷10 → 87'],
    });
    expect(explain(spec('div', '1x2', '344 ÷ 8', rat(43)))).toEqual({
      techniqueId: 'halve-twice',
      steps: ['half: 172', 'half: 86', 'half again → 43'],
    });
  });

  it('clean-fraction percents divide instead of building blocks', () => {
    expect(explain(spec('pct_of', 'clean', '75% of 320', rat(240)))).toEqual({
      techniqueId: 'percent-as-fraction',
      steps: ['75% = ¾', 'quarter: 80', '× 3 → 240'],
    });
    expect(explain(spec('pct_of', 'clean', '50% of 240', rat(120))).techniqueId).toBe('percent-as-fraction');
  });

  it('division anchors on the times table', () => {
    expect(explain(spec('div', '2x2', '1161 ÷ 43', rat(27)))).toEqual({
      techniqueId: 'anchor',
      steps: ['43 × 20 = 860', 'left: 1161 − 860 = 301', '43 × 7 = 301 → 27'],
    });
  });

  it('fractions: common denominator, and cross-cancelling before multiplying', () => {
    expect(explain(spec('frac_add', 'small', '3/8 + 1/6', rat(13, 24)))).toEqual({
      techniqueId: 'common-denominator',
      steps: ['common denominator: lcm(8, 6) = 24', '3/8 = 9/24, 1/6 = 4/24', '9/24 + 4/24 = 13/24'],
    });
    expect(explain(spec('frac_mul', 'small', '3/8 × 4/9', rat(1, 6)))).toEqual({
      techniqueId: 'cancel-first',
      steps: ['cross-cancel → 1/2 × 1/3', 'multiply across: 1/6'],
    });
    // unreduced operands still walk cleanly and end reduced
    const unreduced = explain(spec('frac_add', 'small', '2/8 + 1/6', rat(5, 12)));
    expect(unreduced.steps[unreduced.steps.length - 1]).toContain('5/12');
  });

  it('decimals: fraction swap, point shift, wholes-then-parts, scale-both', () => {
    expect(explain(spec('dec_mul', 'clean', '0.25 × 36', rat(9)))).toEqual({
      techniqueId: 'fraction-swap',
      steps: ['0.25 = 1/4', '÷4 → 9'],
    });
    const shift = explain(spec('dec_mul', 'ugly', '47 × 3.6', rat(1692, 10)));
    expect(shift.techniqueId).toBe('shift-the-point');
    expect(shift.steps[0]).toBe('ignore the point: 47 × 36');
    expect(shift.steps[shift.steps.length - 1]).toBe('one decimal place back → 169.2');
    expect(explain(spec('dec_add', '2dp', '12.75 + 8.46', rat(2121, 100)))).toEqual({
      techniqueId: 'wholes-then-parts',
      steps: ['wholes: 12 + 8 = 20', 'decimals: 0.75 + 0.46 = 1.21', '20 + 1.21 = 21.21'],
    });
    expect(explain(spec('dec_div', '1dp', '84 ÷ 3.5', rat(24)))).toEqual({
      techniqueId: 'scale-both',
      steps: ['double both: 168 ÷ 7', '7 × 20 = 140', 'left: 168 − 140 = 28', '7 × 4 = 28 → 24'],
    });
  });

  it('percentages build from 10% blocks; percent change anchors on 1%', () => {
    expect(explain(spec('pct_of', 'clean', '35% of 240', rat(84)))).toEqual({
      techniqueId: 'ten-percent-blocks',
      steps: ['10% of 240 = 24', '30% = 72', '5% = 12', 'total → 84'],
    });
    expect(explain(spec('pct_change', 'clean', '80 → 92, % change', rat(15)))).toEqual({
      techniqueId: 'delta-over-base',
      steps: ['change: 92 − 80 = 12', '1% of 80 = 0.8', '12 ÷ 0.8 = 15'],
    });
  });

  it('reciprocals: halving chains and family seeds', () => {
    expect(explain(spec('recip', 'term', '1/16', rat(1, 16)))).toEqual({
      techniqueId: 'halving-chain',
      steps: ['1/8 = 0.125', 'halve → 0.0625', '→ 0.0625'],
    });
    const seventh = explain(spec('recip', 'rep', '1/7', rat(1, 7)));
    expect(seventh.techniqueId).toBe('reciprocal-families');
    expect(seventh.steps[seventh.steps.length - 1]).toContain('0.143');
  });

  it('missing operands translate to division, scaling the decimal away', () => {
    expect(explain(spec('missing', 'mul', '66 × ? = 138.6', rat(21, 10)))).toEqual({
      techniqueId: 'division-in-disguise',
      steps: ['? = 138.6 ÷ 66', 'scale ×10: 1386 ÷ 66 = 21', '÷10 back → 2.1'],
    });
  });

  it('chains explain as a running total, one step per operation', () => {
    const e = explain(spec('chain', 'mix', '((7 × 8) − 3) ÷ 2', rat(53, 2)));
    // note: crafted spec; real chains always divide exactly — steps still fold correctly
    expect(e.techniqueId).toBe('running-total');
    expect(e.steps[0]).toBe('7 × 8 = 56');
    expect(e.steps[1]).toBe('56 − 3 = 53');
  });

  it('fermi rounds both operands and reports the drift', () => {
    const e = explain(spec('fermi', 'mul', '48,213 × 677', rat(48_213 * 677)));
    expect(e.techniqueId).toBe('round-adjust');
    expect(e.steps[0]).toContain('48,000');
    expect(e.steps[e.steps.length - 1]).toContain('±5%');
  });
});
