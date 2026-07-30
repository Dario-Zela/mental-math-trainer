import { describe, expect, it } from 'vitest';
import { allTimeTotals, historyRows, weeklyTrend, weekStartUTC, type HistoryRow } from './history';
import type { SessionSummary } from '../core/session';
import { rat } from '../core/rational';

function row(over: Partial<HistoryRow>): HistoryRow {
  return {
    sessionId: 's1', ts: Date.parse('2026-07-20T10:00:00Z'), mode: 'zetamac',
    bucketId: 'mul:2x2', prompt: '47 × 83', given: '3901', verdict: 'correct',
    ms: 4000, firstKeyMs: 2000, ...over,
  };
}

describe('history aggregations (pure)', () => {
  it('weekStartUTC pins any timestamp to its UTC Monday', () => {
    expect(weekStartUTC(Date.parse('2026-07-20T10:00:00Z'))).toBe('2026-07-20'); // a Monday
    expect(weekStartUTC(Date.parse('2026-07-26T23:59:59Z'))).toBe('2026-07-20'); // Sunday, same week
    expect(weekStartUTC(Date.parse('2026-07-27T00:00:00Z'))).toBe('2026-07-27'); // next Monday
  });

  it('weeklyTrend groups one bucket by week: mean ms, miss rate, counts', () => {
    const w1 = Date.parse('2026-07-13T09:00:00Z');
    const w2 = Date.parse('2026-07-21T09:00:00Z');
    const rows = [
      row({ ts: w1, ms: 6000 }),
      row({ ts: w1, ms: 8000, verdict: 'wrong' }),
      row({ ts: w1, ms: null, verdict: 'skip' }), // skips count for missRate, never for meanMs
      row({ ts: w2, ms: 4000 }),
      row({ ts: w2, bucketId: 'add:2d2d', ms: 900 }), // other bucket: excluded
    ];
    expect(weeklyTrend(rows, 'mul:2x2')).toEqual([
      { weekStart: '2026-07-13', n: 3, meanMs: 7000, missRate: 2 / 3 },
      { weekStart: '2026-07-20', n: 1, meanMs: 4000, missRate: 0 },
    ]);
  });

  it('a week of only-voided timings yields meanMs null, not zero', () => {
    const trend = weeklyTrend([row({ ms: null })], 'mul:2x2');
    expect(trend[0]?.meanMs).toBeNull();
  });

  it('allTimeTotals: counts, accuracy, answered-time hours', () => {
    const rows = [
      row({ ms: 1_800_000 }), // clamping is the EWMA's concern, not history's
      row({ ms: 1_800_000, verdict: 'wrong' }),
      row({ ms: null, verdict: 'skip' }),
    ];
    const t = allTimeTotals(rows);
    expect(t.questions).toBe(3);
    expect(t.correct).toBe(1);
    expect(t.accuracy).toBeCloseTo(1 / 3);
    expect(t.hours).toBeCloseTo(1);
  });

  it('historyRows flattens a session log against its summary', () => {
    const summary = {
      id: 'sess-9', startedAt: 123, mode: 'optiver',
    } as SessionSummary;
    const rows = historyRows(summary, [
      {
        spec: {
          op: 'mul', operandClass: '2x2', bucketId: 'mul:2x2', prompt: '12 × 34',
          answer: rat(408), grading: 'exact', generatedAt: 0,
        },
        given: null, verdict: 'skip', delta: 0, ms: null, firstKeyMs: null,
      },
    ]);
    expect(rows).toEqual([{
      sessionId: 'sess-9', ts: 123, mode: 'optiver', bucketId: 'mul:2x2',
      prompt: '12 × 34', given: null, verdict: 'skip', ms: null, firstKeyMs: null,
    }]);
  });
});
