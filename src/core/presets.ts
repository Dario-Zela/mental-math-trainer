/**
 * Named bucket profiles — one click instead of two dozen checkboxes. Data
 * only, so the core stays framework-free and a test can pin every id to the
 * real bucket universe.
 */
import { ALL_BUCKETS } from './questions';

export interface Profile {
  id: string;
  name: string;
  hint: string;
  buckets: string[];
}

export const PROFILES: Profile[] = [
  {
    id: 'starter',
    name: 'Starter',
    hint: 'the gentle end of every family — the default for a fresh install',
    buckets: ['add:2d2d', 'sub:2d2d', 'mul:1x1', 'mul:1x2', 'div:1x2', 'dec_mul:clean', 'pct_of:clean', 'recip:term'],
  },
  {
    id: 'core-four',
    name: 'Core four',
    hint: 'add / sub / mul / div across the whole difficulty ladder',
    buckets: [
      'add:2d2d', 'add:3d2d', 'add:3d3d',
      'sub:2d2d', 'sub:3d2d', 'sub:3d3d',
      'mul:1x1', 'mul:1x2', 'mul:2x2', 'mul:1x3',
      'div:1x2', 'div:2x2', 'div:1x3',
    ],
  },
  {
    id: 'fractions-decimals',
    name: 'Fractions & decimals',
    hint: 'everything with a denominator or a decimal point',
    buckets: [
      'frac_add:small', 'frac_add:any', 'frac_mul:small', 'frac_mul:any',
      'dec_mul:clean', 'dec_mul:ugly', 'dec_add:2dp', 'dec_div:1dp',
      'recip:term', 'recip:rep',
    ],
  },
  {
    id: 'optiver-mix',
    name: '80-in-8 mix',
    hint: "the sim's exact question mix, for practising with feedback on",
    buckets: [
      'add:2d2d', 'add:3d3d', 'sub:2d2d', 'mul:1x2', 'mul:2x2', 'div:1x2', 'div:2x2',
      'frac_add:small', 'frac_mul:small', 'dec_mul:clean', 'dec_mul:ugly',
      'dec_add:2dp', 'dec_div:1dp', 'missing:mul',
    ],
  },
  {
    id: 'percentages',
    name: 'Percentages',
    hint: 'percent-of and percent-change, clean and ugly',
    buckets: ['pct_of:clean', 'pct_of:ugly', 'pct_change:clean', 'pct_change:ugly'],
  },
  {
    id: 'interview-mix',
    name: 'Interview mix',
    hint: 'the hard end of every family — what the assessments actually ask',
    buckets: [
      'mul:2x2', 'mul:1x3', 'div:2x2', 'div:1x3',
      'frac_add:any', 'frac_mul:any', 'dec_mul:ugly',
      'pct_of:ugly', 'pct_change:ugly', 'recip:rep',
    ],
  },
  {
    id: 'everything',
    name: 'Everything',
    hint: 'all question types at once',
    buckets: [...ALL_BUCKETS],
  },
];

export const DEFAULT_PROFILE = PROFILES[0] as Profile; // starter

/** The profile exactly matching an enabled set (order-insensitive), else null. */
export function activeProfile(enabled: readonly string[]): Profile | null {
  const set = new Set(enabled);
  return (
    PROFILES.find((p) => p.buckets.length === set.size && p.buckets.every((b) => set.has(b))) ?? null
  );
}
