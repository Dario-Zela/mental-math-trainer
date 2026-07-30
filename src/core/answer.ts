/**
 * Answer input grammar — frozen (§3 of the design doc):
 *   -?digits | -?digits.digits (leading '.' allowed) | digits/digits
 * No mixed numbers, no '%', no thousands separators, no negative fractions.
 * Comparison is exact rational equality; unsimplified fractions are accepted.
 */
import { type Rational, rat, ratEq } from './rational';
import type { QuestionSpec } from './questions';

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

/** Exact-equality grading. */
export function matches(text: string, answer: Rational): boolean {
  const parsed = parseAnswer(text);
  return parsed !== null && ratEq(parsed, answer);
}
