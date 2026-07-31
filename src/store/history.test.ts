import { describe, expect, it } from 'vitest';
import { allTimeTotals, historyRows, lastNSessions, reviewsCSV, weeklyTrend, weekStartUTC, type HistoryRow } from './history';
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

  it('lastNSessions groups by session, orders by start time, takes the tail', () => {
    const rows = [
      row({ sessionId: 'b', ts: 200, prompt: 'b1' }),
      row({ sessionId: 'a', ts: 100, prompt: 'a1' }),
      row({ sessionId: 'a', ts: 100, prompt: 'a2' }),
      row({ sessionId: 'c', ts: 300, prompt: 'c1' }),
    ];
    const last2 = lastNSessions(rows, 2);
    expect(last2.map((s) => s.map((r) => r.prompt))).toEqual([['b1'], ['c1']]);
    // question order within a session is preserved
    expect(lastNSessions(rows, 3)[0]?.map((r) => r.prompt)).toEqual(['a1', 'a2']);
    expect(lastNSessions(rows, 99)).toHaveLength(3); // n larger than history: everything
  });

  it('reviewsCSV: one line per question, rounds numbered oldest-first, commas escaped', () => {
    const rows = [
      row({ sessionId: 's1', ts: Date.parse('2026-07-30T10:00:00Z'), prompt: '7 × 8', given: '56', answer: '56', ms: 1500, firstKeyMs: 900 }),
      row({
        sessionId: 's2', ts: Date.parse('2026-07-31T10:00:00Z'), mode: 'fermi',
        prompt: '48,213 × 677', given: null, verdict: 'skip', ms: null, firstKeyMs: null, answer: '32640201',
      }),
    ];
    const csv = reviewsCSV(rows, 5);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('round,started,mode,question,bucket,prompt,given,answer,verdict,ms,first_key_ms');
    expect(lines[1]).toBe('1,2026-07-30T10:00:00.000Z,zetamac,1,mul:2x2,7 × 8,56,56,correct,1500,900');
    // the fermi prompt's thousands-comma is quoted, nulls become empty fields
    expect(lines[2]).toBe('2,2026-07-31T10:00:00.000Z,fermi,1,mul:2x2,"48,213 × 677",,32640201,skip,,');
    // legacy rows without the answer field export an empty column, not "undefined"
    const legacy = reviewsCSV([row({ answer: undefined })], 1);
    expect(legacy).not.toContain('undefined');
  });

  it('reviewsCSV with n=1 exports exactly the latest round', () => {
    const rows = [
      row({ sessionId: 'old', ts: 100, prompt: 'old q' }),
      row({ sessionId: 'new', ts: 200, prompt: 'new q' }),
    ];
    const csv = reviewsCSV(rows, 1);
    expect(csv).toContain('new q');
    expect(csv).not.toContain('old q');
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
      answer: '408', // canonical answer travels with the row for review exports
    }]);
  });
});
