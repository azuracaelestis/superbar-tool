import * as spec from './spec.js';

export interface GlyphMetricsSource {
  measureText(text: string, fontFamily: string, sizePx: number): number;
}

export interface BarLayout {
  s: number; // scale factor, videoHeight / 1080
  barTop: number;
  barHeight: number;
  barBottom: number;
  leftAttachX: number; // x of the bar's fixed top-left vertex
  rightAttachX: number; // x of the bar's right-cap attach vertex -- THE computed value
  coreWidth: number; // rightAttachX - leftAttachX
  textX: number;
  textBaselineY: number;
  textSizePx: number;
  clamped: boolean; // true if coreWidth hit MIN_CORE_WIDTH and text had to be measured anyway
  overSafeZone: boolean;
}

/**
 * The auto-width solver. One measurement of the text drives the bar's right-cap position --
 * the fix for the AEP's three-layer, hand-keyframed-per-layer template.
 */
export function computeLayout(
  text: string,
  videoWidth: number,
  videoHeight: number,
  measure: GlyphMetricsSource,
  fontFamily: string = spec.TEXT_FONT_FAMILY,
): BarLayout {
  const s = videoHeight / spec.COMP_HEIGHT;

  const textSizePx = spec.TEXT_SIZE * s;
  const textW = measure.measureText(text, fontFamily, textSizePx);

  const leftAttachX = spec.LEFT_ATTACH_X * s;
  const desiredCore = spec.TEXT_LEFT_PAD * s + textW + spec.TEXT_RIGHT_PAD * s;
  const coreWidth = Math.max(spec.MIN_CORE_WIDTH * s, desiredCore);
  const clamped = coreWidth > desiredCore + 0.01;

  const rightAttachX = leftAttachX + coreWidth;

  const barTop = spec.BAR_TOP * s;
  const barHeight = spec.BAR_HEIGHT * s;

  // safe-zone: warn if the widest point of the bar (right cap bulge) would run past the
  // frame's right edge minus a standard title-safe margin (5% of width).
  const safeMarginX = videoWidth * 0.05;
  const rightMostX = rightAttachX + spec.RIGHT_CAP_BULGE_DX * s;
  const overSafeZone = rightMostX > videoWidth - safeMarginX;

  return {
    s,
    barTop,
    barHeight,
    barBottom: barTop + barHeight,
    leftAttachX,
    rightAttachX,
    coreWidth,
    textX: leftAttachX + spec.TEXT_LEFT_PAD * s,
    textBaselineY: barTop + spec.TEXT_BASELINE_FROM_TOP * s,
    textSizePx,
    clamped,
    overSafeZone,
  };
}

/**
 * Interpolates the AEP's grow keyframes (163 / 173 / 265 / 803, against the pinned left edge)
 * into a single normalized progress value in [0,1] -> a core-width ratio, applied against the
 * FINAL computed coreWidth from computeLayout(). This is what makes it one animated scalar
 * instead of four duplicated path keyframes across three layers.
 */
export function growProgressToWidthRatio(t: number): number {
  const ts = spec.GROW_KEYFRAME_TS;
  const ws = spec.GROW_KEYFRAME_WIDTHS_RATIO;
  const finalW = ws[ws.length - 1];
  const clampedT = Math.max(0, Math.min(1, t));
  for (let i = 0; i < ts.length - 1; i++) {
    if (clampedT >= ts[i] && clampedT <= ts[i + 1]) {
      const localT = (clampedT - ts[i]) / (ts[i + 1] - ts[i]);
      const w = ws[i] + (ws[i + 1] - ws[i]) * localT;
      return w / finalW;
    }
  }
  return 1;
}
