/**
 * Answer input grammar — frozen (§3 of the design doc):
 *   -?digits | -?digits.digits (leading '.' allowed) | digits/digits
 * No mixed numbers, no '%', no thousands separators, no negative fractions.
 * Comparison is exact rational equality; unsimplified fractions are accepted.
 */
import { type Rational, rat, ratEq, ratSub } from './rational';
import type { Grading, QuestionSpec } from './questions';

const INT_RE = /^-?\d+$/;
const DEC_RE = /^-?\d*\.\d+$/;
const FRAC_RE = /^\d+\/\d+$/;

/** Prefixes of the grammar — what the keystroke filter allows to exist in the input. */
const PREFIX_RE = /^(-?(\.\d*|\d+(\.\d*)?)?|\d+\/\d*)$/;

/** Parse a complete answer string; null if it isn't a full match of the grammar. */
export function parseAnswer(text: string): Rational | null {
  if (INT_RE.test(text)) return rat(parseInt(text, 10));
  if (DEC_RE.test(text)) {
    const neg = text.startsWith('-');
    const body = neg ? text.slice(1) : text;
    const [intPart, fracPart] = body.split('.') as [string, string];
    const scale = Math.pow(10, fracPart.length);
    const num = (intPart === '' ? 0 : parseInt(intPart, 10)) * scale + parseInt(fracPart, 10);
    return rat(neg ? -num : num, scale);
  }
  if (FRAC_RE.test(text)) {
    const [n, d] = text.split('/') as [string, string];
    const den = parseInt(d, 10);
    if (den === 0) return null;
    return rat(parseInt(n, 10), den);
  }
  return null;
}

/** Would `text` still be a valid prefix of some grammar production? */
export function isValidPrefix(text: string, spec?: QuestionSpec): boolean {
  if (!PREFIX_RE.test(text)) return false;
  // Reciprocal drills ask for the decimal form; typing the prompt back ("1/32")
  // would trivially match under rational equality, so '/' is rejected for them.
  if (spec?.op === 'recip' && text.includes('/')) return false;
  return true;
}

/**
 * Apply one keystroke to the current input text. Returns the new text, or null
 * if the key is rejected (filtering happens at keystroke level, not on submit).
 */
export function applyKey(text: string, key: string, spec?: QuestionSpec): string | null {
  if (key === 'Backspace') return text.length > 0 ? text.slice(0, -1) : null;
  if (!/^[0-9./-]$/.test(key)) return null;
  const next = text + key;
  return isValidPrefix(next, spec) ? next : null;
}

/** |a| ≤ 10^exp, exactly, using integer cross-multiplication (exp may be negative). */
function absLeqPow10(a: Rational, exp: number): boolean {
  // |a.num| / a.den ≤ 10^exp  ⇔  |a.num| · 10^(−exp) ≤ a.den   (for exp ≤ 0)
  //                            ⇔  |a.num| ≤ a.den · 10^exp      (for exp > 0)
  return exp <= 0
    ? Math.abs(a.num) * Math.pow(10, -exp) <= a.den
    : Math.abs(a.num) <= a.den * Math.pow(10, exp);
}

/**
 * Grade a parsed answer. 'exact' is rational equality (the v1 default). The
 * two tolerance modes serve stretch buckets whose answers aren't exactly
 * typeable:
 *  - 'sig3': within one unit in the 3rd significant figure — accepts both the
 *    rounded and the truncated 3-s.f. form (1/7 takes 0.143 and 0.142);
 *  - 'rel5': within ±5% relative error (Fermi estimation).
 * Both computed in integer arithmetic — no float comparison even here.
 */
export function answersMatch(given: Rational, answer: Rational, grading: Grading = 'exact'): boolean {
  if (ratEq(given, answer)) return true;
  if (grading === 'exact') return false;
  if (grading === 'sig3') {
    const magnitude = Math.floor(Math.log10(Math.abs(answer.num) / answer.den));
    return absLeqPow10(ratSub(given, answer), magnitude - 2);
  }
  // rel5: 20·|given − answer| ≤ |answer|
  const diff = ratSub(given, answer);
  return 20 * Math.abs(diff.num) * answer.den <= Math.abs(answer.num) * diff.den;
}

/** Grade raw input text: parse under the frozen grammar, then compare. */
export function matches(text: string, answer: Rational, grading: Grading = 'exact'): boolean {
  const parsed = parseAnswer(text);
  return parsed !== null && answersMatch(parsed, answer, grading);
}
