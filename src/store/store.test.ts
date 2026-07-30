import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { freshStore, migrate, MAX_SESSIONS, type Store } from './schema';
import { loadStore, saveStore, exportJSON, importJSON, applySession, STORE_KEY, type StorageLike } from './persist';
import type { SessionSummary } from '../core/session';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'abc-1', startedAt: 1_753_000_000_000, mode: 'zetamac', benchmark: true, replay: false,
    score: 40, answered: 45, correct: 40, accuracy: 40 / 45, medianMs: 2100,
    durationSec: 120, focusLosses: 0, perBucket: { 'add:zeta': { n: 45, misses: 5 } },
    seedHex: '00c0ffee', ...over,
  };
}

describe('persistence', () => {
  it('save → load round-trips', () => {
    const storage = fakeStorage();
    const store = freshStore();
    store.pbs.zetamac = 42;
    saveStore(storage, store);
    expect(loadStore(storage)).toEqual(store);
  });

  it('a missing store yields a fresh store', () => {
    expect(loadStore(fakeStorage())).toEqual(freshStore());
  });

  it('fuzz: arbitrary corrupt payloads always yield a working store, never a crash', () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        const store = loadStore(fakeStorage({ [STORE_KEY]: junk }));
        expect(store.version).toBe(1);
        expect(Array.isArray(store.sessions)).toBe(true);
        expect(store.settings.enabledBuckets.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it('fuzz: structurally-mangled JSON stores salvage what they can', () => {
    const anyJson = fc.jsonValue({ maxDepth: 3 });
    fc.assert(
      fc.property(anyJson, (value) => {
        expect(() => migrate(value)).not.toThrow();
        expect(migrate(value).version).toBe(1);
      }),
      { numRuns: 300 },
    );
  });

  it('a bad field falls back to its default without discarding good fields', () => {
    const good = freshStore();
    good.pbs.optiver = 55;
    const mangled = { ...good, streak: 'not an object', sessions: [{ nonsense: true }, summary()] };
    const restored = migrate(mangled);
    expect(restored.pbs.optiver).toBe(55);
    expect(restored.streak).toEqual(freshStore().streak);
    expect(restored.sessions).toHaveLength(1); // the invalid row is dropped, the valid one kept
  });

  it('unknown versions (past or future) yield a fresh store', () => {
    expect(migrate({ ...freshStore(), version: 0 })).toEqual(freshStore());
    expect(migrate({ ...freshStore(), version: 99 })).toEqual(freshStore());
  });

  it('export → import round-trips; garbage import returns null instead of wiping', () => {
    const store = freshStore();
    store.pbs.zetamac = 61;
    expect(importJSON(exportJSON(store))).toEqual(store);
    expect(importJSON('not json {{{')).toBeNull();
    expect(importJSON('{"looksLike": "json but no version"}')).toBeNull();
  });
});

describe('applySession', () => {
  const day = '2026-07-30';

  it('appends the summary, replaces the log, merges bucket stats', () => {
    const buckets = { 'add:zeta': { attempts: 45, errRate: 0.1, meanMs: 2100, meanFirstKeyMs: 800 } };
    const { store } = applySession(freshStore(), summary(), [], buckets, day);
    expect(store.sessions).toHaveLength(1);
    expect(store.buckets['add:zeta']?.attempts).toBe(45);
  });

  it('benchmark zetamac sets a PB; custom and replay sessions never do', () => {
    let r = applySession(freshStore(), summary({ score: 40 }), [], {}, day);
    expect(r.newPB).toBe(true);
    expect(r.store.pbs.zetamac).toBe(40);
    r = applySession(r.store, summary({ score: 38 }), [], {}, day);
    expect(r.newPB).toBe(false);
    r = applySession(r.store, summary({ score: 99, benchmark: false }), [], {}, day);
    expect(r.store.pbs.zetamac).toBe(40); // custom ranges are a separate series, never the benchmark PB
    r = applySession(r.store, summary({ score: 99, replay: true }), [], {}, day);
    expect(r.store.pbs.zetamac).toBe(40); // shared-seed replays are excluded
    r = applySession(r.store, summary({ score: 12, mode: 'optiver', benchmark: false }), [], {}, day);
    expect(r.store.pbs.optiver).toBe(12);
  });

  it('streak: consecutive days increment, one session per day, gaps reset, focus and replays excluded', () => {
    let s = applySession(freshStore(), summary(), [], {}, '2026-07-28').store;
    expect(s.streak).toMatchObject({ current: 1, best: 1 });
    s = applySession(s, summary(), [], {}, '2026-07-28').store; // same day: no double-count
    expect(s.streak.current).toBe(1);
    s = applySession(s, summary(), [], {}, '2026-07-29').store;
    expect(s.streak).toMatchObject({ current: 2, best: 2 });
    s = applySession(s, summary({ mode: 'focus', benchmark: false }), [], {}, '2026-07-30').store;
    expect(s.streak.current).toBe(2); // focus drills are untimed — they don't extend streaks
    s = applySession(s, summary({ replay: true }), [], {}, '2026-07-30').store;
    expect(s.streak.current).toBe(2);
    s = applySession(s, summary(), [], {}, '2026-08-02').store; // gap
    expect(s.streak).toMatchObject({ current: 1, best: 2 });
  });

  it('nudges to export every 10th session', () => {
    let store: Store = freshStore();
    for (let i = 0; i < 9; i++) {
      const r = applySession(store, summary(), [], {}, day);
      expect(r.nudge).toBe(false);
      store = r.store;
    }
    const r = applySession(store, summary(), [], {}, day);
    expect(r.nudge).toBe(true);
    expect(r.store.sessionsSinceNudge).toBe(0);
  });

  it('caps stored sessions at the budget, evicting oldest first', () => {
    let store = freshStore();
    store.sessions = Array.from({ length: MAX_SESSIONS }, (_, i) => summary({ id: `s${i}` }));
    store = applySession(store, summary({ id: 'newest' }), [], {}, day).store;
    expect(store.sessions).toHaveLength(MAX_SESSIONS);
    expect(store.sessions[store.sessions.length - 1]?.id).toBe('newest');
    expect(store.sessions[0]?.id).toBe('s1');
  });
});
