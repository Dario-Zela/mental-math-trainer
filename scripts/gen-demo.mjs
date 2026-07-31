/**
 * Generates src/ui/demo-data.json — the bundled store behind the stats
 * screen's "load demo data" button, so an empty first visit can show a fully
 * populated dashboard in one click. Deterministic (seeded LCG): re-running
 * produces the same file. Clearly synthetic; the README labels it as such.
 *
 *   node scripts/gen-demo.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let state = 0x5eed;
const rnd = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0xffffffff;
};
const between = (lo, hi) => lo + rnd() * (hi - lo);
const jitter = (x, frac) => x * (1 + between(-frac, frac));

const DAY = 86_400_000;
const START = Date.parse('2026-05-04T18:30:00Z'); // ~12 weeks of training
const WEEKS = 12;

const TARGETS = {
  'add:2d2d': 3000, 'add:3d2d': 3000, 'add:3d3d': 5000,
  'sub:2d2d': 3000, 'sub:3d2d': 3000, 'sub:3d3d': 5000,
  'add:1d1d': 1500, 'sub:1d1d': 2000, 'chain:mix': 5000,
  'mul:1x1': 2000, 'mul:1x2': 4000, 'mul:2x2': 9000, 'mul:1x3': 8000,
  'div:1x2': 5000, 'div:2x2': 10000, 'div:1x3': 9000,
  'frac_add:small': 10000, 'frac_add:any': 10000,
  'frac_mul:small': 10000, 'frac_mul:any': 10000,
  'dec_mul:clean': 5000, 'dec_mul:ugly': 9000,
  'pct_of:clean': 6000, 'pct_of:ugly': 6000,
  'pct_change:clean': 6000, 'pct_change:ugly': 6000,
  'recip:term': 4000,
  'add:zeta': 3000, 'sub:zeta': 3000, 'mul:zeta': 5000, 'div:zeta': 5000,
};

// a plausible weakness profile: strong on add/sub, weak on 2x2 mul and ugly decimals
const WEAK = { 'mul:2x2': 0.32, 'dec_mul:ugly': 0.28, 'frac_add:any': 0.22, 'div:2x2': 0.2, 'pct_change:ugly': 0.18 };

const sessions = [];
const pbs = {};
let day = 0;

const push = (mode, benchmark, score, answered, correct, medianMs, durationSec, buckets) => {
  const startedAt = START + day * DAY + Math.floor(between(-4, 5)) * 3_600_000;
  const perBucket = {};
  for (const b of buckets) {
    const n = Math.max(2, Math.round(answered / buckets.length * jitter(1, 0.4)));
    perBucket[b] = { n, misses: Math.round(n * between(0.02, (WEAK[b] ?? 0.1) + 0.08)) };
  }
  sessions.push({
    id: `demo-${sessions.length}-${startedAt}`,
    startedAt, mode, benchmark, replay: false,
    score, answered, correct,
    accuracy: correct / answered,
    medianMs: Math.round(medianMs),
    durationSec, focusLosses: rnd() < 0.12 ? 1 : 0,
    perBucket,
    seedHex: Math.floor(rnd() * 0xffffffff).toString(16).padStart(8, '0'),
  });
  if ((mode === 'optiver' || benchmark) && score > (pbs[mode] ?? -Infinity)) pbs[mode] = score;
};

const ZETA = ['add:zeta', 'sub:zeta', 'mul:zeta', 'div:zeta'];
const OPT = ['add:2d2d', 'add:3d3d', 'sub:2d2d', 'mul:1x2', 'mul:2x2', 'div:1x2', 'div:2x2',
  'frac_add:small', 'frac_mul:small', 'dec_mul:clean', 'dec_mul:ugly', 'dec_add:2dp', 'dec_div:1dp', 'missing:mul'];
const CUSTOM = ['mul:2x2', 'dec_mul:ugly', 'frac_add:any', 'pct_change:ugly', 'div:2x2', 'pct_of:ugly'];

for (let w = 0; w < WEEKS; w++) {
  const progress = w / (WEEKS - 1); // 0 → 1 over the training block
  const daysActive = [0, 1, 2, 4, 5].filter(() => rnd() < 0.82);
  for (const d of daysActive) {
    day = w * 7 + d;
    // benchmark sprint most active days: 31 → high-50s with noise + plateaus
    const zetaScore = Math.round(31 + 27 * Math.pow(progress, 1.25) + between(-4, 4));
    const zAnswered = zetaScore + Math.round(between(1, 5));
    push('zetamac', true, zetaScore, zAnswered, zetaScore, jitter(2600 - 900 * progress, 0.1), 120, ZETA);

    if (rnd() < 0.5) {
      // weakness-targeted custom sprint (separate faint series)
      const cScore = Math.round(14 + 14 * progress + between(-3, 3));
      push('zetamac', false, cScore, cScore + Math.round(between(2, 6)), cScore, jitter(5200 - 1500 * progress, 0.12), 120, CUSTOM);
    }
    if (d === 4 || (d === 2 && rnd() < 0.35)) {
      // sim roughly twice a week: 21 → low-60s net
      const correct = Math.round(38 + 28 * progress + between(-5, 5));
      const wrong = Math.round(between(2, 9) * (1 - 0.6 * progress));
      const answered = Math.min(80, correct + wrong + Math.round(between(0, 6)));
      push('optiver', false, correct - wrong, answered, correct, jitter(6200 - 2200 * progress, 0.1), 480, OPT);
    }
    if (rnd() < 0.3) {
      const b = CUSTOM[Math.floor(rnd() * CUSTOM.length)];
      const n = Math.round(between(15, 30));
      const correct = Math.round(n * between(0.75, 0.97));
      push('focus', false, correct, n, correct, jitter(TARGETS[b], 0.25), null, [b]);
    }
  }
}

sessions.sort((a, b) => a.startedAt - b.startedAt);

// bucket EWMAs consistent with the profile above, post-training
const buckets = {};
for (const [b, target] of Object.entries(TARGETS)) {
  const weak = WEAK[b] ?? 0;
  buckets[b] = {
    attempts: Math.round(between(25, 90) + (weak > 0 ? 60 : 0)), // the scheduler oversamples weak buckets
    errRate: +(between(0.02, 0.08) + weak * 0.6).toFixed(3),
    meanMs: Math.round(target * between(0.75, 1.05) * (1 + weak)),
    meanFirstKeyMs: 0,
    difficulty: +(between(0.55, 0.9) - weak).toFixed(2), // strong buckets have annealed upward
  };
  buckets[b].meanFirstKeyMs = Math.round(buckets[b].meanMs * between(0.5, 0.68));
}
// a couple of cold buckets so the heatmap's small-n desaturation shows
buckets['frac_mul:any'] = { attempts: 6, errRate: 0.31, meanMs: 12400, meanFirstKeyMs: 8600, difficulty: 0.42 };
buckets['add:3d3d'] = { attempts: 4, errRate: 0.12, meanMs: 5900, meanFirstKeyMs: 3400, difficulty: 0.5 };

const lastDay = new Date(sessions[sessions.length - 1].startedAt);
const store = {
  version: 2,
  settings: {
    enabledBuckets: CUSTOM.concat('add:2d2d', 'sub:2d2d', 'mul:1x2', 'pct_of:clean', 'recip:term'),
    mode: { mode: 'zetamac', durationSec: 120 },
    targetScore: 60,
    sound: true,
  },
  buckets,
  sessions,
  lastSessionLog: [],
  pbs,
  streak: {
    current: 4, best: 9,
    lastActiveDay: lastDay.toISOString().slice(0, 10),
  },
  sessionsSinceNudge: 3,
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'demo-data.json');
writeFileSync(out, JSON.stringify(store, null, 1) + '\n');
console.log(`wrote ${out}: ${sessions.length} sessions, PBs`, pbs);
