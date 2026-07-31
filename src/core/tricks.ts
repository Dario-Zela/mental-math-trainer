/**
 * The technique library behind coach mode. Two halves:
 *  - TECHNIQUES: the catalogue of mental-math tricks (name, when, how);
 *  - explain(spec): pick the best technique for a concrete question and
 *    produce worked steps using the REAL operands — "47 × 25: ×100 ÷ 4",
 *    not an abstract description.
 *
 * Pure and framework-free like the rest of the core. Contract (tested):
 * explain never returns null for a generatable question, and for exact-graded
 * questions the final step ends on the canonical answer.
 */
import {
  type QuestionSpec, MINUS, TIMES, DIVIDE, ARROW,
} from './questions';
import {
  type Rational, rat, ratSub, ratToDecimalString, ratToFractionString, isTerminating,
} from './rational';

export interface Technique {
  id: string;
  name: string;
  /** Primary bucket used for the Learn screen's live example + practice launch. */
  practiceBucket: string;
  summary: string;
  detail: string;
  /**
   * Hardcoded worked example, for tricks whose trigger is rare in generated
   * questions (35², 94×98) or that have no generator trigger at all
   * (divisibility rules). Cards without one show a live generated example.
   */
  example?: { prompt: string; steps: string[] };
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'left-to-right', name: 'Left to right', practiceBucket: 'add:2d2d',
    summary: 'Add the big parts first, then the small ones.',
    detail: 'School arithmetic goes right-to-left with carries; mental arithmetic goes the other way. 47 + 38: take 47 + 30 = 77, then + 8. You always hold one running number, and the first digits of the answer arrive first.',
  },
  {
    id: 'round-compensate', name: 'Round & compensate', practiceBucket: 'sub:2d2d',
    summary: 'Overshoot to a round number, then pay it back.',
    detail: 'Numbers ending in 8 or 9 are one step from a round number. 132 − 47: do 132 − 50 = 82, then give back 3. One easy operation plus one tiny correction beats borrowing every time.',
  },
  {
    id: 'split', name: 'Split & distribute', practiceBucket: 'mul:2x2',
    summary: 'Multiply by tens and units separately, then add.',
    detail: '47 × 83 = 47×80 + 47×3. Two easy products and one addition. Say the partial products out loud in your head — losing a partial is the main failure mode.',
  },
  {
    id: 'times-five', name: '×5, ×25, ×50 shortcuts', practiceBucket: 'mul:1x2',
    summary: '×5 is ×10 halved; ×25 is ×100 quartered.',
    detail: 'Fives are disguised tens: 86 × 5 = 860 ÷ 2 = 430. Same family: ×25 = ×100 ÷ 4, ×50 = ×100 ÷ 2, ×15 = ×10 plus half of that.',
  },
  {
    id: 'eleven', name: 'The 11 trick', practiceBucket: 'mul:zeta',
    summary: 'ab × 11: write a_b, put a+b in the middle.',
    detail: '52 × 11: 5_2 with 5+2=7 in the middle → 572. If the middle sum carries (85 × 11: 8+5=13), carry into the first digit: 935.',
  },
  {
    id: 'diff-squares', name: 'Difference of squares', practiceBucket: 'mul:2x2',
    summary: 'Numbers straddling a round midpoint: m² − d².',
    detail: '47 × 53 straddles 50: it is 50² − 3² = 2500 − 9 = 2491. Works whenever the two factors are the same distance either side of an easy square.',
  },
  {
    id: 'anchor', name: 'Times-table anchoring', practiceBucket: 'div:2x2',
    summary: 'Division is a times-table search: pin the tens digit first.',
    detail: '1161 ÷ 43: 43 × 20 = 860 fits, 43 × 30 = 1290 doesn\'t — the answer is twenty-something. 1161 − 860 = 301 = 43 × 7 → 27. Estimate the tens, subtract, finish with the units.',
  },
  {
    id: 'common-denominator', name: 'Common denominator', practiceBucket: 'frac_add:small',
    summary: 'Scale both fractions to the LCM, then add tops.',
    detail: '3/8 + 1/6: the LCM of 8 and 6 is 24, so 9/24 + 4/24 = 13/24. Keep the LCMs of small denominator pairs memorised — that IS the skill.',
  },
  {
    id: 'cancel-first', name: 'Cancel before multiplying', practiceBucket: 'frac_mul:small',
    summary: 'Cross-cancel common factors, then multiply small numbers.',
    detail: '3/8 × 4/9: cancel 3 with 9 and 4 with 8 → 1/2 × 1/3 = 1/6. Multiplying first (12/72) means reducing a big fraction later; cancelling first keeps everything small.',
  },
  {
    id: 'fraction-swap', name: 'Decimal ⇄ fraction swap', practiceBucket: 'dec_mul:clean',
    summary: '0.25 is ÷4, 0.5 is ÷2, 1.5 is +half.',
    detail: 'Clean decimals are fractions in disguise: 0.25 × 36 is 36 ÷ 4 = 9; 1.5 × 24 is 24 + 12. Know the family: .25 .5 .75 .125 1.25 2.5 12.5 — quarters, halves and eighths of powers of ten.',
  },
  {
    id: 'shift-the-point', name: 'Shift the point', practiceBucket: 'dec_mul:ugly',
    summary: 'Drop the decimal, multiply integers, put it back.',
    detail: '47 × 3.6: compute 47 × 36 = 1692, then restore the one decimal place → 169.2. Count decimal places once at the end instead of tracking them mid-multiply.',
  },
  {
    id: 'wholes-then-parts', name: 'Wholes, then parts', practiceBucket: 'dec_add:2dp',
    summary: 'Add whole parts and decimal parts separately.',
    detail: '12.75 + 8.46: wholes 12 + 8 = 20, decimals 0.75 + 0.46 = 1.21, total 21.21. For subtraction, round the number being subtracted up to a whole and compensate instead — no borrowing across the point.',
  },
  {
    id: 'scale-both', name: 'Scale both sides', practiceBucket: 'dec_div:1dp',
    summary: 'Clear the decimal divisor: double both or ×10 both.',
    detail: '84 ÷ 3.5: double both sides → 168 ÷ 7 = 24. A .5 divisor doubles into a whole; anything else can be ×10 on both sides. Division only cares about the ratio.',
  },
  {
    id: 'ten-percent-blocks', name: '10% building blocks', practiceBucket: 'pct_of:clean',
    summary: 'Build any percentage from 10%, 5% and 1%.',
    detail: '35% of 240: 10% is 24, so 30% is 72, and 5% is 12 → 84. Every percentage is a small shopping list of easy pieces. Bonus flip: p% of b equals b% of p — 84% of 25 is 25% of 84 = 21.',
  },
  {
    id: 'delta-over-base', name: 'Change over base', practiceBucket: 'pct_change:clean',
    summary: 'Percent change = the change, divided by 1% of the start.',
    detail: '80 → 92: the change is 12; 1% of 80 is 0.8; 12 ÷ 0.8 = 15%. Anchoring on 1% (or 10%) of the base turns percent-change into one division by an easy number.',
  },
  {
    id: 'halving-chain', name: 'Halving chains', practiceBucket: 'recip:term',
    summary: 'Reach 1/16, 1/32… by halving 1/2 repeatedly.',
    detail: '1/2 = 0.5 → 1/4 = 0.25 → 1/8 = 0.125 → 1/16 = 0.0625 → 1/32 = 0.03125. Reciprocals of 2ᵏ·5ʲ numbers are all halvings and point-shifts of these.',
  },
  {
    id: 'reciprocal-families', name: 'Reciprocal families', practiceBucket: 'recip:rep',
    summary: '1/3, 1/7, 1/9, 1/11 each seed a whole family.',
    detail: '1/3 = 0.333…, so 1/6 halves it (0.1667) and 1/12 halves again (0.0833). 1/7 = 0.142857 cycling; 1/9 = 0.111…; 1/11 = 0.0909…. Learn four seeds, derive the rest.',
  },
  {
    id: 'division-in-disguise', name: 'Division in disguise', practiceBucket: 'missing:mul',
    summary: 'a × ? = b is just b ÷ a — translate, then anchor.',
    detail: '66 × ? = 138.6 → ? = 138.6 ÷ 66. Scale away the decimal (1386 ÷ 66 = 21) and restore it → 2.1. The format flusters people; the arithmetic is ordinary division.',
  },
  {
    id: 'running-total', name: 'Hold the running total', practiceBucket: 'chain:mix',
    summary: 'Each step wraps your last answer — never recompute from scratch.',
    detail: '((7 × 8) − 3) ÷ 2: you already answered 7 × 8 = 56 and (7 × 8) − 3 = 53 in the previous steps, so the only new work is 53 ÷ 2 — except the numbers are built so it divides cleanly. Hold ONE running number and apply one operation; re-reading the whole expression from scratch is the trap.',
  },
  {
    id: 'round-adjust', name: 'Round, multiply, adjust', practiceBucket: 'fermi:mul',
    summary: 'Round to 2 significant figures, then correct by the % you moved.',
    detail: '48,213 × 677 ≈ 48,000 × 677 = 32.5M; you rounded 48,213 down by ~0.4%, so nudge the answer up ~0.4%. One rounding, one easy multiply, one percentage correction lands inside ±5%.',
  },
  {
    id: 'square-end-5', name: 'Squares ending in 5', practiceBucket: 'mul:2x2',
    summary: 'X5² = X·(X+1), then append 25.',
    detail: '35²: take the 3, multiply by one more (3×4 = 12), append 25 → 1225. Works for every number ending in 5 — 75² is 7×8 = 56 with 25 appended: 5625.',
    example: { prompt: '35 × 35', steps: ['3 × 4 = 12', 'append 25 → 1225'] },
  },
  {
    id: 'near-square', name: 'Squares near a round number', practiceBucket: 'mul:2x2',
    summary: '(n ± d)² = n² ± 2nd + d².',
    detail: '47² = (50 − 3)² = 2500 − 300 + 9 = 2209. Any square within a few of a round number is one expansion away; the d² term is tiny.',
    example: { prompt: '47 × 47', steps: ['(50 − 3)²', '2500 − 300 + 9 = 2209'] },
  },
  {
    id: 'same-tens', name: 'Same tens, units adding to 10', practiceBucket: 'mul:2x2',
    summary: 't·(t+1), then append the units product.',
    detail: '47 × 43: same tens digit, units 7+3 = 10. Front: 4 × 5 = 20. Back: 7 × 3 = 21. Answer 2021. The special case 45 × 45 is the squares-ending-in-5 rule.',
    example: { prompt: '47 × 43', steps: ['same tens, units 7+3 = 10', '4 × 5 = 20 | 7 × 3 = 21', '→ 2021'] },
  },
  {
    id: 'near-100', name: 'Near-100 base method', practiceBucket: 'mul:2x2',
    summary: 'Deficits from 100: cross-subtract, then multiply deficits.',
    detail: '94 × 98: deficits 6 and 2. Front: 94 − 2 (or 98 − 6) = 92. Back: 6 × 2 = 12. Answer 9212. The Vedic base method — brutal-looking products near 100 become two tiny steps.',
    example: { prompt: '94 × 98', steps: ['deficits from 100: 6 and 2', '94 − 2 = 92 | 6 × 2 = 12', '→ 9212'] },
  },
  {
    id: 'double-halve', name: 'Double one, halve the other', practiceBucket: 'mul:2x2',
    summary: 'a × b = (a/2) × 2b — trade toward round numbers.',
    detail: '16 × 35: halve 16, double 35 → 8 × 70 = 560. The product is unchanged; keep trading until one factor is round. Any even number times a 5-ender collapses this way.',
    example: { prompt: '16 × 35', steps: ['halve 16 → 8, double 35 → 70', '8 × 70 = 560'] },
  },
  {
    id: 'double-twice', name: '×4, ×8 by doubling', practiceBucket: 'mul:1x2',
    summary: '×4 is double-double; ×8 is double-double-double.',
    detail: '76 × 4: double to 152, double again to 304. Doubling is the fastest operation your head owns — chain it instead of multiplying by 4 or 8 directly.',
  },
  {
    id: 'halve-twice', name: '÷4, ÷8 by halving', practiceBucket: 'div:1x2',
    summary: '÷4 is halve-halve; ÷8 is halve-halve-halve.',
    detail: '344 ÷ 8: halve three times — 172, 86, 43. Same idea as ×4 by doubling, run backwards.',
  },
  {
    id: 'divide-by-five', name: '÷5, ÷25, ÷50 as multiplications', practiceBucket: 'div:1x2',
    summary: '÷5 = ×2 then ÷10; ÷25 = ×4 then ÷100.',
    detail: '435 ÷ 5: double to 870, shift the point → 87. Division by any 5-ish number is a multiplication in disguise plus a point-shift.',
  },
  {
    id: 'percent-as-fraction', name: 'Percent as fraction', practiceBucket: 'pct_of:clean',
    summary: '50% is half, 25% a quarter, 20% a fifth.',
    detail: '75% of 320: three quarters — a quarter is 80, so 240. Whenever the percent is a clean fraction, dividing beats building blocks.',
  },
  {
    id: 'percent-family', name: 'The eighths family', practiceBucket: 'pct_of:clean',
    summary: '12.5% = 1/8, 37.5% = 3/8 — know the family.',
    detail: 'The conversions 1/8 = 12.5%, 1/4 = 25%, 3/8 = 37.5%, 1/2 = 50%, 5/8 = 62.5%, 3/4 = 75%, 7/8 = 87.5% turn ugly percentages into single divisions. 12.5% of 88 is 88 ÷ 8 = 11.',
    example: { prompt: '12.5% of 88', steps: ['12.5% = 1/8', '88 ÷ 8 = 11'] },
  },
  {
    id: 'successive-percent', name: 'Stack percentages by multiplying', practiceBucket: 'pct_change:clean',
    summary: '+20% then −20% is ×1.2 × 0.8 = ×0.96, not zero.',
    detail: 'Successive percentage changes multiply: +10% then +10% is ×1.21 (+21%), up 25% then down 20% is ×1.25 × 0.8 = ×1 (flat). Never add them.',
    example: { prompt: '+20% then −20%', steps: ['×1.2 × 0.8 = ×0.96', 'net −4%'] },
  },
  {
    id: 'all-from-nine', name: 'All from 9, last from 10', practiceBucket: 'sub:3d3d',
    summary: 'Subtracting from 1000: complement each digit.',
    detail: '1000 − 437: take each digit from 9 and the last from 10 → 5, 6, 3 → 563. No borrowing, ever. Works for any power of ten.',
    example: { prompt: '1000 − 437', steps: ['9−4, 9−3, 10−7', '→ 563'] },
  },
  {
    id: 'divisibility', name: 'Divisibility checks', practiceBucket: 'div:2x2',
    summary: 'Digit sums for 3 and 9; last digits for 4 and 8.',
    detail: 'By 3/9: digit sum divisible by 3/9. By 4: last two digits divisible by 4. By 8: last three. By 11: alternating digit sum divisible by 11. In division, a quick check tells you whether a clean quotient even exists.',
    example: { prompt: 'is 3,474 divisible by 6?', steps: ['even ✓', 'digit sum 3+4+7+4 = 18 → ÷3 ✓', '→ yes'] },
  },
];

const TECHNIQUE_BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));

export function technique(id: string): Technique {
  const t = TECHNIQUE_BY_ID.get(id);
  if (!t) throw new Error(`unknown technique ${id}`);
  return t;
}

export interface Explanation {
  techniqueId: string;
  steps: string[];
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const gcd = (a: number, b: number): number => {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

const dec = ratToDecimalString;
const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Canonical answer rendering, matching what the drill/review display. */
export function answerDisplay(spec: QuestionSpec): string {
  if (spec.grading === 'sig3') return (spec.answer.num / spec.answer.den).toPrecision(3);
  if (spec.op === 'frac_add' || spec.op === 'frac_mul') return ratToFractionString(spec.answer);
  return isTerminating(spec.answer) ? dec(spec.answer) : ratToFractionString(spec.answer);
}

const num = (s: string): Rational => {
  if (s.includes('/')) {
    const [n, d] = s.split('/');
    return rat(parseInt(n as string, 10), parseInt(d as string, 10));
  }
  if (s.includes('.')) {
    const [i, f] = s.split('.') as [string, string];
    return rat(parseInt((i === '' ? '0' : i) + f, 10), Math.pow(10, f.length));
  }
  return rat(parseInt(s, 10));
};

function split2(prompt: string, sym: string): [Rational, Rational] {
  const [a, b] = prompt.split(` ${sym} `) as [string, string];
  return [num(a), num(b)];
}

/** Fractions AS WRITTEN — rat() would silently reduce 2/8 to 1/4 and desync the steps. */
interface RawFrac { num: number; den: number }
function rawFracs(prompt: string, sym: string): [RawFrac, RawFrac] {
  const parse = (s: string): RawFrac => {
    const [n, d] = s.split('/') as [string, string];
    return { num: parseInt(n, 10), den: parseInt(d, 10) };
  };
  const [a, b] = prompt.split(` ${sym} `) as [string, string];
  return [parse(a), parse(b)];
}

const fracStr = (f: RawFrac): string => `${f.num}/${f.den}`;

/* ------------------------------------------------------------------ */
/* per-family explainers                                              */
/* ------------------------------------------------------------------ */

function explainAdd(a: number, b: number): Explanation {
  const ans = a + b;
  // put the compensation candidate second
  if (a % 10 >= 8 && b % 10 < 8) [a, b] = [b, a];
  if (b % 10 >= 8) {
    const r = b + (10 - (b % 10));
    return {
      techniqueId: 'round-compensate',
      steps: [`${a} + ${r} = ${a + r}`, `${r - b} too many → ${a + r} − ${r - b} = ${ans}`],
    };
  }
  const t = Math.floor(b / 10) * 10;
  if (t === 0 || b % 10 === 0) return { techniqueId: 'left-to-right', steps: [`${a} + ${b} = ${ans}`] };
  return {
    techniqueId: 'left-to-right',
    steps: [`${a} + ${t} = ${a + t}`, `${a + t} + ${b % 10} = ${ans}`],
  };
}

function explainSub(m: number, s: number): Explanation {
  const ans = m - s;
  if (s % 10 >= 8) {
    const r = s + (10 - (s % 10));
    return {
      techniqueId: 'round-compensate',
      steps: [`${m} − ${r} = ${m - r}`, `${r - s} too many → ${m - r} + ${r - s} = ${ans}`],
    };
  }
  const t = Math.floor(s / 10) * 10;
  if (t === 0 || s % 10 === 0) return { techniqueId: 'left-to-right', steps: [`${m} − ${s} = ${ans}`] };
  return {
    techniqueId: 'left-to-right',
    steps: [`${m} − ${t} = ${m - t}`, `${m - t} − ${s % 10} = ${ans}`],
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function explainMul(a: number, b: number): Explanation {
  const ans = a * b;
  // squares ending in 5: X5² = X·(X+1) | 25
  if (a === b && a % 10 === 5) {
    const X = (a - 5) / 10;
    return {
      techniqueId: 'square-end-5',
      steps: [`${X} × ${X + 1} = ${X * (X + 1)}`, `append 25 → ${ans}`],
    };
  }
  // general squares near a round number: (n ± d)²
  if (a === b && a >= 13) {
    const n = Math.round(a / 10) * 10;
    const d = a - n;
    if (d !== 0) {
      const sign = d > 0 ? '+' : '−';
      return {
        techniqueId: 'near-square',
        steps: [
          `(${n} ${sign} ${Math.abs(d)})²`,
          `${n * n} ${sign} ${2 * n * Math.abs(d)} + ${d * d} = ${ans}`,
        ],
      };
    }
  }
  // same tens digit, units summing to 10: t·(t+1) | u₁·u₂
  if (a >= 10 && a <= 99 && b >= 10 && b <= 99 && a !== b &&
      Math.floor(a / 10) === Math.floor(b / 10) && (a % 10) + (b % 10) === 10) {
    const t = Math.floor(a / 10);
    return {
      techniqueId: 'same-tens',
      steps: [
        `same tens, units ${a % 10}+${b % 10} = 10`,
        `${t} × ${t + 1} = ${t * (t + 1)} | ${a % 10} × ${b % 10} = ${pad2((a % 10) * (b % 10))}`,
        `→ ${ans}`,
      ],
    };
  }
  // both a few below 100: Vedic base method
  if (a >= 91 && a <= 99 && b >= 91 && b <= 99) {
    const da = 100 - a;
    const db = 100 - b;
    return {
      techniqueId: 'near-100',
      steps: [
        `deficits from 100: ${da} and ${db}`,
        `${a} − ${db} = ${a - db} | ${da} × ${db} = ${pad2(da * db)}`,
        `→ ${ans}`,
      ],
    };
  }
  // fives family
  const fives = [a, b].find((x) => x === 5 || x === 25 || x === 50);
  if (fives !== undefined) {
    const other = fives === a ? b : a;
    if (fives === 5) return { techniqueId: 'times-five', steps: [`${other} × 10 = ${other * 10}`, `halve → ${ans}`] };
    if (fives === 50) return { techniqueId: 'times-five', steps: [`${other} × 100 = ${other * 100}`, `halve → ${ans}`] };
    return { techniqueId: 'times-five', steps: [`${other} × 100 = ${other * 100}`, `quarter → ${ans}`] };
  }
  // eleven trick, two-digit partner
  const eleven = a === 11 ? b : b === 11 ? a : undefined;
  if (eleven !== undefined && eleven >= 10 && eleven <= 99) {
    const d1 = Math.floor(eleven / 10);
    const d2 = eleven % 10;
    const mid = d1 + d2;
    const carry = mid >= 10 ? ' (carry the 1)' : '';
    return {
      techniqueId: 'eleven',
      steps: [`${eleven} × 11: ${d1}_${d2} with ${d1}+${d2}=${mid} in the middle${carry}`, `→ ${ans}`],
    };
  }
  // ×4 / ×8: chained doubling
  const pow2 = [a, b].find((x) => x === 4 || x === 8);
  if (pow2 !== undefined) {
    const o = pow2 === a ? b : a;
    return pow2 === 4
      ? { techniqueId: 'double-twice', steps: [`${o} × 2 = ${o * 2}`, `× 2 again → ${ans}`] }
      : { techniqueId: 'double-twice', steps: [`${o} × 2 = ${o * 2}`, `× 2 = ${o * 4}`, `× 2 again → ${ans}`] };
  }
  // even × 5-ender: double one, halve the other
  const fiveEnder = [a, b].find((x) => x % 10 === 5 && x > 10);
  if (fiveEnder !== undefined) {
    const other = fiveEnder === a ? b : a;
    if (other % 2 === 0) {
      return {
        techniqueId: 'double-halve',
        steps: [
          `halve ${other} → ${other / 2}, double ${fiveEnder} → ${fiveEnder * 2}`,
          `${other / 2} × ${fiveEnder * 2} = ${ans}`,
        ],
      };
    }
  }
  // nines: compensate
  const nine = [a, b].find((x) => x % 10 === 9 && x > 9);
  if (nine !== undefined) {
    const other = nine === a ? b : a;
    return {
      techniqueId: 'round-compensate',
      steps: [`${other} × ${nine + 1} = ${other * (nine + 1)}`, `one ${other} too many → ${other * (nine + 1)} − ${other} = ${ans}`],
    };
  }
  // difference of squares around a round midpoint
  if (a >= 10 && b >= 10 && (a + b) % 2 === 0) {
    const mid = (a + b) / 2;
    const d = Math.abs(a - b) / 2;
    if (mid % 10 === 0 && d > 0 && d <= 9) {
      return {
        techniqueId: 'diff-squares',
        steps: [`midpoint ${mid}, distance ${d}`, `${mid}² − ${d}² = ${mid * mid} − ${d * d} = ${ans}`],
      };
    }
  }
  // default: distributive split on the second-listed operand (prefer the multi-digit one)
  if (Math.floor(b / 10) === 0) [a, b] = [b, a];
  const t = Math.floor(b / 10) * 10;
  const u = b % 10;
  if (u === 0) return { techniqueId: 'split', steps: [`${a} × ${t} = ${ans}`] };
  if (t === 0) return { techniqueId: 'split', steps: [`${a} × ${u} = ${ans}`] };
  return {
    techniqueId: 'split',
    steps: [`${a} × ${t} = ${a * t}`, `${a} × ${u} = ${a * u}`, `${a * t} + ${a * u} = ${ans}`],
  };
}

function explainDiv(X: number, d: number): Explanation {
  const q = X / d;
  // ÷5, ÷25, ÷50: multiply and shift the point
  if (d === 5) return { techniqueId: 'divide-by-five', steps: [`double: ${X} × 2 = ${X * 2}`, `÷10 → ${q}`] };
  if (d === 25) return { techniqueId: 'divide-by-five', steps: [`× 4: ${X * 4}`, `÷100 → ${q}`] };
  if (d === 50) return { techniqueId: 'divide-by-five', steps: [`double: ${X * 2}`, `÷100 → ${q}`] };
  // ÷4, ÷8: chained halving
  if (d === 4) return { techniqueId: 'halve-twice', steps: [`half: ${X / 2}`, `half again → ${q}`] };
  if (d === 8) return { techniqueId: 'halve-twice', steps: [`half: ${X / 2}`, `half: ${X / 4}`, `half again → ${q}`] };
  const t = Math.floor(q / 10) * 10;
  if (t === 0 || q % 10 === 0) {
    return { techniqueId: 'anchor', steps: [`${d} × ${q} = ${X}`, `→ ${q}`] };
  }
  const rest = X - d * t;
  return {
    techniqueId: 'anchor',
    steps: [`${d} × ${t} = ${d * t}`, `left: ${X} − ${d * t} = ${rest}`, `${d} × ${q - t} = ${rest} → ${q}`],
  };
}

function explainFracAdd(f1: RawFrac, f2: RawFrac, answer: Rational): Explanation {
  const l = lcm(f1.den, f2.den);
  const n1 = (f1.num * l) / f1.den;
  const n2 = (f2.num * l) / f2.den;
  const steps = [
    `common denominator: lcm(${f1.den}, ${f2.den}) = ${l}`,
    `${fracStr(f1)} = ${n1}/${l}, ${fracStr(f2)} = ${n2}/${l}`,
    `${n1}/${l} + ${n2}/${l} = ${n1 + n2}/${l}`,
  ];
  if (answer.den !== l || answer.num !== n1 + n2) steps.push(`reduce → ${ratToFractionString(answer)}`);
  return { techniqueId: 'common-denominator', steps };
}

function explainFracMul(f1: RawFrac, f2: RawFrac, answer: Rational): Explanation {
  const g1 = gcd(f1.num, f2.den);
  const g2 = gcd(f2.num, f1.den);
  const steps: string[] = [];
  let [n1, d1, n2, d2] = [f1.num, f1.den, f2.num, f2.den];
  if (g1 > 1 || g2 > 1) {
    n1 /= g1; d2 /= g1; n2 /= g2; d1 /= g2;
    steps.push(`cross-cancel → ${n1}/${d1} × ${n2}/${d2}`);
  }
  steps.push(`multiply across: ${n1 * n2}/${d1 * d2}`);
  if (answer.num !== n1 * n2 || answer.den !== d1 * d2) steps.push(`reduce → ${ratToFractionString(answer)}`);
  return { techniqueId: 'cancel-first', steps };
}

/** Clean decimals as fractions: value string → [mult, div, phrasing]. */
const CLEAN_SWAPS: Record<string, [number, number]> = {
  '0.25': [1, 4], '0.5': [1, 2], '0.75': [3, 4], '1.25': [5, 4], '1.5': [3, 2],
  '2.5': [5, 2], '3.5': [7, 2], '7.5': [15, 2], '12.5': [25, 2],
};

function explainDecMul(spec: QuestionSpec): Explanation {
  const [aStr, bStr] = spec.prompt.split(` ${TIMES} `) as [string, string];
  const cleanStr = [aStr, bStr].find((s) => CLEAN_SWAPS[s]);
  if (cleanStr) {
    const other = cleanStr === aStr ? bStr : aStr;
    const [n, d] = CLEAN_SWAPS[cleanStr] as [number, number];
    const o = parseInt(other, 10);
    const steps = [`${cleanStr} = ${n}/${d}`];
    if (n !== 1) steps.push(`${other} × ${n} = ${o * n}`);
    steps.push(`÷${d} → ${answerDisplay(spec)}`);
    return { techniqueId: 'fraction-swap', steps };
  }
  // ugly: integer × 1dp — shift the point
  const int = parseInt(aStr.includes('.') ? bStr : aStr, 10);
  const decStr = aStr.includes('.') ? aStr : bStr;
  const tenths = Math.round(parseFloat(decStr) * 10);
  const inner = explainMul(int, tenths);
  return {
    techniqueId: 'shift-the-point',
    steps: [
      `ignore the point: ${int} × ${tenths}`,
      ...inner.steps,
      `one decimal place back → ${answerDisplay(spec)}`,
    ],
  };
}

function explainDecAdd(spec: QuestionSpec): Explanation {
  if (spec.prompt.includes(` ${MINUS} `)) {
    const [m, s] = split2(spec.prompt, MINUS);
    const r = rat(Math.ceil(s.num / s.den));
    const back = ratSub(r, s);
    return {
      techniqueId: 'wholes-then-parts',
      steps: [
        `round up: ${dec(m)} − ${dec(r)} = ${dec(ratSub(m, r))}`,
        `add back ${dec(back)} → ${answerDisplay(spec)}`,
      ],
    };
  }
  const [a, b] = split2(spec.prompt, '+');
  const wa = Math.floor(a.num / a.den);
  const wb = Math.floor(b.num / b.den);
  const fa = ratSub(a, rat(wa));
  const fb = ratSub(b, rat(wb));
  const fracSum = rat(fa.num * fb.den + fb.num * fa.den, fa.den * fb.den);
  return {
    techniqueId: 'wholes-then-parts',
    steps: [
      `wholes: ${wa} + ${wb} = ${wa + wb}`,
      `decimals: ${dec(fa)} + ${dec(fb)} = ${dec(fracSum)}`,
      `${wa + wb} + ${dec(fracSum)} = ${answerDisplay(spec)}`,
    ],
  };
}

function explainDecDiv(spec: QuestionSpec): Explanation {
  const [B, d] = split2(spec.prompt, DIVIDE);
  const dTenths = (d.num * 10) / d.den;
  if (dTenths % 5 === 0) {
    const B2 = rat(B.num * 2, B.den);
    const d2 = (d.num * 2) / d.den;
    return {
      techniqueId: 'scale-both',
      steps: [`double both: ${dec(B2)} ÷ ${d2}`, ...explainDiv(B2.num / B2.den, d2).steps],
    };
  }
  const B10 = (B.num * 10) / B.den;
  return {
    techniqueId: 'scale-both',
    steps: [`×10 both: ${B10} ÷ ${dTenths}`, ...explainDiv(B10, dTenths).steps],
  };
}

function explainPctOf(spec: QuestionSpec): Explanation {
  const m = spec.prompt.match(/^(\d+)% of (\d+)$/) as RegExpMatchArray;
  let p = parseInt(m[1] as string, 10);
  let b = parseInt(m[2] as string, 10);
  const steps: string[] = [];
  if (b < p && (b % 10 === 0 || b % 25 === 0)) {
    steps.push(`flip: ${p}% of ${b} = ${b}% of ${p}`);
    [p, b] = [b, p];
  }
  // clean-fraction percents beat building blocks
  if (p === 50) {
    steps.push(`50% = half`, `half of ${b} → ${answerDisplay(spec)}`);
    return { techniqueId: 'percent-as-fraction', steps };
  }
  if (p === 25) {
    steps.push(`25% = a quarter`, `${b} ÷ 4 = ${dec(rat(b, 4))}`, `→ ${answerDisplay(spec)}`);
    return { techniqueId: 'percent-as-fraction', steps };
  }
  if (p === 75) {
    steps.push(`75% = ¾`, `quarter: ${dec(rat(b, 4))}`, `× 3 → ${answerDisplay(spec)}`);
    return { techniqueId: 'percent-as-fraction', steps };
  }
  if (p === 20) {
    steps.push(`20% = a fifth`, `${b} ÷ 5 = ${dec(rat(b, 5))}`, `→ ${answerDisplay(spec)}`);
    return { techniqueId: 'percent-as-fraction', steps };
  }
  const ten = rat(b, 10);
  steps.push(`10% of ${b} = ${dec(ten)}`);
  const tens = Math.floor(p / 10);
  const rest = p % 10;
  if (tens > 1) steps.push(`${tens * 10}% = ${dec(rat(b * tens, 10))}`);
  if (rest === 5) steps.push(`5% = ${dec(rat(b, 20))}`);
  else if (rest !== 0) steps.push(`1% = ${dec(rat(b, 100))} → ${rest}% = ${dec(rat(b * rest, 100))}`);
  steps.push(`total → ${answerDisplay(spec)}`);
  return { techniqueId: 'ten-percent-blocks', steps };
}

function explainPctChange(spec: QuestionSpec): Explanation {
  const m = spec.prompt.match(new RegExp(`^(\\d+) ${ARROW} (\\d+), % change$`)) as RegExpMatchArray;
  const from = parseInt(m[1] as string, 10);
  const to = parseInt(m[2] as string, 10);
  const d = to - from;
  return {
    techniqueId: 'delta-over-base',
    steps: [
      `change: ${to} − ${from} = ${d}`,
      `1% of ${from} = ${dec(rat(from, 100))}`,
      `${d} ÷ ${dec(rat(from, 100))} = ${answerDisplay(spec)}`,
    ],
  };
}

const TERM_CHAINS: Record<number, string[]> = {
  2: ['1/2 = 0.5'],
  4: ['1/2 = 0.5', 'halve → 0.25'],
  5: ['1/5 = 2/10 = 0.2'],
  8: ['1/4 = 0.25', 'halve → 0.125'],
  10: ['1/10 = 0.1'],
  16: ['1/8 = 0.125', 'halve → 0.0625'],
  20: ['1/2 = 0.5', '÷10 → 0.05'],
  25: ['1/25 = 4/100 = 0.04'],
  32: ['1/16 = 0.0625', 'halve → 0.03125'],
  40: ['1/4 = 0.25', '÷10 → 0.025'],
  50: ['1/50 = 2/100 = 0.02'],
};

const REP_FACTS: Record<number, string[]> = {
  3: ['1/3 = 0.3333…'],
  6: ['1/3 = 0.333…', 'halve → 0.16667'],
  7: ['1/7 = 0.142857 (the cycling six)'],
  9: ['1/9 = 0.1111…'],
  11: ['1/11 = 0.090909…'],
  12: ['1/6 = 0.1667', 'halve → 0.08333'],
  14: ['1/7 = 0.142857', 'halve → 0.071428'],
  15: ['1/3 = 0.333…', '÷5 → 0.06667'],
};

function explainRecip(spec: QuestionSpec): Explanation {
  const n = parseInt(spec.prompt.split('/')[1] as string, 10);
  if (spec.operandClass === 'rep') {
    return {
      techniqueId: 'reciprocal-families',
      steps: [...(REP_FACTS[n] ?? [`1/${n}`]), `3 s.f. → ${answerDisplay(spec)}`],
    };
  }
  return {
    techniqueId: 'halving-chain',
    steps: [...(TERM_CHAINS[n] ?? []), `→ ${answerDisplay(spec)}`],
  };
}

function explainMissing(spec: QuestionSpec): Explanation {
  const m = spec.prompt.match(new RegExp(`^(\\d+) ${TIMES} \\? = ([\\d.]+)$`)) as RegExpMatchArray;
  const a = parseInt(m[1] as string, 10);
  const bStr = m[2] as string;
  const steps = [`? = ${bStr} ÷ ${a}`];
  if (bStr.includes('.')) {
    const b10 = Math.round(parseFloat(bStr) * 10);
    steps.push(`scale ×10: ${b10} ÷ ${a} = ${b10 / a}`);
    steps.push(`÷10 back → ${answerDisplay(spec)}`);
  } else {
    steps.push(...explainDiv(parseInt(bStr, 10), a).steps);
  }
  return { techniqueId: 'division-in-disguise', steps };
}

/** Chain: strip the parens and fold left-to-right — the nesting is left-associative. */
function explainChain(spec: QuestionSpec): Explanation {
  const tokens = spec.prompt.replace(/[()]/g, '').split(' ').filter((t) => t.length > 0);
  let value = parseInt(tokens[0] as string, 10);
  const steps: string[] = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const sym = tokens[i] as string;
    const operand = parseInt(tokens[i + 1] as string, 10);
    const next =
      sym === TIMES ? value * operand :
      sym === MINUS ? value - operand :
      sym === DIVIDE ? value / operand :
      value + operand;
    steps.push(`${value} ${sym} ${operand} = ${next}`);
    value = next;
  }
  return { techniqueId: 'running-total', steps };
}

/** Round to 2 significant figures. */
function round2sf(x: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / mag) * mag;
}

function explainFermi(spec: QuestionSpec): Explanation {
  const p = spec.prompt.replace(/,/g, '');
  const pretty = (x: number): string => group(Math.round(x));
  if (spec.operandClass === 'pct') {
    const m = p.match(/^(\d+)% of (\d+)$/) as RegExpMatchArray;
    const pct = parseInt(m[1] as string, 10);
    const base = parseInt(m[2] as string, 10);
    const p2 = pct >= 10 ? Math.round(pct / 10) * 10 : pct;
    const steps = [`10% of ${group(base)} = ${pretty(base / 10)}`, `${p2}% → ${pretty((base * p2) / 100)}`];
    if (p2 !== pct) {
      steps.push(`nudge for the ${pct - p2 > 0 ? '+' : ''}${pct - p2}% you dropped → ≈ ${pretty((base * pct) / 100)}`);
    } else {
      steps.push(`≈ ${pretty((base * pct) / 100)} (±5% scores)`);
    }
    return { techniqueId: 'round-adjust', steps };
  }
  const sym = spec.operandClass === 'mul' ? TIMES : DIVIDE;
  const [aStr, bStr] = p.split(` ${sym} `) as [string, string];
  const a = parseFloat(aStr);
  const b = parseFloat(bStr);
  const a2 = round2sf(a);
  const b2 = b >= 100 ? round2sf(b) : b;
  const rough = spec.operandClass === 'mul' ? a2 * b2 : a2 / b2;
  const exact = spec.operandClass === 'mul' ? a * b : a / b;
  const drift = ((exact - rough) / rough) * 100;
  return {
    techniqueId: 'round-adjust',
    steps: [
      `round both: ${group(a2)} ${sym} ${group(b2)}`,
      `≈ ${pretty(rough)}`,
      `rounding drift ${drift >= 0 ? '+' : ''}${drift.toFixed(1)}% → ≈ ${pretty(exact)} (±5% scores)`,
    ],
  };
}

/* ------------------------------------------------------------------ */

/** Worked solution for a concrete question, using its best technique. */
export function explain(spec: QuestionSpec): Explanation {
  switch (spec.op) {
    case 'add': {
      const [a, b] = split2(spec.prompt, '+');
      return explainAdd(a.num, b.num);
    }
    case 'sub': {
      const [m, s] = split2(spec.prompt, MINUS);
      return explainSub(m.num, s.num);
    }
    case 'mul': {
      const [a, b] = split2(spec.prompt, TIMES);
      return explainMul(a.num, b.num);
    }
    case 'div': {
      const [X, d] = split2(spec.prompt, DIVIDE);
      return explainDiv(X.num, d.num);
    }
    case 'frac_add': {
      const [f1, f2] = rawFracs(spec.prompt, '+');
      return explainFracAdd(f1, f2, spec.answer);
    }
    case 'frac_mul': {
      const [f1, f2] = rawFracs(spec.prompt, TIMES);
      return explainFracMul(f1, f2, spec.answer);
    }
    case 'dec_mul': return explainDecMul(spec);
    case 'dec_add': return explainDecAdd(spec);
    case 'dec_div': return explainDecDiv(spec);
    case 'pct_of': return explainPctOf(spec);
    case 'pct_change': return explainPctChange(spec);
    case 'recip': return explainRecip(spec);
    case 'missing': return explainMissing(spec);
    case 'chain': return explainChain(spec);
    case 'fermi': return explainFermi(spec);
    default: throw new Error(`no explainer for ${spec.op satisfies never}`);
  }
}
