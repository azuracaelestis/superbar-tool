import type { AnimState } from './draw.js';

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
    const eased = EASINGS[bar.easingIn](raw);
    return { growT: eased, opacity: 1 };
  }
  if (t <= holdEnd) {
    return { growT: 1, opacity: 1 };
  }
  const raw = bar.outDurationSec > 0 ? (t - holdEnd) / bar.outDurationSec : 1;
  const eased = EASINGS[bar.easingOut](raw);
  return { growT: 1 - eased, opacity: 1 - eased };
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
