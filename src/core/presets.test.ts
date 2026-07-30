import { describe, expect, it } from 'vitest';
import { PROFILES, DEFAULT_PROFILE, activeProfile } from './presets';
import { ALL_BUCKETS } from './questions';

describe('bucket profiles', () => {
  it('every profile references only real custom-drill buckets', () => {
    for (const p of PROFILES) {
      expect(p.buckets.length).toBeGreaterThan(0);
      for (const b of p.buckets) expect(ALL_BUCKETS).toContain(b);
      expect(new Set(p.buckets).size).toBe(p.buckets.length);
    }
  });

  it('profile ids are unique and the default is the gentle starter', () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
    expect(DEFAULT_PROFILE.id).toBe('starter');
    // the starter deliberately avoids every hard-end class
    for (const b of DEFAULT_PROFILE.buckets) {
      expect(b).not.toMatch(/:(2x2|1x3|3d3d|ugly|any|rep)$/);
    }
  });

  it('activeProfile matches by set equality and returns null for custom picks', () => {
    for (const p of PROFILES) {
      expect(activeProfile([...p.buckets].reverse())?.id).toBe(p.id); // order-insensitive
    }
    expect(activeProfile(['add:2d2d'])).toBeNull();
    expect(activeProfile([...DEFAULT_PROFILE.buckets, 'mul:2x2'])).toBeNull();
  });
});
