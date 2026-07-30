/**
 * Exact rational arithmetic. Answers are rationals so equivalence checking is
 * exact equality (0.375 === 3/8 === 6/16) — no float comparison, no tolerance
 * grading anywhere in v1.
 *
 * All values in play are tiny (operands ≤ 999, denominators ≤ 12), so plain
 * number arithmetic is exact; no bigint needed.
 */
export interface Rational {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Canonical form: den > 0, gcd(num, den) === 1, and 0 is always 0/1. */
export function rat(num: number, den = 1): Rational {
  if (den === 0) throw new Error('zero denominator');
  if (!Number.isInteger(num) || !Number.isInteger(den)) throw new Error('non-integer rational parts');
  if (num === 0) return { num: 0, den: 1 };
  const sign = den < 0 ? -1 : 1;
  const g = gcd(num, den);
  return { num: (sign * num) / g, den: (sign * den) / g };
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function ratSub(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function ratMul(a: Rational, b: Rational): Rational {
  return rat(a.num * b.num, a.den * b.den);
}

export function ratDiv(a: Rational, b: Rational): Rational {
  if (b.num === 0) throw new Error('divide by zero');
  return rat(a.num * b.den, a.den * b.num);
}

/** Exact equality on canonical forms. Inputs must come from rat()/parse — they always do. */
export function ratEq(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

export function isInteger(a: Rational): boolean {
  return a.den === 1;
}

/** den of the canonical form is 2^a·5^b ⇔ the decimal expansion terminates. */
export function isTerminating(a: Rational): boolean {
  let d = a.den;
  while (d % 2 === 0) d /= 2;
  while (d % 5 === 0) d /= 5;
  return d === 1;
}

/** Decimal places of a terminating rational (0 for integers). */
export function decimalPlaces(a: Rational): number {
  if (!isTerminating(a)) throw new Error('non-terminating rational');
  let d = a.den;
  let twos = 0;
  let fives = 0;
  while (d % 2 === 0) { d /= 2; twos++; }
  while (d % 5 === 0) { d /= 5; fives++; }
  return Math.max(twos, fives);
}

/** Canonical display: integer, terminating decimal, or lowest-terms fraction. */
export function ratToString(a: Rational): string {
  if (a.den === 1) return String(a.num);
  if (isTerminating(a)) return ratToDecimalString(a);
  return `${a.num}/${a.den}`;
}

/** Exact decimal string of a terminating rational, e.g. 3/8 → "0.375". */
export function ratToDecimalString(a: Rational): string {
  const dp = decimalPlaces(a);
  const scaled = a.num * Math.pow(10, dp) / a.den; // exact: den divides 10^dp
  const sign = scaled < 0 ? '-' : '';
  const digits = String(Math.abs(scaled)).padStart(dp + 1, '0');
  const intPart = digits.slice(0, digits.length - dp);
  const fracPart = digits.slice(digits.length - dp);
  return dp === 0 ? sign + intPart : `${sign}${intPart}.${fracPart}`;
}

/** Lowest-terms fraction display, e.g. 23/24 — used on review screens for frac buckets. */
export function ratToFractionString(a: Rational): string {
  return a.den === 1 ? String(a.num) : `${a.num}/${a.den}`;
}
