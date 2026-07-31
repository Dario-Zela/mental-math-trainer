/**
 * Full per-question history in IndexedDB — the long-horizon companion to the
 * localStorage store (which keeps only summaries plus the last session's log).
 * Everything here is best-effort: IDB being unavailable (private mode, old
 * browsers) degrades to "history unavailable", never an error. Appends are
 * fire-and-forget from the drill; reads happen only on the stats screen.
 *
 * The aggregation functions are pure and unit-tested; only open/append/load
 * touch IndexedDB (covered by the Playwright run, which has the real thing).
 */
import type { Mode } from '../core/scoring';
import type { QuestionRecord, SessionSummary } from '../core/session';
import { answerDisplay } from '../core/tricks';

export interface HistoryRow {
  sessionId: string;
  ts: number; // question timestamp (session start epoch ms — per-question resolution isn't needed)
  mode: Mode;
  bucketId: string;
  prompt: string;
  given: string | null;
  verdict: string;
  ms: number | null;
  firstKeyMs: number | null;
  /** Canonical answer display — absent on rows written before this field existed. */
  answer?: string;
}

const DB_NAME = 'mmt-history';
const STORE = 'questions';

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { autoIncrement: true });
          store.createIndex('ts', 'ts');
          store.createIndex('bucketId', 'bucketId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function historyRows(summary: SessionSummary, log: QuestionRecord[]): HistoryRow[] {
  return log.map((r) => ({
    sessionId: summary.id,
    ts: summary.startedAt,
    mode: summary.mode,
    bucketId: r.spec.bucketId,
    prompt: r.spec.prompt,
    given: r.given,
    verdict: r.verdict,
    ms: r.ms,
    firstKeyMs: r.firstKeyMs,
    answer: answerDisplay(r.spec),
  }));
}

/** Fire-and-forget append; resolves false when history is unavailable. */
export async function appendHistory(rows: HistoryRow[]): Promise<boolean> {
  const db = await openDB();
  if (!db || rows.length === 0) return db !== null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const row of rows) store.add(row);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    } catch {
      resolve(false);
    }
  });
}

/** Everything, oldest first. Null when IDB is unavailable (≠ empty history). */
export async function loadHistory(): Promise<HistoryRow[] | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => { db.close(); resolve((req.result as HistoryRow[]).sort((a, b) => a.ts - b.ts)); };
      req.onerror = () => { db.close(); resolve(null); };
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// pure aggregations
// ---------------------------------------------------------------------------

/** Monday of the UTC week containing ts, as YYYY-MM-DD (UTC keeps tests TZ-stable). */
export function weekStartUTC(ts: number): string {
  const d = new Date(ts);
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return shifted.toISOString().slice(0, 10);
}

export interface WeekPoint {
  weekStart: string;
  n: number;
  meanMs: number | null; // null when no timed answers landed that week
  missRate: number;
}

/** Weekly mean-time and miss-rate trend for one bucket, oldest week first. */
export function weeklyTrend(rows: HistoryRow[], bucketId: string): WeekPoint[] {
  const weeks = new Map<string, { n: number; misses: number; msSum: number; msN: number }>();
  for (const r of rows) {
    if (r.bucketId !== bucketId) continue;
    const key = weekStartUTC(r.ts);
    const w = weeks.get(key) ?? { n: 0, misses: 0, msSum: 0, msN: 0 };
    w.n += 1;
    if (r.verdict !== 'correct') w.misses += 1;
    if (r.ms !== null) { w.msSum += r.ms; w.msN += 1; }
    weeks.set(key, w);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, w]) => ({
      weekStart,
      n: w.n,
      meanMs: w.msN === 0 ? null : w.msSum / w.msN,
      missRate: w.misses / w.n,
    }));
}

export interface AllTimeTotals {
  questions: number;
  correct: number;
  accuracy: number;
  /** Answered time only (skips carry no clock) — honest "time in the drill". */
  hours: number;
}

export function allTimeTotals(rows: HistoryRow[]): AllTimeTotals {
  let correct = 0;
  let msSum = 0;
  for (const r of rows) {
    if (r.verdict === 'correct') correct += 1;
    if (r.ms !== null) msSum += r.ms;
  }
  return {
    questions: rows.length,
    correct,
    accuracy: rows.length === 0 ? 0 : correct / rows.length,
    hours: msSum / 3_600_000,
  };
}

export function exportHistoryJSON(rows: HistoryRow[]): string {
  return JSON.stringify({ format: 'mmt-history-v1', rows }, null, 2);
}

/**
 * The last n sessions' rows, grouped per session, oldest exported round first.
 * Within a session, rows keep question order (loadHistory's sort is stable
 * over the insertion-ordered getAll).
 */
export function lastNSessions(rows: HistoryRow[], n: number): HistoryRow[][] {
  const bySession = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const group = bySession.get(r.sessionId);
    if (group) group.push(r);
    else bySession.set(r.sessionId, [r]);
  }
  return [...bySession.values()]
    .sort((a, b) => (a[0] as HistoryRow).ts - (b[0] as HistoryRow).ts)
    .slice(-Math.max(1, n));
}

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // fermi prompts contain commas ("48,213 × 677") — quote anything unsafe
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Full reviews of the past n rounds as CSV — one row per question, built for
 * side-by-side comparison: sort by `prompt` in any spreadsheet and the same
 * fact's times across rounds line up.
 */
export function reviewsCSV(rows: HistoryRow[], n: number): string {
  const header = 'round,started,mode,question,bucket,prompt,given,answer,verdict,ms,first_key_ms';
  const lines = [header];
  lastNSessions(rows, n).forEach((session, i) => {
    session.forEach((r, q) => {
      lines.push([
        i + 1,
        new Date(r.ts).toISOString(),
        r.mode,
        q + 1,
        r.bucketId,
        csvField(r.prompt),
        csvField(r.given),
        csvField(r.answer),
        r.verdict,
        r.ms === null ? '' : Math.round(r.ms),
        r.firstKeyMs === null ? '' : Math.round(r.firstKeyMs),
      ].join(','));
    });
  });
  return lines.join('\n') + '\n';
}
