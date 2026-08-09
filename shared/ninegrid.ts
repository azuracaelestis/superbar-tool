import type { DrawCtx, AnimState } from './draw.js';
import { DEFAULT_ANIM, drawBarText } from './draw.js';
import { growProgressToWidthRatio } from './layout.js';
import type { GlyphMetricsSource } from './layout.js';

/** Minimal pixel-buffer shape both the browser's ImageData and @napi-rs/canvas's
 *  getImageData() result satisfy -- lets the slice-finder run identically in both. */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface SliceHandles {
  leftX: number; // px, in the source image's own coordinate space
  rightX: number;
}

export interface CropRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Rough starting box for the crop step: the bounding box of every non-transparent pixel.
 * This is deliberately naive -- it has the same blind spot as the slice auto-guess (a
 * full-bleed decorative element like a wave will pull the box out to the page edges) -- but
 * the crop step exists precisely so the operator drags it tight by hand; this just saves them
 * from starting at the full canvas size.
 */
export function autoGuessContentBounds(px: PixelBuffer): CropRect {
  let top = -1, bottom = -1, left = -1, right = -1;
  const xStep = Math.max(1, Math.floor(px.width / 400));
  const yStep = Math.max(1, Math.floor(px.height / 400));
  for (let y = 0; y < px.height; y += yStep) {
    for (let x = 0; x < px.width; x += xStep) {
      if (px.data[(y * px.width + x) * 4 + 3] > 10) {
        if (top === -1) top = y;
        bottom = y;
        if (left === -1 || x < left) left = x;
        if (right === -1 || x > right) right = x;
      }
    }
  }
  if (top === -1) return { top: 0, bottom: px.height, left: 0, right: px.width };
  return { top, bottom, left, right };
}

const BUCKETS = 16;
const FLATNESS_EPSILON = 10; // per-bucket-channel average delta below which columns count as "the same"

function columnSignature(px: PixelBuffer, x: number): Float32Array {
  const sig = new Float32Array(BUCKETS * 4);
  const rowsPerBucket = px.height / BUCKETS;
  for (let b = 0; b < BUCKETS; b++) {
    const y0 = Math.floor(b * rowsPerBucket);
    const y1 = Math.floor((b + 1) * rowsPerBucket);
    let r = 0, g = 0, bl = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * px.width + x) * 4;
      r += px.data[i]; g += px.data[i + 1]; bl += px.data[i + 2]; a += px.data[i + 3];
      n++;
    }
    if (n > 0) { r /= n; g /= n; bl /= n; a /= n; }
    sig[b * 4] = r; sig[b * 4 + 1] = g; sig[b * 4 + 2] = bl; sig[b * 4 + 3] = a;
  }
  return sig;
}

function sigDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Auto-guesses the two slice handles by scanning for the widest run of horizontally-constant
 * pixel columns -- i.e. the flattest stretch of the artwork, which is safe to stretch without
 * distorting anything (an end cap, a decorative mark, anything with actual shape, is NOT flat
 * and won't be picked). Falls back to a 25%/75% split if the artwork has no flat run at all
 * (e.g. it's a gradient or noisy texture end to end).
 */
export function autoGuessSlices(px: PixelBuffer): SliceHandles {
  // Restrict the search to the artwork's real horizontal extent -- fully transparent margins
  // outside the art would otherwise look like one giant "flat" run.
  let contentLeft = -1, contentRight = -1;
  for (let x = 0; x < px.width; x++) {
    let hasAlpha = false;
    for (let y = 0; y < px.height; y += Math.max(1, Math.floor(px.height / 20))) {
      if (px.data[(y * px.width + x) * 4 + 3] > 10) { hasAlpha = true; break; }
    }
    if (hasAlpha) { if (contentLeft === -1) contentLeft = x; contentRight = x; }
  }
  if (contentLeft === -1) return { leftX: Math.floor(px.width * 0.25), rightX: Math.floor(px.width * 0.75) };

  const signatures: Float32Array[] = [];
  for (let x = contentLeft; x <= contentRight; x++) signatures.push(columnSignature(px, x));

  // A run is "flat" only if every column in it stays close to the run's OWN starting column --
  // comparing just adjacent columns misses slow cumulative drift (a smooth gradient has a tiny
  // step between neighbors but is clearly not flat end to end).
  let bestStart = 0, bestLen = 0;
  let runStart = 0;
  for (let i = 1; i < signatures.length; i++) {
    const stepDiff = sigDiff(signatures[i], signatures[i - 1]);
    const driftDiff = sigDiff(signatures[i], signatures[runStart]);
    if (stepDiff > FLATNESS_EPSILON || driftDiff > FLATNESS_EPSILON * 2) {
      if (i - runStart > bestLen) { bestLen = i - runStart; bestStart = runStart; }
      runStart = i;
    }
  }
  if (signatures.length - runStart > bestLen) { bestLen = signatures.length - runStart; bestStart = runStart; }

  const contentWidth = contentRight - contentLeft;
  if (bestLen < contentWidth * 0.05) {
    // No meaningfully flat region -- fall back to a generic split rather than a near-zero-width middle.
    return { leftX: contentLeft + Math.floor(contentWidth * 0.25), rightX: contentLeft + Math.floor(contentWidth * 0.75) };
  }
  return { leftX: contentLeft + bestStart, rightX: contentLeft + bestStart + bestLen };
}

export interface ImportedArtSpec {
  image: unknown; // CanvasImageSource in the browser, Image/Canvas in @napi-rs/canvas
  width: number; // source pixel dimensions
  height: number;
  slices: SliceHandles;
  textInsetLeft: number; // px, at the art's own native resolution
  textInsetRight: number;
  textBaselineFromTop: number; // px, at the art's own native resolution
}

export interface ImportedBarLayout {
  s: number; // draw scale = barHeight / art.height
  barTop: number;
  barHeight: number;
  leftAttachX: number;
  totalWidth: number;
  textX: number;
  textBaselineY: number;
  textSizePx: number;
}

const MIN_MIDDLE_WIDTH = 40; // px, at the art's own native resolution -- never let the middle invert

/** Same job as computeLayout() in layout.ts, but for imported 9-slice artwork: the two fixed
 *  end-cap slices supply their own padding/width, so text measurement drives the middle slice's
 *  width instead of a hand-specified core width. */
export function computeImportedLayout(
  text: string,
  art: ImportedArtSpec,
  videoWidth: number,
  videoHeight: number,
  measure: GlyphMetricsSource,
  fontFamily: string,
  barHeightAtFullRes = 148.5, // matches spec.BAR_HEIGHT, kept independent so this module has no procedural-bar dependency
): ImportedBarLayout {
  const s = (barHeightAtFullRes * (videoHeight / 1080)) / art.height;
  const barHeight = art.height * s;
  const barTop = 820.5 * (videoHeight / 1080); // matches spec.BAR_TOP scaling

  const textSizePx = 44 * s * (art.height / barHeightAtFullRes); // proportional to the art's own scale
  const textW = measure.measureText(text, fontFamily, textSizePx);

  const leftCapW = art.slices.leftX * s;
  const rightCapW = (art.width - art.slices.rightX) * s;
  const middleW = Math.max(MIN_MIDDLE_WIDTH * s, art.textInsetLeft * s + textW + art.textInsetRight * s);

  const leftAttachX = 96 * (videoWidth / 1920); // reuse the procedural bar's left attach for a consistent starting position

  return {
    s,
    barTop,
    barHeight,
    leftAttachX,
    totalWidth: leftCapW + middleW + rightCapW,
    textX: leftAttachX + leftCapW + art.textInsetLeft * s,
    textBaselineY: barTop + art.textBaselineFromTop * s,
    textSizePx,
  };
}

export function drawImportedBar(
  ctx: DrawCtx,
  layout: ImportedBarLayout,
  art: ImportedArtSpec,
  text: string,
  anim: AnimState = DEFAULT_ANIM,
  fontFamily?: string,
) {
  const widthRatio = growProgressToWidthRatio(anim.growT);
  const drawnWidth = layout.leftAttachX + (layout.totalWidth - layout.leftAttachX) * widthRatio;
  const totalW = drawnWidth - layout.leftAttachX;

  const leftSliceW = art.slices.leftX * layout.s;
  const rightSliceW = (art.width - art.slices.rightX) * layout.s;
  const middleW = Math.max(0, totalW - leftSliceW - rightSliceW);

  ctx.save();
  ctx.globalAlpha = anim.opacity;

  const top = layout.barTop;
  const h = layout.barHeight;
  const x0 = layout.leftAttachX;

  // Left cap -- fixed shape, never stretched.
  ctx.drawImage(art.image, 0, 0, art.slices.leftX, art.height, x0, top, leftSliceW, h);
  // Middle -- the one slice that stretches, carrying whatever the text measured to.
  if (middleW > 0) {
    ctx.drawImage(
      art.image,
      art.slices.leftX, 0, art.slices.rightX - art.slices.leftX, art.height,
      x0 + leftSliceW, top, middleW, h,
    );
  }
  // Right cap -- fixed shape, translated out to wherever the middle ended.
  ctx.drawImage(
    art.image,
    art.slices.rightX, 0, art.width - art.slices.rightX, art.height,
    x0 + leftSliceW + middleW, top, rightSliceW, h,
  );

  ctx.restore();

  // Text is the only live layer on top of imported art (per the "whole background is baked in" design).
  const textLayout = { ...layout, coreWidth: totalW, rightAttachX: x0 + totalW, textX: x0 + leftSliceW + art.textInsetLeft * layout.s };
  drawBarText(ctx, textLayout as any, text, anim, fontFamily, drawnWidth);
}
