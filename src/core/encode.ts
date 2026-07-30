/**
 * (seed, config) ⇄ URL params — shareable sessions.
 * `#/drill?m=o&s=<hex>&b=<bucket bitmask>&t=<secs>&w=<weight digits>`
 * Hash-routed, so static hosting needs no rewrite rules. The weight snapshot
 * rides along so a challenge link reproduces the sharer's session exactly,
 * including its weakness-driven bucket mix (see scheduler.ts).
 */
import { CODEC_BUCKETS } from './questions';
import type { Mode } from './scoring';
import { assessmentDifficulty, type SessionConfig } from './session';

const MODE_CODES: Record<Mode, string> = { zetamac: 'z', optiver: 'o', focus: 'f', fermi: 'e' };
const CODE_MODES: Record<string, Mode> = { z: 'zetamac', o: 'optiver', f: 'focus', e: 'fermi' };

/**
 * Enabled buckets → hex bitmask over the canonical bucket universe.
 * Arithmetic (2**i), never bitwise: JS bitwise ops truncate to 32 bits and the
 * append-only universe already holds more than 31 buckets. Doubles are exact
 * up to 2^53 — room for 53 buckets before this needs BigInt.
 */
export function encodeBuckets(buckets: readonly string[]): string {
  let mask = 0;
  for (const b of buckets) {
    const i = CODEC_BUCKETS.indexOf(b);
    if (i === -1) throw new Error(`unknown bucket ${b}`);
    mask += 2 ** i;
  }
  return mask.toString(16);
}

export function decodeBuckets(hex: string): string[] | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const mask = parseInt(hex, 16);
  if (!Number.isFinite(mask) || mask === 0 || mask >= 2 ** CODEC_BUCKETS.length) return null;
  const out: string[] = [];
  for (let i = 0; i < CODEC_BUCKETS.length; i++) {
    if (Math.floor(mask / 2 ** i) % 2 === 1) out.push(CODEC_BUCKETS[i] as string);
  }
  return out;
}

/** Session config → query-string fragment (no leading '?'). */
export function encodeSession(config: SessionConfig): string {
  const p = new URLSearchParams();
  p.set('m', MODE_CODES[config.mode]);
  p.set('s', config.seed.toString(16).padStart(8, '0'));
  p.set('b', encodeBuckets(config.buckets));
  if (config.durationSec !== null) p.set('t', String(config.durationSec));
  p.set('w', config.weights.map((w) => w.toString(16)).join(''));
  p.set('d', config.difficulties.map((d) => d.toString(16)).join(''));
  return p.toString();
}

/** Query-string fragment → session config. Null on anything malformed — never throws on foreign input. */
export function decodeSession(query: string): SessionConfig | null {
  const p = new URLSearchParams(query);
  const mode = CODE_MODES[p.get('m') ?? ''];
  if (!mode) return null;

  const seedHex = p.get('s') ?? '';
  if (!/^[0-9a-f]{1,8}$/.test(seedHex)) return null;
  const seed = parseInt(seedHex, 16) >>> 0;

  const buckets = decodeBuckets(p.get('b') ?? '');
  if (!buckets) return null;
  if (mode === 'focus' && buckets.length !== 1) return null;

  const t = p.get('t');
  let durationSec: number | null = null;
  if (t !== null) {
    durationSec = parseInt(t, 10);
    if (!Number.isInteger(durationSec) || durationSec < 10 || durationSec > 3600) return null;
  }
  if (mode === 'zetamac' && durationSec === null) return null;
  if (mode === 'focus') durationSec = null;
  if (mode === 'optiver') durationSec = 480; // 80-in-8 is fixed; t in the URL is decorative
  if (mode === 'fermi') durationSec = 120;   // the estimation sprint is fixed too

  const wRaw = p.get('w') ?? '';
  if (!/^[0-9a-f]*$/.test(wRaw)) return null;
  let weights = wRaw.length === buckets.length
    ? [...wRaw].map((c) => parseInt(c, 16))
    : buckets.map(() => 0); // tolerate missing/mismatched weights: uniform replay
  // assessments sample uniformly — a crafted URL can't mint a skewed "sim"
  if (mode === 'optiver' || mode === 'fermi') weights = weights.map(() => 0);

  const dRaw = p.get('d') ?? '';
  if (!/^[0-9a-f]*$/.test(dRaw)) return null;
  let difficulties = dRaw.length === buckets.length
    ? [...dRaw].map((c) => parseInt(c, 16))
    : buckets.map(() => 15); // pre-anneal links replay at full class ranges — byte-identical
  // assessment surfaces are never annealed — a crafted URL can't mint an easy "sim"
  difficulties = difficulties.map((d, i) => (assessmentDifficulty(mode, buckets[i] as string) ? 15 : d));

  // Opened from a URL ⇒ replay: buckets update normally, PBs/streaks don't.
  return { mode, seed, buckets, weights, difficulties, durationSec, replay: true };
}
