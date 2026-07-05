// ─── Sound effects (Web Audio API, no assets) ────────────────────────────────
// Zero-asset tones for correct / wrong / transition feedback. Uses a single
// lazy AudioContext, respects user autoplay policy (resumes on first tap),
// and can be muted globally via `setSfxEnabled(false)`.

let ctx: AudioContext | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch { return null; }
  }
  // Autoplay policy: resume on demand (safe to call even when running)
  if (ctx.state === "suspended") { void ctx.resume(); }
  return ctx;
}

export function setSfxEnabled(on: boolean) { enabled = on; }
export function isSfxEnabled() { return enabled; }

// Fire-and-forget helper. Each play spins up short-lived nodes and lets
// them clean up when their envelope decays.
function tone(
  frequency: number | { from: number; to: number },
  durationMs: number,
  type: OscillatorType = "sine",
  peakGain = 0.12,
) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const dur = durationMs / 1000;

  const osc = c.createOscillator();
  osc.type = type;
  if (typeof frequency === "number") {
    osc.frequency.setValueAtTime(frequency, now);
  } else {
    osc.frequency.setValueAtTime(frequency.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, frequency.to), now + dur);
  }

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + Math.min(0.02, dur * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// ─── Public API ──────────────────────────────────────────────────────────────
// A crisp two-note "ding" for correct answers. Cheerful, non-intrusive.
export function playDing() {
  tone({ from: 660, to: 990 }, 140, "sine", 0.11);
  setTimeout(() => tone(1320, 90, "sine", 0.08), 90);
}

// A gentle low-descending "aww" for wrong answers. Never harsh — kids shouldn't
// feel punished. Just a soft signal to try again.
export function playAww() {
  tone({ from: 440, to: 220 }, 260, "triangle", 0.09);
}

// A quick sweep for transitions (game complete, screen change).
export function playWhoosh() {
  tone({ from: 300, to: 1200 }, 160, "sine", 0.06);
}

// A festive four-note flourish for milestones (streak celebrations).
export function playFanfare() {
  const notes = [523, 659, 784, 1047]; // C, E, G, C
  notes.forEach((f, i) => setTimeout(() => tone(f, 180, "triangle", 0.11), i * 110));
}
