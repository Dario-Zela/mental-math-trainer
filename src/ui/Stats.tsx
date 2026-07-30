import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useStore } from './storeContext';
import { bucketLabel, fmtMs, OP_LABELS } from './labels';
import { OPERAND_CLASSES, type Op } from '../core/questions';
import { weakness, type BucketStats } from '../core/buckets';
import { WEAKNESS_MAX } from '../core/scheduler';
import { importJSON } from '../store/persist';
import type { SessionSummary } from '../core/session';
import demoData from './demo-data.json';

const MODE_TAGS = { zetamac: 'zeta', optiver: '80-in-8', focus: 'focus' } as const;

/* ------------------------------------------------------------------ */
/* score-over-time chart                                              */
/* ------------------------------------------------------------------ */

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface ChartData {
  xs: number[];
  main: (number | null)[];
  rolling: (number | null)[];
  custom: (number | null)[];
  pb: (number | null)[];
}

function buildChartData(sessions: SessionSummary[], tab: 'zetamac' | 'optiver', dateAxis: boolean): ChartData {
  const rows = sessions
    .filter((s) => !s.replay && s.mode === tab)
    .sort((a, b) => a.startedAt - b.startedAt);
  const isMain = (s: SessionSummary) => tab === 'optiver' || s.benchmark;

  const xs = rows.map((s, i) => (dateAxis ? s.startedAt / 1000 : i + 1));
  const main = rows.map((s) => (isMain(s) ? s.score : null));
  const custom = rows.map((s) => (isMain(s) ? null : s.score));

  // 5-session rolling mean over the benchmark series only
  const rolling: (number | null)[] = [];
  const win: number[] = [];
  for (const v of main) {
    if (v === null) { rolling.push(null); continue; }
    win.push(v);
    if (win.length > 5) win.shift();
    rolling.push(win.reduce((a, b) => a + b, 0) / win.length);
  }

  // PB markers: points where the benchmark series sets a new maximum
  let max = -Infinity;
  const pb = main.map((v) => {
    if (v === null) return null;
    if (v > max) { max = v; return v; }
    return null;
  });

  return { xs, main, rolling, custom, pb };
}

function ScoreChart({ data, dateAxis, target }: { data: ChartData; dateAxis: boolean; target: number | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [width, setWidth] = useState(800);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeTick((t) => t + 1);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const accent = cssVar('--accent');
    const dim = cssVar('--ink-dim');
    const hairline = cssVar('--hairline');
    const bad = cssVar('--bad');
    const surface = cssVar('--bg-raised');

    const targetSeries = target === null ? null : data.xs.map(() => target);
    const series: uPlot.Series[] = [
      {},
      { label: 'score', stroke: accent, width: 2, points: { show: true, size: 5, fill: accent } },
      { label: '5-mean', stroke: dim, width: 1, dash: [5, 5], points: { show: false }, spanGaps: true },
      { label: 'custom', stroke: accent, width: 1, alpha: 0.35, points: { show: true, size: 4 }, spanGaps: true },
      { label: 'PB', stroke: 'transparent', points: { show: true, size: 9, fill: accent, stroke: surface, width: 2 } },
    ];
    const plotData: uPlot.AlignedData = [data.xs, data.main, data.rolling, data.custom, data.pb];
    if (targetSeries) {
      series.push({ label: 'target', stroke: bad, width: 1, dash: [2, 6], points: { show: false } });
      plotData.push(targetSeries);
    }

    const axis: uPlot.Axis = {
      stroke: dim,
      grid: { stroke: hairline, width: 1 },
      ticks: { stroke: hairline, width: 1 },
      font: '12px "Space Mono", monospace',
    };
    const plot = new uPlot(
      {
        width,
        height: 280,
        scales: { x: { time: dateAxis } },
        series,
        axes: [{ ...axis }, { ...axis }],
        legend: { show: false },
        cursor: { points: { size: 8 } },
      },
      plotData,
      el,
    );
    plotRef.current = plot;
    return () => { plot.destroy(); plotRef.current = null; };
  }, [data, dateAxis, target, width, themeTick]);

  const exportPNG = () => {
    const canvas = wrapRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'training-curve.png';
    a.click();
  };

  return (
    <>
      <div ref={wrapRef} className="chart-box" role="img" tabIndex={0} aria-label="Score over time chart" />
      <div className="chart-legend">
        <span className="chip"><span className="swatch line accent" /> score</span>
        <span className="chip"><span className="swatch line dashed" /> 5-session mean</span>
        <span className="chip"><span className="swatch line faint" /> custom ranges</span>
        <span className="chip"><span className="swatch dot" /> PB</span>
        {target !== null && <span className="chip"><span className="swatch line target" /> target {target}</span>}
        <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={exportPNG}>Export PNG</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* bucket heatmap + think/typing split                                */
/* ------------------------------------------------------------------ */

function HeatCell({ id, stats }: { id: string; stats: BucketStats | undefined }) {
  const attempts = stats?.attempts ?? 0;
  if (attempts === 0) return <td aria-label={`${bucketLabel(id)}: no attempts`}>·</td>;
  const w = weakness(stats, id);
  const pct = Math.round((Math.min(w, WEAKNESS_MAX) / WEAKNESS_MAX) * 65);
  const small = attempts < 10; // small-n noise must not masquerade as signal
  const label = `${bucketLabel(id)}: weakness ${w.toFixed(2)}, mean ${fmtMs(stats!.meanMs)}, error ${Math.round(stats!.errRate * 100)}%, ${attempts} attempts`;
  return (
    <td
      className={small ? 'small-n' : undefined}
      style={{ background: `color-mix(in oklab, var(--accent) ${pct}%, var(--heat-0))` }}
      title={label}
      aria-label={label}
    >
      {fmtMs(stats!.meanMs)}
      {small && <span className="n-small">n={attempts}</span>}
    </td>
  );
}

function Heatmap({ buckets }: { buckets: Record<string, BucketStats> }) {
  const ops = Object.keys(OPERAND_CLASSES) as Op[];
  const hasZeta = (op: Op) => ['add', 'sub', 'mul', 'div'].includes(op);
  return (
    // scrollable on narrow screens, so it must be keyboard-reachable
    <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Weakness heatmap by question type">
      <table className="heatmap">
        <thead>
          <tr>
            <th />
            <th scope="col">I</th><th scope="col">II</th><th scope="col">III</th><th scope="col">Zetamac</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op) => (
            <tr key={op}>
              <th scope="row" style={{ textAlign: 'left' }}>{OP_LABELS[op]}</th>
              {[0, 1, 2].map((i) => {
                const cls = OPERAND_CLASSES[op][i];
                return cls === undefined
                  ? <td key={i} aria-hidden="true" />
                  : <HeatCell key={i} id={`${op}:${cls}`} stats={buckets[`${op}:${cls}`]} />;
              })}
              {hasZeta(op)
                ? <HeatCell id={`${op}:zeta`} stats={buckets[`${op}:zeta`]} />
                : <td aria-hidden="true" />}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="micro" style={{ marginTop: '0.5rem' }}>
        colour = weakness (error rate + slowness vs target) · label = mean time · I→III is the difficulty ladder · faded cells have &lt;10 attempts
      </p>
    </div>
  );
}

function SplitBars({ buckets }: { buckets: Record<string, BucketStats> }) {
  const rows = Object.entries(buckets)
    .filter(([, s]) => s.attempts >= 10 && s.meanMs > 0 && s.meanFirstKeyMs > 0)
    .map(([id, s]) => ({ id, think: Math.min(s.meanFirstKeyMs, s.meanMs), total: s.meanMs }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  if (rows.length === 0) {
    return <p className="micro" style={{ marginTop: '0.8rem' }}>Appears once buckets reach 10 attempts.</p>;
  }
  const max = rows[0]?.total ?? 1;
  return (
    <div className="split-bars">
      <div className="chart-legend" style={{ marginTop: '0.8rem' }}>
        <span className="chip"><span className="swatch box accent" /> think (to first key)</span>
        <span className="chip"><span className="swatch box neutral" /> type (rest)</span>
      </div>
      {rows.map((r) => (
        <div className="split-row" key={r.id}>
          <span className="split-label">{bucketLabel(r.id)}</span>
          <span
            className="split-bar"
            role="img"
            aria-label={`${bucketLabel(r.id)}: ${fmtMs(r.think)} thinking, ${fmtMs(r.total - r.think)} typing`}
          >
            <span className="seg think" style={{ width: `${(r.think / max) * 100}%` }} />
            <span className="seg type" style={{ width: `${((r.total - r.think) / max) * 100}%` }} />
          </span>
          <span className="split-ms num">{fmtMs(r.total)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* calendar strip                                                     */
/* ------------------------------------------------------------------ */

function CalendarStrip({ sessions }: { sessions: SessionSummary[] }) {
  const active = new Set(
    sessions
      .filter((s) => !s.replay && s.mode !== 'focus')
      .map((s) => {
        const d = new Date(s.startedAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
  );
  const days: { key: string; on: boolean }[] = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (7 * 12 - 1) - ((today.getDay() + 6) % 7)); // 12 weeks, Monday-aligned
  for (let i = 0; i < 7 * 12; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > today) break;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ key, on: active.has(key) });
  }
  return (
    <div className="calendar-strip" role="img" aria-label={`Training calendar: ${active.size} active days in the last 12 weeks`}>
      {days.map((d) => (
        <span key={d.key} className={`day${d.on ? ' active' : ''}`} title={`${d.key}${d.on ? ' · trained' : ''}`} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Stats() {
  const { store, update } = useStore();
  const [tab, setTab] = useState<'zetamac' | 'optiver'>('zetamac');
  const [dateAxis, setDateAxis] = useState(false);

  const chartData = useMemo(
    () => buildChartData(store.sessions, tab, dateAxis),
    [store.sessions, tab, dateAxis],
  );

  const loadDemo = () => {
    const demo = importJSON(JSON.stringify(demoData));
    if (demo) update(() => demo);
  };

  if (store.sessions.length === 0) {
    return (
      <div className="page">
        <h2>Stats</h2>
        <div className="empty-state">
          <p>No sessions yet — run a drill and your training curve starts here.</p>
          <p style={{ marginTop: '0.8rem' }}>
            <button type="button" className="btn" onClick={loadDemo}>Load demo data</button>
          </p>
          <p className="micro" style={{ marginTop: '0.6rem' }}>
            (12 weeks of synthetic training — explore the dashboard, then reset from Settings)
          </p>
        </div>
      </div>
    );
  }

  const sessions = [...store.sessions].reverse();
  const hasChart = chartData.xs.length >= 2;

  return (
    <div className="page">
      <h2>Stats</h2>
      <CalendarStrip sessions={store.sessions} />

      <section>
        <h3>Score over time</h3>
        <div className="field-row">
          <button
            type="button" className={`btn${tab === 'zetamac' ? ' primary' : ''}`}
            aria-pressed={tab === 'zetamac'} onClick={() => setTab('zetamac')}
          >
            Zetamac
          </button>
          <button
            type="button" className={`btn${tab === 'optiver' ? ' primary' : ''}`}
            aria-pressed={tab === 'optiver'} onClick={() => setTab('optiver')}
          >
            Optiver
          </button>
          <label style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={dateAxis} onChange={(e) => setDateAxis(e.target.checked)} />
            date axis
          </label>
        </div>
        {hasChart
          ? <ScoreChart data={chartData} dateAxis={dateAxis} target={store.settings.targetScore} />
          : <p className="micro" style={{ marginTop: '0.8rem' }}>Two or more {tab} sessions and the line appears.</p>}
      </section>

      <section>
        <h3>Weakness heatmap</h3>
        <Heatmap buckets={store.buckets} />
      </section>

      <section>
        <h3>Where the seconds go — think vs type</h3>
        <SplitBars buckets={store.buckets} />
      </section>

      <section>
        <h3>Sessions</h3>
        <table className="sessions-table">
          <thead>
            <tr>
              <th>Date</th><th>Mode</th><th className="num">Score</th>
              <th className="num">Acc</th><th className="num">Median</th><th>Weakest</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 50).map((s) => {
              const worst = Object.entries(s.perBucket)
                .filter(([, v]) => v.misses > 0)
                .sort((a, b) => b[1].misses / b[1].n - a[1].misses / a[1].n)[0];
              return (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleDateString()}</td>
                  <td>
                    <span className="tag">{MODE_TAGS[s.mode]}</span>
                    {s.mode === 'zetamac' && !s.benchmark && <span className="tag">custom</span>}
                    {s.replay && <span className="tag">replay</span>}
                  </td>
                  <td className="num">{s.score}</td>
                  <td className="num">{Math.round(s.accuracy * 100)}%</td>
                  <td className="num">{fmtMs(s.medianMs)}</td>
                  <td style={{ color: 'var(--ink-dim)' }}>{worst ? bucketLabel(worst[0]) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sessions.length > 50 && <p className="micro" style={{ marginTop: '0.5rem' }}>Showing the most recent 50 of {sessions.length}.</p>}
      </section>
    </div>
  );
}
