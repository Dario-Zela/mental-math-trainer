/**
 * Question generators. Parameterised, not enumerated: each Op has a generator
 * over its operand classes (the difficulty ladder). Invariants, property-tested:
 *  - every answer is an integer, a small fraction, or a terminating decimal ≤ 4 dp
 *    (so exact-equality grading needs no tolerance anywhere);
 *  - operands 0 and 1 never appear unless the class says otherwise;
 *  - div answers are always integers, sub answers never negative (both generated
 *    as inverses);
 *  - the `zeta` classes lock ranges to Zetamac's defaults so scores stay
 *    honestly comparable to community numbers.
 */
import { type Rng, randInt, pick } from './rng';
import { type Rational, rat, ratAdd, ratMul, ratToDecimalString } from './rational';

export type Op =
  | 'add' | 'sub' | 'mul' | 'div'
  | 'frac_add' | 'frac_mul'
  | 'dec_mul' | 'pct_of' | 'pct_change' | 'recip'
  | 'fermi';

/**
 * How an answer is graded. 'exact' is the v1 invariant (rational equality);
 * the tolerance modes exist only for stretch buckets whose true answers are
 * not exactly typeable: 'sig3' = correct to 3 significant figures (repeating
 * reciprocals), 'rel5' = within ±5% relative error (Fermi estimation).
 */
export type Grading = 'exact' | 'sig3' | 'rel5';

export interface QuestionSpec {
  op: Op;
  operandClass: string;
  /** `${op}:${operandClass}` — the SRS unit. */
  bucketId: string;
  prompt: string;
  answer: Rational;
  grading: Grading;
  generatedAt: number;
}

export const MINUS = '−'; // −
export const TIMES = '×'; // ×
export const DIVIDE = '÷'; // ÷
export const ARROW = '→'; // →

/**
 * Operand classes per op. `zeta` classes exist only inside Zetamac-parity
 * mode; fermi has no entry here because its tolerance grading must never leak
 * into exact-graded custom sprints — it lives in FERMI_BUCKETS and its own mode.
 */
export const OPERAND_CLASSES: Record<Exclude<Op, 'fermi'>, string[]> = {
  add: ['2d2d', '3d2d', '3d3d'],
  sub: ['2d2d', '3d2d', '3d3d'],
  mul: ['1x2', '2x2', '1x3'],
  div: ['1x2', '2x2', '1x3'],
  frac_add: ['small', 'any'],
  frac_mul: ['small', 'any'],
  dec_mul: ['clean', 'ugly'],
  pct_of: ['clean', 'ugly'],
  pct_change: ['clean', 'ugly'],
  recip: ['term', 'rep'],
};

export const ZETA_BUCKETS = ['add:zeta', 'sub:zeta', 'mul:zeta', 'div:zeta'] as const;
export const FERMI_BUCKETS = ['fermi:mul', 'fermi:div', 'fermi:pct'] as const;

/** Every custom-drill bucket, in UI order. */
export const ALL_BUCKETS: string[] = (Object.keys(OPERAND_CLASSES) as Exclude<Op, 'fermi'>[]).flatMap((op) =>
  OPERAND_CLASSES[op].map((c) => `${op}:${c}`),
);

/**
 * Canonical bucket universe for the URL codec bitmask. APPEND-ONLY and frozen:
 * challenge links index into this by position, so reordering or inserting
 * anywhere but the end silently breaks every link in the wild.
 */
export const CODEC_BUCKETS: string[] = [
  'add:2d2d', 'add:3d2d', 'add:3d3d',
  'sub:2d2d', 'sub:3d2d', 'sub:3d3d',
  'mul:1x2', 'mul:2x2', 'mul:1x3',
  'div:1x2', 'div:2x2', 'div:1x3',
  'frac_add:small', 'frac_add:any',
  'frac_mul:small', 'frac_mul:any',
  'dec_mul:clean', 'dec_mul:ugly',
  'pct_of:clean', 'pct_of:ugly',
  'pct_change:clean', 'pct_change:ugly',
  'recip:term',
  'add:zeta', 'sub:zeta', 'mul:zeta', 'div:zeta',
  // — v1 universe above this line; stretch buckets append below —
  'recip:rep',
  'fermi:mul', 'fermi:div', 'fermi:pct',
];

export function bucketOp(bucketId: string): Op {
  return bucketId.split(':')[0] as Op;
}

export function bucketClass(bucketId: string): string {
  return bucketId.split(':')[1] ?? '';
}

// ---------------------------------------------------------------------------
// Per-op generators
// ---------------------------------------------------------------------------

const ADD_RANGES: Record<string, [[number, number], [number, number]]> = {
  '2d2d': [[10, 99], [10, 99]],
  '3d2d': [[100, 999], [10, 99]],
  '3d3d': [[100, 999], [100, 999]],
  zeta: [[2, 100], [2, 100]], // Zetamac default addition range
};

const MUL_RANGES: Record<string, [[number, number], [number, number]]> = {
  '1x2': [[2, 9], [10, 99]],
  '2x2': [[10, 99], [10, 99]],
  '1x3': [[2, 9], [100, 999]],
  zeta: [[2, 12], [2, 100]], // Zetamac default multiplication range
};

/** One operand from this set keeps clean-decimal products friendly. */
const CLEAN_DECIMALS: ReadonlyArray<[string, Rational]> = [
  ['0.25', rat(1, 4)], ['0.5', rat(1, 2)], ['0.75', rat(3, 4)],
  ['1.25', rat(5, 4)], ['1.5', rat(3, 2)], ['2.5', rat(5, 2)],
  ['3.5', rat(7, 2)], ['7.5', rat(15, 2)], ['12.5', rat(25, 2)],
];

export const RECIP_SET = [2, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50] as const;
/** Repeating-decimal reciprocals — graded to 3 significant figures, not exactly. */
export const RECIP_REP_SET = [3, 6, 7, 9, 11, 12, 14, 15] as const;

/** Bases whose percent-changes terminate at ≤ 2 dp: 100/a has ≤ 2 dp. */
const PCT_CHANGE_UGLY_BASES = [4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 125, 200, 250, 400, 500] as const;

function genAddSub(op: 'add' | 'sub', cls: string, rng: Rng): { prompt: string; answer: Rational } {
  const ranges = ADD_RANGES[cls];
  if (!ranges) throw new Error(`unknown ${op} class ${cls}`);
  const a = randInt(rng, ranges[0][0], ranges[0][1]);
  const b = randInt(rng, ranges[1][0], ranges[1][1]);
  if (op === 'add') {
    // Randomise operand order so 3d2d isn't always big-first.
    const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
    return { prompt: `${x} + ${y}`, answer: rat(a + b) };
  }
  // sub is the inverse of add: present (a+b) − b, answer a — never negative.
  const [minus, answer] = rng() < 0.5 ? [b, a] : [a, b];
  return { prompt: `${a + b} ${MINUS} ${minus}`, answer: rat(answer) };
}

function genMulDiv(op: 'mul' | 'div', cls: string, rng: Rng): { prompt: string; answer: Rational } {
  const ranges = MUL_RANGES[cls];
  if (!ranges) throw new Error(`unknown ${op} class ${cls}`);
  const a = randInt(rng, ranges[0][0], ranges[0][1]);
  const b = randInt(rng, ranges[1][0], ranges[1][1]);
  if (op === 'mul') {
    const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
    return { prompt: `${x} ${TIMES} ${y}`, answer: rat(a * b) };
  }
  // div is the inverse of mul: divisor a, quotient b, present the product — integer answers.
  return { prompt: `${a * b} ${DIVIDE} ${a}`, answer: rat(b) };
}

function lcm(a: number, b: number): number {
  const g = ((x: number, y: number) => { while (y) [x, y] = [y, x % y]; return x; })(a, b);
  return (a / g) * b;
}

function genFracOperands(cls: string, rng: Rng): [Rational, Rational] {
  for (;;) {
    const d1 = randInt(rng, 2, 12);
    const d2 = randInt(rng, 2, 12);
    if (cls === 'small' && lcm(d1, d2) > 24) continue;
    const n1 = randInt(rng, 1, d1 - 1);
    const n2 = randInt(rng, 1, d2 - 1);
    return [rat(n1, d1), rat(n2, d2)];
  }
}

function fracPromptPart(r: Rational): string {
  return `${r.num}/${r.den}`;
}

function genFrac(op: 'frac_add' | 'frac_mul', cls: string, rng: Rng): { prompt: string; answer: Rational } {
  const [f1, f2] = genFracOperands(cls, rng);
  const sym = op === 'frac_add' ? '+' : TIMES;
  const answer = op === 'frac_add' ? ratAdd(f1, f2) : ratMul(f1, f2);
  return { prompt: `${fracPromptPart(f1)} ${sym} ${fracPromptPart(f2)}`, answer };
}

function genDecMul(cls: string, rng: Rng): { prompt: string; answer: Rational } {
  if (cls === 'clean') {
    const [text, value] = pick(rng, CLEAN_DECIMALS);
    const n = randInt(rng, 3, 39);
    const [x, y] = rng() < 0.5 ? [text, String(n)] : [String(n), text];
    return { prompt: `${x} ${TIMES} ${y}`, answer: ratMul(value, rat(n)) };
  }
  // ugly: two-digit × 1-dp (non-integer), e.g. 47 × 3.6 — answers ≤ 1 dp.
  const a = randInt(rng, 11, 99);
  let tenths = randInt(rng, 11, 99);
  if (tenths % 10 === 0) tenths += 1; // keep the 1-dp operand a genuine decimal
  const b = rat(tenths, 10);
  const [x, y] = rng() < 0.5 ? [String(a), ratToDecimalString(b)] : [ratToDecimalString(b), String(a)];
  return { prompt: `${x} ${TIMES} ${y}`, answer: ratMul(rat(a), b) };
}

function genPctOf(cls: string, rng: Rng): { prompt: string; answer: Rational } {
  if (cls === 'clean') {
    // multiples of 5% on multiples-of-20 bases → integer answers, always.
    const p = 5 * randInt(rng, 1, 19);
    const base = 20 * randInt(rng, 1, 25);
    return { prompt: `${p}% of ${base}`, answer: rat(p * base, 100) };
  }
  // ugly: any integer percent of any base — terminates at ≤ 2 dp by construction.
  const p = randInt(rng, 2, 99);
  const base = randInt(rng, 12, 499);
  return { prompt: `${p}% of ${base}`, answer: rat(p * base, 100) };
}

function genPctChange(cls: string, rng: Rng): { prompt: string; answer: Rational } {
  if (cls === 'clean') {
    // base multiple of 20, change a multiple of ±5% → both endpoints integers.
    const base = 20 * randInt(rng, 1, 25);
    const magnitude = 5 * randInt(rng, 1, 20); // 5..100
    const pct = rng() < 0.5 ? -Math.min(magnitude, 95) : magnitude; // decreases capped so b > 0
    const to = base + (base * pct) / 100;
    return { prompt: `${base} ${ARROW} ${to}, % change`, answer: rat(pct) };
  }
  // ugly: base from the terminating set, any endpoint in [0.3a, 2.2a] — ≤ 2 dp answers.
  const base = pick(rng, PCT_CHANGE_UGLY_BASES);
  for (;;) {
    const to = randInt(rng, Math.ceil(base * 0.3), Math.floor(base * 2.2));
    if (to === base) continue; // 0% change is degenerate
    return { prompt: `${base} ${ARROW} ${to}, % change`, answer: rat((to - base) * 100, base) };
  }
}

function genRecip(cls: string, rng: Rng): { prompt: string; answer: Rational } {
  const n = cls === 'rep' ? pick(rng, RECIP_REP_SET) : pick(rng, RECIP_SET);
  return { prompt: `1/${n}`, answer: rat(1, n) };
}

/** Thousands separators for readability; the answer grammar never accepts them. */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Fermi estimation: unwieldy numbers, graded at ±5% relative error. The only
 * op family exempt from the §3 representability invariant — its answers are
 * never typed exactly, so exact typeability is not required.
 */
function genFermi(cls: string, rng: Rng): { prompt: string; answer: Rational } {
  if (cls === 'mul') {
    const a = randInt(rng, 10_500, 98_999);
    const b = randInt(rng, 105, 989);
    return { prompt: `${group(a)} ${TIMES} ${group(b)}`, answer: rat(a * b) };
  }
  if (cls === 'div') {
    const x = randInt(rng, 100_000, 9_999_999);
    let y = randInt(rng, 103, 997);
    if (y % 100 === 0) y += 3; // keep the divisor unfriendly
    return { prompt: `${group(x)} ${DIVIDE} ${y}`, answer: rat(x, y) };
  }
  // pct: awkward percent of a 3-sig-fig base
  let p = randInt(rng, 2, 96);
  if (p % 5 === 0) p += 1;
  const base = randInt(rng, 101, 989) * Math.pow(10, randInt(rng, 2, 4));
  return { prompt: `${p}% of ${group(base)}`, answer: rat(p * base, 100) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function gradingFor(bucketId: string): Grading {
  if (bucketId.startsWith('fermi:')) return 'rel5';
  if (bucketId === 'recip:rep') return 'sig3';
  return 'exact';
}

function generateOnce(bucketId: string, rng: Rng, now: number): QuestionSpec {
  const op = bucketOp(bucketId);
  const cls = bucketClass(bucketId);
  let q: { prompt: string; answer: Rational };
  switch (op) {
    case 'add': case 'sub': q = genAddSub(op, cls, rng); break;
    case 'mul': case 'div': q = genMulDiv(op, cls, rng); break;
    case 'frac_add': case 'frac_mul': q = genFrac(op, cls, rng); break;
    case 'dec_mul': q = genDecMul(cls, rng); break;
    case 'pct_of': q = genPctOf(cls, rng); break;
    case 'pct_change': q = genPctChange(cls, rng); break;
    case 'recip': q = genRecip(cls, rng); break;
    case 'fermi': q = genFermi(cls, rng); break;
    default: throw new Error(`unknown op ${op satisfies never}`);
  }
  return { op, operandClass: cls, bucketId, prompt: q.prompt, answer: q.answer, grading: gradingFor(bucketId), generatedAt: now };
}

/**
 * Generate a question for a bucket, resampling to avoid any prompt in
 * `recentPrompts` (the session's ring buffer of the last 10). Retries are
 * bounded so a bucket smaller than the ring can't loop forever; 500 draws make
 * a collision astronomically unlikely even for recip's 11-member space
 * ((10/11)^500 ≈ 10⁻²¹) while costing nothing in the common case.
 */
export function generateQuestion(
  bucketId: string,
  rng: Rng,
  now: number,
  recentPrompts: readonly string[] = [],
): QuestionSpec {
  let q = generateOnce(bucketId, rng, now);
  for (let i = 0; i < 500 && recentPrompts.includes(q.prompt); i++) {
    q = generateOnce(bucketId, rng, now);
  }
  return q;
}
