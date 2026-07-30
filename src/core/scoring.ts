/**
 * Scoring modes. One interface: onAnswer(spec, given, ms) → {verdict, delta},
 * plus isDone(state). The rules block is what the UI reads to decide behaviour
 * (auto-advance, hidden running score, pre-roll…), so mode differences live
 * here in the core, not scattered through components.
 */
import { type Rational, ratEq } from './rational';
import type { QuestionSpec } from './questions';

export type Mode = 'zetamac' | 'optiver' | 'focus';
export type Verdict = 'correct' | 'wrong' | 'skip';

export interface ModeRules {
  mode: Mode;
  durationMs: number | null;  // null = untimed
  questionCap: number | null;
  /** Advance the instant the typed value equals the answer (Zetamac's quirk, kept deliberately). */
  autoAdvance: boolean;
  /** Enter with a non-matching value records a wrong answer (Optiver −1). Zetamac parity: Enter does nothing. */
  allowWrongSubmit: boolean;
  /** Enter on empty input skips (scores 0, counts as a miss for the weakness model). */
  allowSkip: boolean;
  showFeedback: boolean;      // per-question ✓/✗
  showRunningScore: boolean;  // sim mode hides it until the end, matching test conditions
  preRoll: boolean;           // 3-2-1 countdown before the clock starts
}

export interface ScoreState {
  elapsedMs: number;
  answered: number;
}

export interface Scorer {
  rules: ModeRules;
  onAnswer(spec: QuestionSpec, given: Rational | null, ms: number | null): { verdict: Verdict; delta: number };
  isDone(state: ScoreState): boolean;
}

export const ZETAMAC_DEFAULT_SEC = 120;
export const OPTIVER_SEC = 480;
export const OPTIVER_CAP = 80;

export function makeScorer(mode: Mode, durationSec?: number | null): Scorer {
  switch (mode) {
    case 'zetamac': {
      const rules: ModeRules = {
        mode, durationMs: (durationSec ?? ZETAMAC_DEFAULT_SEC) * 1000, questionCap: null,
        autoAdvance: true, allowWrongSubmit: false, allowSkip: false,
        showFeedback: true, showRunningScore: true, preRoll: false,
      };
      return {
        rules,
        onAnswer(spec, given) {
          // Auto-advance means the only submissions are correct ones; anything
          // else would be a UI bug, so grade defensively anyway.
          const correct = given !== null && ratEq(given, spec.answer);
          return { verdict: correct ? 'correct' : 'wrong', delta: correct ? 1 : 0 };
        },
        isDone: (s) => s.elapsedMs >= (rules.durationMs as number),
      };
    }
    case 'optiver': {
      const rules: ModeRules = {
        mode, durationMs: OPTIVER_SEC * 1000, questionCap: OPTIVER_CAP,
        autoAdvance: false, allowWrongSubmit: true, allowSkip: true,
        showFeedback: false, showRunningScore: false, preRoll: true,
      };
      return {
        rules,
        onAnswer(spec, given) {
          if (given === null) return { verdict: 'skip', delta: 0 };
          const correct = ratEq(given, spec.answer);
          return { verdict: correct ? 'correct' : 'wrong', delta: correct ? 1 : -1 };
        },
        isDone: (s) => s.elapsedMs >= (rules.durationMs as number) || s.answered >= OPTIVER_CAP,
      };
    }
    case 'focus': {
      const rules: ModeRules = {
        mode, durationMs: null, questionCap: null,
        autoAdvance: false, allowWrongSubmit: true, allowSkip: true,
        showFeedback: true, showRunningScore: true, preRoll: false,
      };
      return {
        rules,
        onAnswer(spec, given) {
          if (given === null) return { verdict: 'skip', delta: 0 };
          const correct = ratEq(given, spec.answer);
          return { verdict: correct ? 'correct' : 'wrong', delta: correct ? 1 : 0 };
        },
        isDone: () => false, // untimed — the user ends it
      };
    }
  }
}
