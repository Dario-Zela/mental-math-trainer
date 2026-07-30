import type { Op } from '../core/questions';

export const OP_LABELS: Record<Op, string> = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
  frac_add: 'Fractions +',
  frac_mul: 'Fractions ×',
  dec_mul: 'Decimals ×',
  pct_of: 'Percent of',
  pct_change: 'Percent change',
  recip: 'Reciprocals',
  fermi: 'Fermi ≈',
};

export const CLASS_LABELS: Record<string, string> = {
  '2d2d': '2-digit ± 2-digit',
  '3d2d': '3-digit ± 2-digit',
  '3d3d': '3-digit ± 3-digit',
  '1x2': '1×2 digit',
  '2x2': '2×2 digit',
  '1x3': '1×3 digit',
  small: 'small denominators',
  any: 'any denominators',
  clean: 'clean',
  ugly: 'ugly',
  term: 'terminating',
  rep: 'repeating · 3 s.f.',
  zeta: 'Zetamac ranges',
  mul: 'big ×',
  div: 'big ÷',
  pct: 'big %',
};

export function bucketLabel(bucketId: string): string {
  const [op, cls] = bucketId.split(':') as [Op, string];
  return `${OP_LABELS[op] ?? op} · ${CLASS_LABELS[cls] ?? cls}`;
}

export function fmtMs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Local calendar day as YYYY-MM-DD — streaks are local-time concepts. */
export function todayLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
