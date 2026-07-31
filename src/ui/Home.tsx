import { useEffect, useState } from 'react';
import { useStore } from './storeContext';
import { bucketLabel } from './labels';
import { makeConfig, type SessionConfig } from '../core/session';
import { activeProfile, PROFILES } from '../core/presets';
import { FERMI_BUCKETS, OPTIVER_BUCKETS, ZETA_BUCKETS } from '../core/questions';
import { randomSeed } from '../core/rng';
import { ZETAMAC_DEFAULT_SEC } from '../core/scoring';

export function Home({ onStart }: { onStart(config: SessionConfig): void }) {
  const { store, update } = useStore();
  const [focusBucket, setFocusBucket] = useState<string>(store.settings.enabledBuckets[0] ?? 'mul:2x2');
  const firstRun = store.sessions.length === 0;
  const profile = activeProfile(store.settings.enabledBuckets);
  // a profile switch can remove the picked focus bucket — fall back gracefully
  const effectiveFocus = store.settings.enabledBuckets.includes(focusBucket)
    ? focusBucket
    : store.settings.enabledBuckets[0] ?? 'mul:2x2';

  const applyProfile = (id: string) => {
    const p = PROFILES.find((x) => x.id === id);
    if (p) update((s) => ({ ...s, settings: { ...s.settings, enabledBuckets: [...p.buckets] } }));
  };

  const start = (mode: 'zetamac-bench' | 'zetamac-custom' | 'optiver' | 'focus' | 'fermi' | 'blitz') => {
    const seed = randomSeed(Math.random());
    const { enabledBuckets, mode: modeCfg } = store.settings;
    if (mode === 'zetamac-bench') {
      onStart(makeConfig('zetamac', [...ZETA_BUCKETS], store.buckets, seed, ZETAMAC_DEFAULT_SEC));
    } else if (mode === 'zetamac-custom') {
      onStart(makeConfig('zetamac', enabledBuckets, store.buckets, seed, modeCfg.durationSec));
    } else if (mode === 'optiver') {
      // locked test-faithful mix — the sim never tracks the user's settings
      onStart(makeConfig('optiver', [...OPTIVER_BUCKETS], store.buckets, seed));
    } else if (mode === 'fermi') {
      onStart(makeConfig('fermi', [...FERMI_BUCKETS], store.buckets, seed));
    } else if (mode === 'blitz') {
      // times-tables blitz: a fixed 60s auto-advance preset over the 1×1 bucket
      onStart(makeConfig('zetamac', ['mul:1x1'], store.buckets, seed, 60));
    } else {
      onStart(makeConfig('focus', [effectiveFocus], store.buckets, seed));
    }
  };

  // number-key launch — the whole app is keyboard-first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1') start('zetamac-bench');
      else if (e.key === '2') start('zetamac-custom');
      else if (e.key === '3') start('optiver');
      else if (e.key === '4') start('fermi');
      else if (e.key === '5') start('focus');
      else if (e.key === '6') start('blitz');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const enabledCount = store.settings.enabledBuckets.length;

  return (
    <>
      <section className="hero">
        <div className="glyphs" aria-hidden="true">×<br />÷+</div>
        <h1>
          Arithmetic,<br />under the <span className="accent">clock</span>.
        </h1>
        {firstRun ? (
          <p className="sub">
            Sprint like Zetamac, simulate the Optiver 80-in-8, and let the trainer steer questions
            at the types you miss. Everything stays in your browser — no accounts, keyboard only.
            Start with <strong>[1]</strong>, a 120-second benchmark sprint.
          </p>
        ) : (
          <p className="sub">Pick a drill. Numbers launch, no mouse needed.</p>
        )}
        <div className="streak-line num" role="group" aria-label="Streak and personal bests">
          <div className="stat">
            <span className="micro">Streak</span>
            <span className="num">{store.streak.current}d</span>
          </div>
          <div className="stat">
            <span className="micro">Best streak</span>
            <span className="num">{store.streak.best}d</span>
          </div>
          <div className="stat">
            <span className="micro">Zetamac PB</span>
            <span className="num">{store.pbs.zetamac ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="micro">Optiver PB</span>
            <span className="num">{store.pbs.optiver ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="micro">Fermi PB</span>
            <span className="num">{store.pbs.fermi ?? '—'}</span>
          </div>
        </div>
      </section>

      <div className="mode-list">
        <button type="button" className="mode-row" onClick={() => start('zetamac-bench')}>
          <span className="key" aria-hidden="true">1</span>
          <span>
            <span className="name">Zetamac sprint — benchmark</span>
            <span className="desc">Locked to Zetamac's default ranges. Scores comparable to community numbers.</span>
          </span>
          <span className="meta">120s · +1 · auto-advance</span>
        </button>
        <button type="button" className="mode-row" onClick={() => start('zetamac-custom')}>
          <span className="key" aria-hidden="true">2</span>
          <span>
            <span className="name">Custom sprint</span>
            <span className="desc">
              {profile ? `${profile.name} profile` : 'Custom pick'} · {enabledCount} types, weakness-weighted.
              Plotted as a separate series.
            </span>
          </span>
          <span className="meta">{store.settings.mode.durationSec}s · +1 · auto-advance</span>
        </button>
        <button type="button" className="mode-row" onClick={() => start('optiver')}>
          <span className="key" aria-hidden="true">3</span>
          <span>
            <span className="name">Optiver 80-in-8 — simulation</span>
            <span className="desc">
              Real conditions and the real question mix: 2–3-digit ±, 2×2 mults, decimals, small fractions, missing operands.
            </span>
          </span>
          <span className="meta">480s · 80q · +1/−1</span>
        </button>
        <button type="button" className="mode-row" onClick={() => start('fermi')}>
          <span className="key" aria-hidden="true">4</span>
          <span>
            <span className="name">Fermi sprint</span>
            <span className="desc">Estimate unwieldy products, quotients and percentages — within ±5% scores.</span>
          </span>
          <span className="meta">120s · +1 · ±5%</span>
        </button>
        <button type="button" className="mode-row" onClick={() => start('focus')}>
          <span className="key" aria-hidden="true">5</span>
          <span>
            <span className="name">Focus drill</span>
            <span className="desc">Untimed deliberate practice on one question type, per-question timings shown.</span>
          </span>
          <span className="meta">untimed · single type</span>
        </button>
        <button type="button" className="mode-row" onClick={() => start('blitz')}>
          <span className="key" aria-hidden="true">6</span>
          <span>
            <span className="name">Times-tables blitz</span>
            <span className="desc">One minute of bare 1×1 recall — the foundation every other trick stands on. Fumbled? <strong>r</strong> restarts instantly.</span>
          </span>
          <span className="meta">60s · +1 · auto-advance</span>
        </button>
      </div>
      <div className="focus-picker">
        <label className="micro" htmlFor="profile-pick">Profile</label>
        <select id="profile-pick" value={profile?.id ?? 'custom'} onChange={(e) => applyProfile(e.target.value)}>
          {PROFILES.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {!profile && <option value="custom">Custom (from Settings)</option>}
        </select>
        <label className="micro" htmlFor="focus-bucket">Focus type</label>
        <select id="focus-bucket" value={effectiveFocus} onChange={(e) => setFocusBucket(e.target.value)}>
          {store.settings.enabledBuckets.map((b) => (
            <option key={b} value={b}>{bucketLabel(b)}</option>
          ))}
        </select>
        <label className="micro" style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={store.settings.coach}
            onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, coach: e.target.checked } }))}
          />
          coach
        </label>
      </div>
    </>
  );
}
