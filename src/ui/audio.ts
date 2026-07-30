/**
 * WebAudio feedback — zero dependencies, zero assets. Three cues:
 *  - tick: short high blip on a correct answer
 *  - buzz: low burr on a wrong answer or skip
 *  - click: neutral key-thock on ANY submit in sim mode — the Optiver sim
 *    shows no per-question feedback, so its sound must not leak the verdict
 *
 * The context is created lazily on first use (guaranteed to be inside a
 * user-gesture handler: every submit is a keystroke), and all failures are
 * swallowed — audio is decoration, never a crash.
 */
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationMs: number, type: OscillatorType, gainPeak: number): void {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ac.currentTime;
    const t1 = t0 + durationMs / 1000;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t1);
  } catch {
    /* audio is best-effort */
  }
}

export const sounds = {
  tick: () => tone(1150, 45, 'sine', 0.12),
  buzz: () => tone(155, 130, 'sawtooth', 0.09),
  click: () => tone(520, 25, 'triangle', 0.07),
};
