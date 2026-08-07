import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar } from '../shared/draw.js';
import { computeImportedLayout, drawImportedBar, type ImportedArtSpec } from '../shared/ninegrid.js';
import type { ImportedArtPayload } from '../shared/importedArt.js';
import { sampleBar, type BarInstance } from '../shared/animate.js';

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  const fontDir = process.env.SUPERBAR_FONT_DIR || `${homedir()}/Library/Fonts`;
  for (const [file, family] of [
    ['Gotham-Bold.otf', 'Gotham-Bold'],
    ['GenJyuuGothic-Bold.ttf', 'GenJyuuGothic-Bold'],
  ] as const) {
    try {
      GlobalFonts.registerFromPath(`${fontDir}/${file}`, family);
    } catch {
      // missing on this machine -- that string just won't measure/render for this family
    }
  }
  fontsRegistered = true;
}

const CJK_PATTERN = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

function fontFamilyFor(text: string): string {
  return CJK_PATTERN.test(text) ? 'GenJyuuGothic-Bold' : 'Gotham-Bold';
}

async function loadImportedArt(payload: ImportedArtPayload): Promise<ImportedArtSpec> {
  const base64 = payload.dataUrl.slice(payload.dataUrl.indexOf(',') + 1);
  const image = await loadImage(Buffer.from(base64, 'base64'));
  return {
    image,
    width: payload.width,
    height: payload.height,
    slices: payload.slices,
    textInsetLeft: payload.textInsetLeft,
    textInsetRight: payload.textInsetRight,
    textBaselineFromTop: payload.textBaselineFromTop,
  };
}

/** Renders the transparent PNG sequence for one bar's visible window. Returns the frame
 *  file paths and the [startFrame, endFrame] range (inclusive) in the source video's timeline.
 *  If `art` is given, draws the imported 9-slice background instead of the procedural bar --
 *  same auto-width text solver either way, just a different background renderer. */
export async function renderBarFrames(opts: {
  bar: BarInstance;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  outDir: string;
  art?: ImportedArtPayload;
}): Promise<{ framePaths: string[]; startFrame: number; endFrame: number }> {
  ensureFonts();
  mkdirSync(opts.outDir, { recursive: true });

  const canvas = createCanvas(opts.videoWidth, opts.videoHeight);
  const ctx = canvas.getContext('2d');
  const measure: GlyphMetricsSource = {
    measureText(text, fontFamily, sizePx) {
      ctx.font = `700 ${sizePx}px ${fontFamily}`;
      return ctx.measureText(text).width;
    },
  };
  const fontFamily = fontFamilyFor(opts.bar.text);

  const importedArt = opts.art ? await loadImportedArt(opts.art) : null;

  const layout = importedArt
    ? computeImportedLayout(opts.bar.text, importedArt, opts.videoWidth, opts.videoHeight, measure, fontFamily)
    : computeLayout(opts.bar.text, opts.videoWidth, opts.videoHeight, measure, fontFamily);
  if ('overSafeZone' in layout && layout.overSafeZone) {
    console.warn(`[render] bar "${opts.bar.text}" extends past the safe zone at this resolution`);
  }

  const outEnd = opts.bar.inSec + opts.bar.inDurationSec + opts.bar.holdSec + opts.bar.outDurationSec;
  const startFrame = Math.floor(opts.bar.inSec * opts.fps);
  const endFrame = Math.ceil(outEnd * opts.fps);

  const framePaths: string[] = [];
  for (let f = startFrame; f <= endFrame; f++) {
    const t = f / opts.fps;
    const anim = sampleBar(opts.bar, t);
    ctx.clearRect(0, 0, opts.videoWidth, opts.videoHeight);
    if (anim) {
      if (importedArt) {
        drawImportedBar(ctx as any, layout as any, importedArt, opts.bar.text, anim, fontFamily);
      } else {
        drawSuperBar(ctx as any, layout as any, opts.bar.text, anim, fontFamily);
      }
    }
    const framePath = `${opts.outDir}/${opts.bar.id}_${String(f - startFrame).padStart(6, '0')}.png`;
    writeFileSync(framePath, canvas.toBuffer('image/png'));
    framePaths.push(framePath);
  }

  return { framePaths, startFrame, endFrame };
}
