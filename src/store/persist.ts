/**
 * Load/save/export/import against a Storage-like interface (injected so tests
 * run without a DOM). Also owns applySession — the one pure function that
 * folds a finished session into the store: bucket EWMAs, summaries, PBs,
 * streaks and the every-10th-session export nudge.
 */
import { migrate, freshStore, type Store, MAX_SESSIONS } from './schema';
import type { BucketStats } from '../core/buckets';
import type { QuestionRecord, SessionSummary } from '../core/session';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORE_KEY = 'mental-math-trainer';

export function loadStore(storage: StorageLike): Store {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORE_KEY);
  } catch {
    /* storage unavailable → fresh */
  }
  if (raw === null) return freshStore();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    console.warn('mental-math-trainer: corrupt store, starting fresh');
    return freshStore();
  }
}

export function saveStore(storage: StorageLike, store: Store): void {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    console.warn('mental-math-trainer: could not persist (quota or private mode)');
  }
}

/** The backup story and the README chart's data source. */
export function exportJSON(store: Store): string {
  return JSON.stringify(store, null, 2);
}

/** Strict import: unparseable input returns null so the UI can say so — it never silently wipes data. */
export function importJSON(text: string): Store | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if ((parsed as { version?: unknown }).version === undefined) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface ApplyResult {
  store: Store;
  newPB: boolean;
  /** True on every 10th completed session: show the "export your data" nudge. */
  nudge: boolean;
}

/**
 * Fold a completed session into the store. Pure — returns a new store.
 *  - Bucket EWMAs always update (replays included: the SRS unit is the type).
 *  - PBs: benchmark Zetamac and Optiver only. Custom-range scores aren't
 *    comparable across configs, and replays of shared seeds are excluded.
 *  - Streak: any completed timed session (zetamac or optiver), replays excluded.
 */
export function applySession(
  store: Store,
  summary: SessionSummary,
  log: QuestionRecord[],
  buckets: Record<string, BucketStats>,
  today: string, // 'YYYY-MM-DD' in the user's local time, passed in for testability
): ApplyResult {
  const next: Store = structuredClone(store);
  next.buckets = { ...next.buckets, ...buckets };
  next.sessions = [...next.sessions, summary].slice(-MAX_SESSIONS);
  next.lastSessionLog = log;

  let newPB = false;
  const pbEligible = !summary.replay && (summary.mode === 'optiver' || (summary.mode === 'zetamac' && summary.benchmark));
  if (pbEligible) {
    const prev = next.pbs[summary.mode];
    if (prev === undefined || summary.score > prev) {
      next.pbs[summary.mode] = summary.score;
      newPB = true;
    }
  }

  if (!summary.replay && summary.mode !== 'focus') {
    const s = next.streak;
    if (s.lastActiveDay !== today) {
      next.streak = {
        current: s.lastActiveDay === previousDay(today) ? s.current + 1 : 1,
        best: 0,
        lastActiveDay: today,
      };
      next.streak.best = Math.max(s.best, next.streak.current);
    }
  }

  next.sessionsSinceNudge = store.sessionsSinceNudge + 1;
  const nudge = next.sessionsSinceNudge >= 10;
  if (nudge) next.sessionsSinceNudge = 0;

  return { store: next, newPB, nudge };
}
