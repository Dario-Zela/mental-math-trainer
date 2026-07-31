/**
 * Versioned localStorage schema. Migrations run at load via an explicit
 * migrate(vN) → vN+1 chain; a corrupt or unparseable store yields a fresh
 * store plus a console warning — never a crash.
 *
 * Storage budget: summaries only (full per-question detail kept for the last
 * session alone, to power the review pass). Sessions are additionally capped
 * at 1000 with oldest-first eviction, keeping the footprint bounded forever.
 */
import type { BucketStats } from '../core/buckets';
import type { Mode } from '../core/scoring';
import type { QuestionRecord, SessionSummary } from '../core/session';
import { ALL_BUCKETS } from '../core/questions';
import { DEFAULT_PROFILE } from '../core/presets';

export const CURRENT_VERSION = 2;
export const MAX_SESSIONS = 1000;

export interface ModeConfig {
  mode: Mode;
  durationSec: number; // zetamac-style sessions; optiver/focus ignore it
}

export interface StoreV2 {
  version: 2;
  settings: {
    enabledBuckets: string[];
    mode: ModeConfig;
    /** User-set target line on the stats chart (e.g. your Optiver goal score). */
    targetScore: number | null;
    /** Audio feedback (WebAudio tick/buzz; a neutral click in sim mode). */
    sound: boolean;
    /** Coach mode in focus drills: worked solutions on misses, 'h' to reveal. Additive field, defaults off. */
    coach: boolean;
    /** Which blitz the home row launches. Additive field, defaults to times tables. */
    blitzType: 'mul' | 'add' | 'sub' | 'chain';
    /**
     * Memorise mode (focus drills): if recall hasn't produced a keystroke
     * within the shot-clock window, the answer auto-reveals and scores as a
     * skip — fail-fast retrieval practice, never derivation. Additive fields.
     */
    memorise: boolean;
    memoriseMs: number;
  };
  buckets: Record<string, BucketStats>;
  sessions: SessionSummary[];
  /** Full per-question detail, last session only — powers the review pass. */
  lastSessionLog: QuestionRecord[];
  pbs: Partial<Record<Mode, number>>;
  streak: { current: number; best: number; lastActiveDay: string };
  /** Export-your-data nudge counter (Safari can evict localStorage). */
  sessionsSinceNudge: number;
}

export type Store = StoreV2;

export function freshStore(): StoreV2 {
  return {
    version: 2,
    settings: {
      // Starter profile, not everything: a fresh install's first custom sprint
      // should feel winnable. The full ladder is one profile click away.
      enabledBuckets: [...DEFAULT_PROFILE.buckets],
      mode: { mode: 'zetamac', durationSec: 120 },
      targetScore: null,
      sound: true,
      coach: false,
      blitzType: 'mul',
      memorise: false,
      memoriseMs: 1500,
    },
    buckets: {},
    sessions: [],
    lastSessionLog: [],
    pbs: {},
    streak: { current: 0, best: 0, lastActiveDay: '' },
    sessionsSinceNudge: 0,
  };
}

// --- shape guards (hand-rolled: the store is small and zod would be the
// --- project's largest dependency) ------------------------------------------

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function validBucketStats(x: unknown): x is Omit<BucketStats, 'difficulty'> {
  return isObj(x) && isNum(x.attempts) && isNum(x.errRate) && isNum(x.meanMs) && isNum(x.meanFirstKeyMs);
}

function normaliseBucket(x: Omit<BucketStats, 'difficulty'> & { difficulty?: unknown }): BucketStats {
  const d = isNum(x.difficulty) ? Math.min(1, Math.max(0, x.difficulty)) : 0.5;
  return { attempts: x.attempts, errRate: x.errRate, meanMs: x.meanMs, meanFirstKeyMs: x.meanFirstKeyMs, difficulty: d };
}

function validSummary(x: unknown): x is SessionSummary {
  return (
    isObj(x) && isStr(x.id) && isNum(x.startedAt) && isStr(x.mode) &&
    typeof x.benchmark === 'boolean' && typeof x.replay === 'boolean' &&
    isNum(x.score) && isNum(x.answered) && isNum(x.correct) && isNum(x.accuracy) &&
    isObj(x.perBucket)
  );
}

const MODES: Mode[] = ['zetamac', 'optiver', 'focus', 'fermi'];

/**
 * Sanitise an untrusted parsed value into a valid store. Field-by-field: a
 * single bad field falls back to its default without discarding the rest.
 */
function sanitise(raw: Record<string, unknown>): StoreV2 {
  const fresh = freshStore();
  const out = fresh;

  const settings = isObj(raw.settings) ? raw.settings : {};
  if (Array.isArray(settings.enabledBuckets)) {
    const valid = settings.enabledBuckets.filter((b): b is string => isStr(b) && ALL_BUCKETS.includes(b));
    if (valid.length > 0) out.settings.enabledBuckets = valid;
  }
  const mode = isObj(settings.mode) ? settings.mode : {};
  if (isStr(mode.mode) && (MODES as string[]).includes(mode.mode)) out.settings.mode.mode = mode.mode as Mode;
  if (isNum(mode.durationSec) && mode.durationSec >= 10 && mode.durationSec <= 3600) {
    out.settings.mode.durationSec = mode.durationSec;
  }
  if (isNum(settings.targetScore) || settings.targetScore === null) {
    out.settings.targetScore = settings.targetScore as number | null;
  }
  if (typeof settings.sound === 'boolean') out.settings.sound = settings.sound;
  if (typeof settings.coach === 'boolean') out.settings.coach = settings.coach;
  if (isStr(settings.blitzType) && ['mul', 'add', 'sub', 'chain'].includes(settings.blitzType)) {
    out.settings.blitzType = settings.blitzType as 'mul' | 'add' | 'sub' | 'chain';
  }
  if (typeof settings.memorise === 'boolean') out.settings.memorise = settings.memorise;
  if (isNum(settings.memoriseMs) && settings.memoriseMs >= 300 && settings.memoriseMs <= 10_000) {
    out.settings.memoriseMs = settings.memoriseMs;
  }

  if (isObj(raw.buckets)) {
    for (const [k, v] of Object.entries(raw.buckets)) {
      if (validBucketStats(v)) out.buckets[k] = normaliseBucket(v);
    }
  }

  if (Array.isArray(raw.sessions)) {
    out.sessions = raw.sessions.filter(validSummary).slice(-MAX_SESSIONS);
  }

  if (Array.isArray(raw.lastSessionLog)) {
    out.lastSessionLog = raw.lastSessionLog.filter(
      (r): r is QuestionRecord => isObj(r) && isObj(r.spec) && isStr(r.verdict),
    );
  }

  if (isObj(raw.pbs)) {
    for (const m of MODES) {
      if (isNum(raw.pbs[m])) out.pbs[m] = raw.pbs[m] as number;
    }
  }

  if (isObj(raw.streak) && isNum(raw.streak.current) && isNum(raw.streak.best) && isStr(raw.streak.lastActiveDay)) {
    out.streak = { current: raw.streak.current, best: raw.streak.best, lastActiveDay: raw.streak.lastActiveDay };
  }

  if (isNum(raw.sessionsSinceNudge) && raw.sessionsSinceNudge >= 0) {
    out.sessionsSinceNudge = raw.sessionsSinceNudge;
  }

  return out;
}

/**
 * The migration chain: MIGRATIONS[n] upgrades version n → n+1. Schema version
 * bumps are explicit and land here.
 */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: per-bucket adaptive difficulty + the sound setting. Defaults are
  // filled by sanitise (difficulty 0.5, sound on); the bump just marks intent.
  1: (s) => s,
};

/** Untrusted parsed JSON → valid current-version store. Never throws. */
export function migrate(raw: unknown): StoreV2 {
  if (!isObj(raw) || !isNum(raw.version) || raw.version < 1 || raw.version > CURRENT_VERSION) {
    return freshStore();
  }
  let s = raw;
  for (let v = raw.version as number; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return freshStore();
    s = { ...step(s), version: v + 1 };
  }
  return sanitise(s);
}
