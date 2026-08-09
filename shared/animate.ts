import type { AnimState } from './draw.js';
import * as spec from './spec.js';

export type EasingName = 'linear' | 'easeOut' | 'easeInOut' | 'easeOutBack';

const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeOut: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

export interface BarInstance {
  id: string;
  text: string;
  inSec: number; // when the bar starts entering
  holdSec: number; // how long it stays fully visible after entering
  inDurationSec: number;
  outDurationSec: number;
  easingIn: EasingName;
  easingOut: EasingName;
}

/** Samples one bar instance at time `t` (seconds), returning the AnimState to feed drawSuperBar(). */
export function sampleBar(bar: BarInstance, t: number): AnimState | null {
  const inStart = bar.inSec;
  const inEnd = inStart + bar.inDurationSec;
  const holdEnd = inEnd + bar.holdSec;
  const outEnd = holdEnd + bar.outDurationSec;

  if (t < inStart || t > outEnd) return null;

  if (t <= inEnd) {
    const raw = bar.inDurationSec > 0 ? (t - inStart) / bar.inDurationSec : 1;
    return sampleInPhase(raw, bar.easingIn);
  }
  if (t <= holdEnd) {
    return { growT: 1, opacity: 1, redBirdT: 1, littleBirdT: 1 };
  }
  const raw = bar.outDurationSec > 0 ? (t - holdEnd) / bar.outDurationSec : 1;
  return sampleOutPhase(raw, bar.easingOut);
}

/** raw is normalized [0,1] across the whole "in" duration; maps a [start,start+frac) sub-window
 *  of it to its own clamped [0,1] sub-progress. */
function subProgress(raw: number, start: number, frac: number): number {
  if (frac <= 0) return raw >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (raw - start) / frac));
}

/** Sequential, non-overlapping stages: red bird scales in, then little bird, then the existing
 *  bar-grow + text-fade curve -- per the staged reveal reference the user supplied, birds pop in
 *  (smooth ease, no overshoot) before the bar starts growing, rather than all fading in at once. */
function sampleInPhase(raw: number, easingName: EasingName): AnimState {
  const rFrac = spec.REVEAL_RED_BIRD_FRACTION;
  const lFrac = spec.REVEAL_LITTLE_BIRD_FRACTION;
  const barFrac = 1 - rFrac - lFrac;

  const redRaw = subProgress(raw, 0, rFrac);
  const littleRaw = subProgress(raw, rFrac, lFrac);
  const barRaw = subProgress(raw, rFrac + lFrac, barFrac);

  return {
    growT: EASINGS[easingName](barRaw),
    opacity: 1,
    redBirdT: EASINGS.easeOut(redRaw),
    littleBirdT: EASINGS.easeOut(littleRaw),
  };
}

/** Mirrors sampleInPhase in reverse order: bar shrinks + text fades first, then little bird
 *  scales out, then red bird scales out last. */
function sampleOutPhase(raw: number, easingName: EasingName): AnimState {
  const rFrac = spec.REVEAL_RED_BIRD_FRACTION;
  const lFrac = spec.REVEAL_LITTLE_BIRD_FRACTION;
  const barFrac = 1 - rFrac - lFrac;

  const barRaw = subProgress(raw, 0, barFrac);
  const littleRaw = subProgress(raw, barFrac, lFrac);
  const redRaw = subProgress(raw, barFrac + lFrac, rFrac);

  const easedBar = EASINGS[easingName](barRaw);

  return {
    growT: 1 - easedBar,
    opacity: 1 - easedBar,
    littleBirdT: 1 - EASINGS.easeOut(littleRaw),
    redBirdT: 1 - EASINGS.easeOut(redRaw),
  };
}

export function defaultBar(id: string, text: string, inSec: number): BarInstance {
  return {
    id,
    text,
    inSec,
    holdSec: 4,
    inDurationSec: 0.6,
    outDurationSec: 0.4,
    easingIn: 'easeOut',
    easingOut: 'easeOut',
  };
}
