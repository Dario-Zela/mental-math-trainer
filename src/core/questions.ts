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
  | 'dec_mul' | 'dec_add' | 'dec_div'
  | 'pct_of' | 'pct_change' | 'recip'
  | 'missing'
  | 'chain'
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
export const OPERAND_CLASSES: Record<Exclude<Op, 'fermi' | 'chain'>, string[]> = {
  add: ['1d1d', '2d2d', '3d2d', '3d3d'],
  sub: ['1d1d', '2d2d', '3d2d', '3d3d'],
  mul: ['1x1', '1x2', '2x2', '1x3'],
  div: ['1x2', '2x2', '1x3'],
  frac_add: ['small', 'any'],
  frac_mul: ['small', 'any'],
  dec_mul: ['clean', 'ugly'],
  dec_add: ['2dp'],
  dec_div: ['1dp'],
  pct_of: ['clean', 'ugly'],
  pct_change: ['clean', 'ugly'],
  recip: ['term', 'rep'],
  missing: ['mul'],
};

export const ZETA_BUCKETS = ['add:zeta', 'sub:zeta', 'mul:zeta', 'div:zeta'] as const;
export const FERMI_BUCKETS = ['fermi:mul', 'fermi:div', 'fermi:pct'] as const;

export const CHAIN_BUCKET = 'chain:mix';

/** The blitz round's selectable buckets: bare 1-digit recall plus the chain. */
export const BLITZ_BUCKETS: Record<string, string> = {
  mul: 'mul:1x1',
  add: 'add:1d1d',
  sub: 'sub:1d1d',
  chain: CHAIN_BUCKET,
};

/**
 * The Optiver sim's locked question mix — matched to what candidate accounts
 * and prep guides report the real 80-in-8 actually asks (examples: 47+38,
 * 156+279, 23×17, 78×26, 168÷12, 455÷35, 12.75+8.46, 4.5×7.2, 84.6÷3.5,
 * 3/4+5/8, 2/3×9/4, and 66 × ? = 138.6). Notably ABSENT from every account:
 * percentages and standalone reciprocals — so they're absent here too.
 * Locked for the same reason Zetamac parity locks ranges: a sim whose content
 * tracked the user's settings would produce scores comparable to nothing.
 */
export const OPTIVER_BUCKETS = [
  'add:2d2d', 'add:3d3d', 'sub:2d2d',
  'mul:1x2', 'mul:2x2',
  'div:1x2', 'div:2x2',
  'frac_add:small', 'frac_mul:small',
  'dec_mul:clean', 'dec_mul:ugly',
  'dec_add:2dp', 'dec_div:1dp',
  'missing:mul',
] as const;

/** Every custom-drill bucket, in UI order. */
export const ALL_BUCKETS: string[] = (Object.keys(OPERAND_CLASSES) as Exclude<Op, 'fermi' | 'chain'>[]).flatMap((op) =>
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
  'missing:mul', 'dec_add:2dp', 'dec_div:1dp',
  'mul:1x1',
  'add:1d1d', 'sub:1d1d', 'chain:mix',
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
  '1d1d': [[2, 9], [2, 9]], // bare 1-digit recall — the substrate under every carry and borrow
  '2d2d': [[10, 99], [10, 99]],
  '3d2d': [[100, 999], [10, 99]],
  '3d3d': [[100, 999], [100, 999]],
  zeta: [[2, 100], [2, 100]], // Zetamac default addition range
};

const MUL_RANGES: Record<string, [[number, number], [number, number]]> = {
  '1x1': [[2, 9], [2, 9]], // bare times tables — the blitz round's bucket
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

/**
 * Difficulty anneal: shrink an operand range's ceiling toward its floor.
 * d=1 is the full class range (also the exact pre-anneal behaviour, which is
 * what URLs without a difficulty param decode to); d=0 keeps the bottom 40%.
 * Never applied to zeta (parity) or fermi (its classes ARE the difficulty).
 */
function annealHi(lo: number, hi: number, d: number): number {
  return lo + Math.round((hi - lo) * (0.4 + 0.6 * d));
}

function genAddSub(op: 'add' | 'sub', cls: string, rng: Rng, d: number): { prompt: string; answer: Rational } {
  const ranges = ADD_RANGES[cls];
  if (!ranges) throw new Error(`unknown ${op} class ${cls}`);
  const anneal = cls === 'zeta' ? 1 : d;
  const a = randInt(rng, ranges[0][0], annealHi(ranges[0][0], ranges[0][1], anneal));
  const b = randInt(rng, ranges[1][0], annealHi(ranges[1][0], ranges[1][1], anneal));
  if (op === 'add') {
    // Randomise operand order so 3d2d isn't always big-first.
    const [x, y] = rng() < 0.5 ? [a, b] : [b, a];
    return { prompt: `${x} + ${y}`, answer: rat(a + b) };
  }
  // sub is the inverse of add: present (a+b) − b, answer a — never negative.
  const [minus, answer] = rng() < 0.5 ? [b, a] : [a, b];
  return { prompt: `${a + b} ${MINUS} ${minus}`, answer: rat(answer) };
}

function genMulDiv(op: 'mul' | 'div', cls: string, rng: Rng, d: number): { prompt: string; answer: Rational } {
  const ranges = MUL_RANGES[cls];
  if (!ranges) throw new Error(`unknown ${op} class ${cls}`);
  const anneal = cls === 'zeta' ? 1 : d;
  const a = randInt(rng, ranges[0][0], annealHi(ranges[0][0], ranges[0][1], anneal));
  const b = randInt(rng, ranges[1][0], annealHi(ranges[1][0], ranges[1][1], anneal));
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

function genFracOperands(cls: string, rng: Rng, d: number): [Rational, Rational] {
  const denHi = annealHi(2, 12, d);
  for (;;) {
    const d1 = randInt(rng, 2, denHi);
    const d2 = randInt(rng, 2, denHi);
    if (cls === 'small' && lcm(d1, d2) > 24) continue;
    const n1 = randInt(rng, 1, d1 - 1);
    const n2 = randInt(rng, 1, d2 - 1);
    return [rat(n1, d1), rat(n2, d2)];
  }
}

function fracPromptPart(r: Rational): string {
  return `${r.num}/${r.den}`;
}

function genFrac(op: 'frac_add' | 'frac_mul', cls: string, rng: Rng, d: number): { prompt: string; answer: Rational } {
  const [f1, f2] = genFracOperands(cls, rng, d);
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

/** A genuinely-decimal 2dp value in [1.01, 99.99] (never a whole number). */
function twoDp(rng: Rng): Rational {
  let x = randInt(rng, 101, 9999);
  if (x % 100 === 0) x += 7;
  return rat(x, 100);
}

/** Decimal ± with 2dp operands (the 12.75 + 8.46 shape); sub as the inverse of add. */
function genDecAdd(rng: Rng): { prompt: string; answer: Rational } {
  const a = twoDp(rng);
  const b = twoDp(rng);
  const sum = ratAdd(a, b);
  if (rng() < 0.5) {
    return { prompt: `${ratToDecimalString(a)} + ${ratToDecimalString(b)}`, answer: sum };
  }
  return { prompt: `${ratToDecimalString(sum)} ${MINUS} ${ratToDecimalString(a)}`, answer: b };
}

/** Decimal division (the 84.6 ÷ 3.5 shape): 1dp divisor, integer quotient — generated inverse. */
function genDecDiv(rng: Rng): { prompt: string; answer: Rational } {
  let tenths = randInt(rng, 11, 99);
  if (tenths % 10 === 0) tenths += 1;
  const d = rat(tenths, 10);
  const q = randInt(rng, 3, 29);
  return { prompt: `${ratToDecimalString(ratMul(d, rat(q)))} ${DIVIDE} ${ratToDecimalString(d)}`, answer: rat(q) };
}

/**
 * Missing-operand questions (the 66 × ? = 138.6 shape) — a division in
 * disguise, reportedly the format that trips people up in the real 80-in-8.
 * Known factor from the times-tables range; the hidden factor is an integer
 * or a 1dp decimal.
 */
function genMissing(rng: Rng): { prompt: string; answer: Rational } {
  const a = randInt(rng, 2, 19);
  let q: Rational;
  if (rng() < 0.5) {
    q = rat(randInt(rng, 12, 99));
  } else {
    let tenths = randInt(rng, 11, 99);
    if (tenths % 10 === 0) tenths += 1;
    q = rat(tenths, 10);
  }
  const b = ratMul(rat(a), q);
  return { prompt: `${a} ${TIMES} ? = ${ratToDecimalString(b)}`, answer: q };
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

/**
 * One chain cycle: five questions where each wraps the previous expression in
 * parentheses and applies one more operation to the answer you just gave —
 * 7 × 8 → (7 × 8) − 3 → ((7 × 8) − 3) ÷ 2 → … The nesting is strictly
 * left-associative, so standard precedence reads each prompt correctly.
 * Every intermediate is a small positive integer by construction: the
 * subtrahend and divisor are chosen together so the division is always exact
 * with quotient ≥ 2, and the final × is capped to keep the answer ≤ ~300.
 */
export interface ChainCycle {
  prompts: string[];
  answers: number[];
}

export const CHAIN_LENGTH = 5;

export function generateChain(rng: Rng): ChainCycle {
  let a = randInt(rng, 2, 9);
  let b = randInt(rng, 2, 9);
  while (a * b < 12) { // headroom for the − and ÷ steps
    a = randInt(rng, 2, 9);
    b = randInt(rng, 2, 9);
  }
  const v1 = a * b;
  // pick (divisor, subtrahend) together: (v1 − k) divisible by d, quotient ≥ 2
  const options: Array<[number, number]> = [];
  for (let d = 2; d <= 8; d++) {
    for (let k = 2; k <= 9; k++) {
      if ((v1 - k) % d === 0 && (v1 - k) / d >= 2) options.push([d, k]);
    }
  }
  const [d, k] = options[Math.floor(rng() * options.length)] as [number, number];
  const v2 = v1 - k;
  const v3 = v2 / d;
  const e = randInt(rng, 2, 9);
  const v4 = v3 + e;
  const f = randInt(rng, 2, Math.max(2, Math.min(9, Math.floor(300 / v4))));
  const v5 = v4 * f;

  const p1 = `${a} ${TIMES} ${b}`;
  const p2 = `(${p1}) ${MINUS} ${k}`;
  const p3 = `(${p2}) ${DIVIDE} ${d}`;
  const p4 = `(${p3}) + ${e}`;
  const p5 = `(${p4}) ${TIMES} ${f}`;
  return { prompts: [p1, p2, p3, p4, p5], answers: [v1, v2, v3, v4, v5] };
}

/** Build the QuestionSpec for one step of a chain cycle. */
export function chainSpec(cycle: ChainCycle, idx: number, now: number): QuestionSpec {
  return {
    op: 'chain',
    operandClass: 'mix',
    bucketId: CHAIN_BUCKET,
    prompt: cycle.prompts[idx] as string,
    answer: rat(cycle.answers[idx] as number),
    grading: 'exact',
    generatedAt: now,
  };
}

export function gradingFor(bucketId: string): Grading {
  if (bucketId.startsWith('fermi:')) return 'rel5';
  if (bucketId === 'recip:rep') return 'sig3';
  return 'exact';
}

function generateOnce(bucketId: string, rng: Rng, now: number, difficulty: number): QuestionSpec {
  const op = bucketOp(bucketId);
  const cls = bucketClass(bucketId);
  let q: { prompt: string; answer: Rational };
  switch (op) {
    case 'add': case 'sub': q = genAddSub(op, cls, rng, difficulty); break;
    case 'mul': case 'div': q = genMulDiv(op, cls, rng, difficulty); break;
    case 'frac_add': case 'frac_mul': q = genFrac(op, cls, rng, difficulty); break;
    case 'dec_mul': q = genDecMul(cls, rng); break;
    case 'dec_add': q = genDecAdd(rng); break;
    case 'dec_div': q = genDecDiv(rng); break;
    case 'pct_of': q = genPctOf(cls, rng); break;
    case 'pct_change': q = genPctChange(cls, rng); break;
    case 'recip': q = genRecip(cls, rng); break;
    case 'missing': q = genMissing(rng); break;
    case 'chain': {
      const cycle = generateChain(rng);
      return chainSpec(cycle, 2, now); // a 3-op prefix reads best standalone
    }
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
  difficulty = 1,
): QuestionSpec {
  let q = generateOnce(bucketId, rng, now, difficulty);
  for (let i = 0; i < 500 && recentPrompts.includes(q.prompt); i++) {
    q = generateOnce(bucketId, rng, now, difficulty);
  }
  return q;
}
