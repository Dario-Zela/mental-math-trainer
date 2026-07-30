import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  rat, ratAdd, ratMul, ratSub, ratDiv, ratEq,
  isTerminating, decimalPlaces, ratToDecimalString, ratToString,
} from './rational';

const smallRat = fc
  .record({ num: fc.integer({ min: -999, max: 999 }), den: fc.integer({ min: 1, max: 144 }) })
  .map(({ num, den }) => rat(num, den));

describe('rational', () => {
  it('canonicalises: den > 0, reduced, zero is 0/1', () => {
    expect(rat(6, 16)).toEqual({ num: 3, den: 8 });
    expect(rat(3, -8)).toEqual({ num: -3, den: 8 });
    expect(rat(0, 7)).toEqual({ num: 0, den: 1 });
    expect(rat(-10, -4)).toEqual({ num: 5, den: 2 });
  });

  it('arithmetic is exact', () => {
    expect(ratAdd(rat(3, 8), rat(1, 6))).toEqual(rat(13, 24));
    expect(ratSub(rat(1, 2), rat(1, 3))).toEqual(rat(1, 6));
    expect(ratMul(rat(3, 8), rat(4, 9))).toEqual(rat(1, 6));
    expect(ratDiv(rat(1, 2), rat(3, 4))).toEqual(rat(2, 3));
  });

  it('add/mul are commutative and associative (property)', () => {
    fc.assert(fc.property(smallRat, smallRat, (a, b) => {
      expect(ratEq(ratAdd(a, b), ratAdd(b, a))).toBe(true);
      expect(ratEq(ratMul(a, b), ratMul(b, a))).toBe(true);
    }));
  });

  it('terminating detection and decimal places', () => {
    expect(isTerminating(rat(3, 8))).toBe(true);
    expect(isTerminating(rat(1, 3))).toBe(false);
    expect(decimalPlaces(rat(3, 8))).toBe(3);
    expect(decimalPlaces(rat(1, 32))).toBe(5);
    expect(decimalPlaces(rat(7, 1))).toBe(0);
  });

  it('decimal strings are exact', () => {
    expect(ratToDecimalString(rat(3, 8))).toBe('0.375');
    expect(ratToDecimalString(rat(1, 32))).toBe('0.03125');
    expect(ratToDecimalString(rat(-169, 10))).toBe('-16.9');
    expect(ratToDecimalString(rat(42))).toBe('42');
  });

  it('display picks integer | terminating decimal | fraction', () => {
    expect(ratToString(rat(42))).toBe('42');
    expect(ratToString(rat(3, 8))).toBe('0.375');
    expect(ratToString(rat(13, 24))).toBe('13/24');
  });
});
