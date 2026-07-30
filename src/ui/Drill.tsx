import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './storeContext';
import { bucketLabel, fmtClock, fmtMs, todayLocal } from './labels';
import { Session, makeConfig, type QuestionRecord, type SessionConfig, type SessionSummary } from '../core/session';
import { applyKey, matches, parseAnswer } from '../core/answer';
import { applySession } from '../store/persist';
import { sounds } from './audio';
import { encodeSession } from '../core/encode';
import { randomSeed } from '../core/rng';
import { ratToFractionString, ratToString } from '../core/rational';
import { targetMs } from '../core/buckets';
import type { QuestionSpec } from '../core/questions';
import type { Verdict } from '../core/scoring';

interface DrillProps {
  config: SessionConfig;
  onExit(): void;
  onRestart(config: SessionConfig): void;
}

type Phase = 'preroll' | 'running' | 'done';

interface Applied {
  summary: SessionSummary;
  log: QuestionRecord[];
  newPB: boolean;
  nudge: boolean;
  pbBefore: number | undefined;
}

export function Drill({ config, onExit, onRestart }: DrillProps) {
  const { store, update } = useStore();
  const [session] = useState(() => new Session(config, store.buckets));
  const rules = session.scorer.rules;

  const [phase, setPhase] = useState<Phase>(rules.preRoll ? 'preroll' : 'running');
  const [preCount, setPreCount] = useState(3);
  const [question, setQuestion] = useState<QuestionSpec | null>(null);
  const [input, setInput] = useState('');
  const [remainingMs, setRemainingMs] = useState(rules.durationMs ?? 0);
  const [lastVerdict, setLastVerdict] = useState<{ verdict: Verdict; ms: number } | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  const startWallRef = useRef(0);       // performance.now() at clock start
  const startEpochRef = useRef(0);      // Date.now() at clock start
  const t0Ref = useRef<number | null>(null);       // prompt paint time
  const firstKeyRef = useRef<number | null>(null); // event.timeStamp of first accepted key
  const voidedRef = useRef(false);      // focus loss voided this question's timing (untimed only)
  const maxHandlerRef = useRef(0);      // hot-handler budget, measured (README micro-perf story)
  const startedRef = useRef(false);

  const advance = useCallback(() => {
    const q = session.next(Date.now());
    firstKeyRef.current = null;
    voidedRef.current = false;
    t0Ref.current = null;
    setInput('');
    setQuestion(q);
  }, [session]);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startWallRef.current = performance.now();
    startEpochRef.current = Date.now();
    setPhase('running');
    advance();
  }, [advance]);

  // The clock starts at prompt PAINT: capture performance.now() in a rAF after
  // the question commits — render time is excluded from the user's number.
  useEffect(() => {
    if (question === null) return;
    const raf = requestAnimationFrame(() => {
      t0Ref.current = performance.now();
    });
    return () => cancelAnimationFrame(raf);
  }, [question]);

  // 3-2-1 pre-roll (sim mode)
  useEffect(() => {
    if (phase !== 'preroll') return;
    const iv = setInterval(() => {
      setPreCount((c) => {
        if (c <= 1) {
          clearInterval(iv);
          start();
          return 0;
        }
        return c - 1;
      });
    }, 800);
    return () => clearInterval(iv);
  }, [phase, start]);

  useEffect(() => {
    if (!rules.preRoll) start();
  }, [rules.preRoll, start]);

  const finish = useCallback(() => {
    session.discardCurrent();
    if (session.log.length === 0) {
      onExit();
      return;
    }
    const summary = session.summary(startEpochRef.current);
    const pbBefore = store.pbs[summary.mode];
    // applySession is pure; compute once against the current store and commit.
    const r = applySession(store, summary, session.log, session.bucketStats(), todayLocal());
    update(() => r.store);
    setApplied({ summary, log: session.log, pbBefore, newPB: r.newPB, nudge: r.nudge });
    setPhase('done');
  }, [session, store, update, onExit]);

  // countdown: derived from performance.now() deltas on a 100ms tick — no
  // accumulated setInterval drift over an 8-minute run
  useEffect(() => {
    if (phase !== 'running' || rules.durationMs === null) return;
    const iv = setInterval(() => {
      const left = (rules.durationMs as number) - (performance.now() - startWallRef.current);
      setRemainingMs(left);
      if (left <= 0) finish();
    }, 100);
    return () => clearInterval(iv);
  }, [phase, rules.durationMs, finish]);

  // focus losses: recorded always; untimed questions get their timing voided
  useEffect(() => {
    if (phase !== 'running') return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        session.focusLosses += 1;
        if (rules.durationMs === null) voidedRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, session, rules.durationMs]);

  const submit = useCallback(
    (text: string | null, ts: number) => {
      if (!session.current) return;
      const t0 = t0Ref.current ?? startWallRef.current;
      const rawMs = Math.max(0, ts - t0);
      const voided = voidedRef.current;
      const ms = voided ? null : rawMs;
      const firstKeyMs = voided || firstKeyRef.current === null ? null : Math.max(0, firstKeyRef.current - t0);
      const { verdict } = session.answer(text, ms, firstKeyMs);
      if (store.settings.sound) {
        // sim mode gives no per-question feedback, so its sound is verdict-blind
        if (!rules.showFeedback) sounds.click();
        else if (verdict === 'correct') sounds.tick();
        else sounds.buzz();
      }
      setLastVerdict({ verdict, ms: rawMs });
      const elapsed = performance.now() - startWallRef.current;
      if (session.isDone(elapsed)) finish();
      else advance();
    },
    [session, advance, finish, store.settings.sound, rules.showFeedback],
  );

  const abort = useCallback(() => {
    // Sim rule: Esc aborts with confirm and DISCARDS the session — no pause.
    if (window.confirm('Abort this session? It will be discarded.')) onExit();
  }, [onExit]);

  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      performance.mark('mmt-key-start');
      handleKey(e);
      performance.mark('mmt-key-end');
      const m = performance.measure('mmt-key', 'mmt-key-start', 'mmt-key-end');
      if (m.duration > maxHandlerRef.current) maxHandlerRef.current = m.duration;
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || question === null) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (rules.durationMs === null) finish(); // focus drill: Esc ends & saves
        else abort();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (rules.autoAdvance) return; // Zetamac parity: Enter does nothing
        if (input === '') {
          if (rules.allowSkip) submit(null, e.timeStamp);
        } else if (parseAnswer(input) !== null && rules.allowWrongSubmit) {
          submit(input, e.timeStamp);
        }
        return;
      }
      const next = applyKey(input, e.key, question);
      if (next === null) {
        if (e.key === 'Backspace' || e.key === '/') e.preventDefault();
        return;
      }
      e.preventDefault();
      if (firstKeyRef.current === null && e.key !== 'Backspace') firstKeyRef.current = e.timeStamp;
      setInput(next);
      // auto-advance: parse after every keystroke, fire the instant it matches.
      // Inherits Zetamac's prefix quirk (12 fires while typing 123) — deliberate.
      if (rules.autoAdvance && matches(next, question.answer, question.grading)) submit(next, e.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, input, question, rules, submit, abort, finish]);

  if (phase === 'done' && applied) {
    return (
      <ResultsOrReview
        config={config}
        applied={applied}
        maxHandlerMs={maxHandlerRef.current}
        onExit={onExit}
        onAgain={() => {
          const next = makeConfig(
            config.mode, config.buckets,
            // fresh snapshot from the just-updated stats
            session.bucketStats(),
            randomSeed(Math.random()),
            config.durationSec,
          );
          onRestart(next);
        }}
      />
    );
  }

  const timedFrac = rules.durationMs === null ? 0 : Math.max(0, remainingMs / rules.durationMs);

  return (
    <div className="drill">
      <div className="drill-status">
        {rules.showRunningScore ? (
          <div className="cell">
            <span className="micro">Score</span>
            <span className="num">{session.score}</span>
          </div>
        ) : (
          <div className="cell">
            <span className="micro">Question</span>
            <span className="num">{session.log.length + 1}/{session.scorer.rules.questionCap ?? '∞'}</span>
          </div>
        )}
        <div className="cell" style={{ textAlign: 'right' }}>
          <span className="micro">{rules.durationMs === null ? 'Last' : 'Time'}</span>
          <span className="num">
            {rules.durationMs === null ? fmtMs(lastVerdict?.ms ?? null) : fmtClock(remainingMs)}
          </span>
        </div>
      </div>
      {rules.durationMs !== null && (
        <div className="timebar" aria-hidden="true">
          <div className={`fill${timedFrac < 0.15 ? ' low' : ''}`} style={{ width: `${timedFrac * 100}%` }} />
        </div>
      )}

      <div className="drill-stage">
        {phase === 'preroll' ? (
          <>
            <div className="preroll num" aria-live="assertive">{preCount}</div>
            <p className="preroll-note">80 questions · 8 minutes · +1 right, −1 wrong · no feedback until the end</p>
          </>
        ) : (
          <>
            <div className="prompt" aria-label={`Question: ${question?.prompt ?? ''}`}>
              {question?.prompt}
              {question?.op === 'recip' && (
                <span className="hint">{question.grading === 'sig3' ? 'to 3 s.f.' : 'as a decimal'}</span>
              )}
              {question?.grading === 'rel5' && <span className="hint">within 5%</span>}
            </div>
            <div className="entry" aria-label="Your answer">
              {input}
              <span className="caret" aria-hidden="true" />
            </div>
            <div className="verdict-line" aria-hidden={!rules.showFeedback || rules.autoAdvance}>
              {rules.showFeedback && !rules.autoAdvance && lastVerdict && (
                lastVerdict.verdict === 'correct'
                  ? <span className="ok">✓ correct · {fmtMs(lastVerdict.ms)}</span>
                  : lastVerdict.verdict === 'wrong'
                    ? <span className="bad">✗ wrong</span>
                    : <span>⏭ skipped</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="drill-foot">
        <span>
          {rules.autoAdvance
            ? <>type the answer — it advances itself</>
            : rules.allowSkip
              ? <><kbd>Enter</kbd> submit · <kbd>Enter</kbd> on empty skips</>
              : null}
        </span>
        <span><kbd>Esc</kbd> {rules.durationMs === null ? 'end session' : 'abort'}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function ResultsOrReview(props: {
  config: SessionConfig;
  applied: Applied;
  maxHandlerMs: number;
  onExit(): void;
  onAgain(): void;
}) {
  const [reviewing, setReviewing] = useState(false);
  return reviewing
    ? <Review log={props.applied.log} onBack={() => setReviewing(false)} />
    : <Results {...props} onReview={() => setReviewing(true)} />;
}

const MODE_TITLES = { zetamac: 'Zetamac sprint', optiver: 'Optiver 80-in-8', focus: 'Focus drill', fermi: 'Fermi sprint' } as const;

function Results({ config, applied, maxHandlerMs, onExit, onAgain, onReview }: {
  config: SessionConfig;
  applied: Applied;
  maxHandlerMs: number;
  onExit(): void;
  onAgain(): void;
  onReview(): void;
}) {
  const { summary, log, newPB, nudge, pbBefore } = applied;
  const [copied, setCopied] = useState<'link' | 'summary' | null>(null);

  const title = `${MODE_TITLES[summary.mode]}${summary.benchmark ? ' — benchmark' : summary.mode === 'zetamac' ? ' — custom' : ''}`;
  const shareUrl = `${location.origin}${location.pathname}#/drill?${encodeSession(config)}`;

  // worst buckets: session-local weakness (miss rate + slowness vs target)
  const worst = Object.entries(summary.perBucket)
    .map(([id, { n, misses }]) => {
      const times = log.filter((r) => r.spec.bucketId === id && r.ms !== null).map((r) => r.ms as number);
      const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      const slow = mean === null ? 0 : Math.min(Math.max(mean / targetMs(id) - 1, 0), 1);
      return { id, n, misses, mean, w: misses / n + 0.5 * slow };
    })
    .filter((b) => b.w > 0.05)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3);

  const copy = async (what: 'link' | 'summary') => {
    const skips = log.filter((r) => r.verdict === 'skip').length;
    const wrong = log.filter((r) => r.verdict === 'wrong').length;
    const text = what === 'link' ? shareUrl
      : `mental×math · ${title}\nscore ${summary.score} · ${Math.round(summary.accuracy * 100)}% acc · ${fmtMs(summary.medianMs)} median\n🟩×${summary.correct} 🟥×${wrong} ⬜×${skips}\ncan you beat it? ${shareUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* clipboard denied — nothing to do */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'r') onReview();
      else if (e.key === 'n') onAgain();
      else if (e.key === 'c') void copy('link');
      else if (e.key === 's') void copy('summary');
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pbDelta = pbBefore === undefined ? null : summary.score - pbBefore;

  return (
    <div className="results">
      <p className="visually-hidden" aria-live="polite">
        Session complete. {title}. Score {summary.score}, accuracy {Math.round(summary.accuracy * 100)} percent
        {summary.medianMs !== null ? `, median ${(summary.medianMs / 1000).toFixed(1)} seconds` : ''}.
        {newPB ? ' New personal best.' : ''}
      </p>
      <p className="micro">{title}{summary.replay ? ' · replay — no PBs or streaks' : ''}</p>
      <header>
        <span className="score num">{summary.score}</span>
        {pbDelta !== null && !summary.replay && (
          <span className={`pb-delta${pbDelta > 0 ? ' up' : ''}`}>
            {pbDelta > 0 ? `▲ +${pbDelta}` : `${pbDelta}`} vs PB {pbBefore}
          </span>
        )}
        {newPB && <span className="pb-toast">New personal best</span>}
      </header>

      <div className="result-grid">
        <div className="cell"><span className="micro">Accuracy</span><span className="num">{Math.round(summary.accuracy * 100)}%</span></div>
        <div className="cell"><span className="micro">Answered</span><span className="num">{summary.answered}</span></div>
        <div className="cell"><span className="micro">Median</span><span className="num">{fmtMs(summary.medianMs)}</span></div>
        {summary.focusLosses > 0 && (
          <div className="cell"><span className="micro">Focus lost</span><span className="num">{summary.focusLosses}×</span></div>
        )}
      </div>

      {worst.length > 0 && (
        <div className="worst">
          <span className="micro">Weakest this session</span>
          <table>
            <tbody>
              {worst.map((b) => (
                <tr key={b.id}>
                  <td>{bucketLabel(b.id)}</td>
                  <td>{b.misses}/{b.n} missed{b.mean !== null ? ` · ${fmtMs(b.mean)} avg` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="result-actions">
        <button type="button" className="btn primary" onClick={onAgain}>Go again <kbd>n</kbd></button>
        <button type="button" className="btn" onClick={onReview}>Review pass <kbd>r</kbd></button>
        <button type="button" className="btn" onClick={() => void copy('link')}>
          {copied === 'link' ? 'Copied ✓' : <>Challenge link <kbd>c</kbd></>}
        </button>
        <button type="button" className="btn" onClick={() => void copy('summary')}>
          {copied === 'summary' ? 'Copied ✓' : <>Copy summary <kbd>s</kbd></>}
        </button>
        <button type="button" className="btn" onClick={onExit}>Home <kbd>Esc</kbd></button>
      </div>

      {nudge && (
        <p className="nudge">
          💾 Ten sessions since your last reminder — export your stats from Settings.
          Safari can evict local data for sites it deems unused.
        </p>
      )}
      <p className="micro" style={{ marginTop: '1.4rem' }}>
        max key-handler time this session: {maxHandlerMs.toFixed(1)}ms (budget 16ms)
      </p>
    </div>
  );
}

function Review({ log, onBack }: { log: QuestionRecord[]; onBack(): void }) {
  const [idx, setIdx] = useState(0);
  const r = log[idx] as QuestionRecord;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'j') setIdx((i) => Math.min(i + 1, log.length - 1));
      else if (e.key === 'ArrowLeft' || e.key === 'k') setIdx((i) => Math.max(i - 1, 0));
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log.length, onBack]);

  const approx = (() => {
    // tolerance-graded answers get a readable decimal alongside the exact form
    const v = r.spec.answer.num / r.spec.answer.den;
    if (r.spec.grading === 'sig3') return ` ≈ ${v.toPrecision(3)}`;
    if (r.spec.grading === 'rel5' && r.spec.answer.den !== 1) return ` ≈ ${v.toPrecision(4)}`;
    return '';
  })();
  const canonical =
    (r.spec.op.startsWith('frac') ? ratToFractionString(r.spec.answer) : ratToString(r.spec.answer)) + approx;

  return (
    <div className="review">
      <p className="micro">Review pass · {idx + 1} / {log.length}</p>
      <div className="qbig num">{r.spec.prompt}</div>
      <p>
        {r.verdict === 'correct' && <span style={{ color: 'var(--ok)' }}>✓ correct</span>}
        {r.verdict === 'wrong' && <span style={{ color: 'var(--bad)' }}>✗ wrong</span>}
        {r.verdict === 'skip' && <span>⏭ skipped</span>}
      </p>
      <dl>
        <dt>Your answer</dt><dd>{r.given ?? '—'}</dd>
        <dt>Correct</dt><dd>{canonical}</dd>
        <dt>Type</dt><dd style={{ fontFamily: 'var(--font-ui)' }}>{bucketLabel(r.spec.bucketId)}</dd>
        <dt>Time</dt><dd>{fmtMs(r.ms)}{r.firstKeyMs !== null ? ` (${fmtMs(r.firstKeyMs)} to first key)` : ''}</dd>
      </dl>
      <progress value={idx + 1} max={log.length} aria-label="Position in review" />
      <p className="nav-hint">← → step through · Esc back to results</p>
    </div>
  );
}
