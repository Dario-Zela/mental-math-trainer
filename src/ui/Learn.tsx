import { useMemo } from 'react';
import { useStore } from './storeContext';
import { bucketLabel, fmtMs } from './labels';
import { TECHNIQUES, explain, type Technique } from '../core/tricks';
import { generateQuestion } from '../core/questions';
import { mulberry32, randomSeed } from '../core/rng';
import { targetMs, type BucketStats } from '../core/buckets';
import { makeConfig, type SessionConfig } from '../core/session';

type Mastery = 'new' | 'practising' | 'mastered';

function mastery(stats: BucketStats | undefined, bucketId: string): Mastery {
  if (!stats || stats.attempts < 10) return 'new';
  if (stats.errRate <= 0.1 && stats.meanMs > 0 && stats.meanMs <= targetMs(bucketId)) return 'mastered';
  return 'practising';
}

const MASTERY_LABEL: Record<Mastery, string> = {
  new: 'new', practising: 'practising', mastered: 'mastered',
};
const MASTERY_ORDER: Record<Mastery, number> = { practising: 0, new: 1, mastered: 2 };

/**
 * A worked example for the card: the hardcoded one when the technique's
 * trigger is rare, otherwise generated live — resampling until the explainer
 * actually picks this card's technique, so the example always demonstrates
 * the trick it sits next to.
 */
function cardExample(t: Technique): { prompt: string; steps: string[] } {
  if (t.example) return t.example;
  let seed = 0;
  for (const ch of t.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 200; i++) {
    const q = generateQuestion(t.practiceBucket, mulberry32(seed + i), 0);
    const e = explain(q);
    if (e.techniqueId === t.id) return { prompt: q.prompt, steps: e.steps };
  }
  const q = generateQuestion(t.practiceBucket, mulberry32(seed), 0);
  return { prompt: q.prompt, steps: explain(q).steps };
}

export function Learn({ onStart }: { onStart(config: SessionConfig): void }) {
  const { store, update } = useStore();

  const cards = useMemo(
    () =>
      TECHNIQUES.map((t) => ({
        t,
        example: cardExample(t),
        state: mastery(store.buckets[t.practiceBucket], t.practiceBucket),
        stats: store.buckets[t.practiceBucket],
      })).sort((a, b) => MASTERY_ORDER[a.state] - MASTERY_ORDER[b.state]),
    [store.buckets],
  );

  const practice = (t: Technique) => {
    // practising from Learn always coaches: misses pause on the worked trick
    update((s) => ({ ...s, settings: { ...s.settings, coach: true } }));
    onStart(makeConfig('focus', [t.practiceBucket], store.buckets, randomSeed(Math.random())));
  };

  const mastered = cards.filter((c) => c.state === 'mastered').length;

  return (
    <div className="page">
      <h2>Learn</h2>
      <p className="micro">
        {TECHNIQUES.length} techniques · {mastered} mastered — a bucket counts as mastered at 10+ attempts,
        ≤10% error, and mean time under target. Practice drills run with the coach on: misses pause on the
        worked trick, and <kbd>h</kbd> surrenders a question to see it solved.
      </p>
      <div className="learn-grid">
        {cards.map(({ t, example, state, stats }) => (
          <article className="learn-card" key={t.id}>
            <header>
              <h3>{t.name}</h3>
              <span className={`mastery mastery-${state}`}>{MASTERY_LABEL[state]}</span>
            </header>
            <p className="summary">{t.summary}</p>
            <p className="detail">{t.detail}</p>
            <div className="example">
              <span className="micro">worked example</span>
              <div className="ex-prompt num">{example.prompt}</div>
              <ol className="steps">
                {example.steps.map((s, i) => <li key={i} className="num">{s}</li>)}
              </ol>
            </div>
            <footer>
              <span className="micro">
                {bucketLabel(t.practiceBucket)}
                {stats && stats.attempts > 0 && (
                  <> · n={stats.attempts} · {Math.round(stats.errRate * 100)}% err · {fmtMs(stats.meanMs)}</>
                )}
              </span>
              <button type="button" className="btn" onClick={() => practice(t)}>
                Practice →
              </button>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
