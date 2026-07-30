import { describe, expect, it } from 'vitest';
import { parseAnswer, matches, applyKey, isValidPrefix } from './answer';
import { rat } from './rational';
import { generateQuestion } from './questions';
import { mulberry32 } from './rng';

/**
 * The equivalence grammar, pinned down in data, not prose (§3). Each row:
 * [answer, input, accepted?]. The grammar is FROZEN — if a new row seems
 * needed, that's a design change, not a bug fix.
 */
const TABLE: Array<[ReturnType<typeof rat>, string, boolean]> = [
  // 3/8: all equivalent forms accepted, near-misses rejected
  [rat(3, 8), '0.375', true],
  [rat(3, 8), '.375', true],
  [rat(3, 8), '3/8', true],
  [rat(3, 8), '6/16', true],   // unsimplified fractions accepted — the skill is arithmetic, not simplification
  [rat(3, 8), '0.3750', true], // trailing zeros don't change the value
  [rat(3, 8), '0.38', false],  // no tolerance grading anywhere in v1
  [rat(3, 8), '0.37', false],
  // integers, signs, leading zeros
  [rat(96), '96', true],
  [rat(96), '096', true],
  [rat(96), '96.0', true],
  [rat(-15), '-15', true],
  [rat(-15), '15', false],     // pct_change requires the sign for decreases
  [rat(15), '-15', false],
  // decimals
  [rat(1, 2), '.5', true],
  [rat(1, 2), '0.5', true],
  [rat(1, 2), '2/4', true],
  [rat(-33, 10), '-3.3', true],
  [rat(-33, 10), '-3.30', true],
  // grammar rejections (parse fails entirely)
  [rat(3, 8), '3 / 8', false],
  [rat(3, 8), '', false],
  [rat(1, 2), '1/2/3', false],
  [rat(150), '1,50', false],   // no thousands separators
  [rat(15), '15%', false],     // percentage answers are bare numbers
  [rat(-3, 4), '-3/4', false], // no negative fractions in the grammar
];

describe('answer equivalence', () => {
  it.each(TABLE)('%o given %s → %s', (answer, input, accepted) => {
    expect(matches(input, answer)).toBe(accepted);
  });

  it('rejects malformed strings at parse', () => {
    for (const bad of ['', '-', '.', '-.', '1.', '1/', '/2', '1.2.3', '--4', '5/0', 'abc', '1e3']) {
      expect(parseAnswer(bad)).toBeNull();
    }
  });

  it('auto-advance prefix quirk: the answer fires as soon as the typed value matches', () => {
    // Answer 12, intending to type 123: after '1','2' the value already equals
    // 12 and fires. Kept deliberately — it's what the Zetamac benchmark does.
    expect(matches('1', rat(12))).toBe(false);
    expect(matches('12', rat(12))).toBe(true);
  });
});

describe('tolerance grading (stretch buckets only)', () => {
  it('sig3: correct to 3 significant figures, rounded or truncated', () => {
    const third = rat(1, 3);   // 0.333333…
    expect(matches('0.333', third, 'sig3')).toBe(true);
    expect(matches('.3333', third, 'sig3')).toBe(true);
    expect(matches('0.334', third, 'sig3')).toBe(true);  // one unit in the 3rd s.f.
    expect(matches('0.33', third, 'sig3')).toBe(false);  // only 2 s.f. of precision
    expect(matches('0.3', third, 'sig3')).toBe(false);
    expect(matches('0.335', third, 'sig3')).toBe(false);
    expect(matches('1/3', third, 'sig3')).toBe(true);    // exact always passes

    const seventh = rat(1, 7); // 0.142857…
    expect(matches('0.143', seventh, 'sig3')).toBe(true);  // rounded
    expect(matches('0.142', seventh, 'sig3')).toBe(true);  // truncated
    expect(matches('0.1429', seventh, 'sig3')).toBe(true);
    expect(matches('0.14', seventh, 'sig3')).toBe(false);
    expect(matches('0.144', seventh, 'sig3')).toBe(false);
  });

  it('rel5: within ±5 percent relative error', () => {
    const answer = rat(48_213 * 677); // 32,640,201
    expect(matches('32640201', answer, 'rel5')).toBe(true);
    expect(matches('32000000', answer, 'rel5')).toBe(true);
    expect(matches('31100000', answer, 'rel5')).toBe(true);  // −4.7%
    expect(matches('34200000', answer, 'rel5')).toBe(true);  // +4.8%
    expect(matches('30000000', answer, 'rel5')).toBe(false); // −8.1%
    expect(matches('36000000', answer, 'rel5')).toBe(false);
    expect(matches('3260000', answer, 'rel5')).toBe(false);  // off by 10×
    // non-integer true values (fermi division) accept decimals
    expect(matches('19519', rat(8_412_347, 431), 'rel5')).toBe(true);
    expect(matches('19519.4', rat(8_412_347, 431), 'rel5')).toBe(true);
    expect(matches('18000', rat(8_412_347, 431), 'rel5')).toBe(false);
  });

  it('exact grading is unaffected: near-misses still reject', () => {
    expect(matches('0.333', rat(1, 3))).toBe(false);
    expect(matches('32000000', rat(32_640_201))).toBe(false);
  });
});

describe('keystroke filter', () => {
  it('builds valid prefixes and rejects everything else', () => {
    expect(applyKey('', '-')).toBe('-');
    expect(applyKey('-', '.')).toBe('-.');
    expect(applyKey('-.', '5')).toBe('-.5');
    expect(applyKey('3', '/')).toBe('3/');
    expect(applyKey('3/', '8')).toBe('3/8');
    expect(applyKey('', '/')).toBeNull();     // fraction needs a numerator first
    expect(applyKey('-', '/')).toBeNull();    // no negative fractions
    expect(applyKey('-3', '/')).toBeNull();
    expect(applyKey('1.2', '.')).toBeNull();  // one decimal point
    expect(applyKey('3/8', '/')).toBeNull();  // one slash
    expect(applyKey('3/8', '.')).toBeNull();  // no decimals inside fractions
    expect(applyKey('12', '-')).toBeNull();   // sign only leads
    expect(applyKey('', 'a')).toBeNull();
    expect(applyKey('', 'Enter')).toBeNull();
  });

  it('Backspace edits, and is rejected on empty input', () => {
    expect(applyKey('3/8', 'Backspace')).toBe('3/');
    expect(applyKey('', 'Backspace')).toBeNull();
  });

  it('rejects the slash entirely for reciprocal questions', () => {
    const recip = generateQuestion('recip:term', mulberry32(1), 0);
    expect(applyKey('1', '/', recip)).toBeNull();
    expect(isValidPrefix('1/2', recip)).toBe(false);
    const mul = generateQuestion('frac_add:small', mulberry32(1), 0);
    expect(applyKey('1', '/', mul)).toBe('1/');
  });
});
