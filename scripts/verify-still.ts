import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar, DEFAULT_ANIM, type MakeLayer } from '../shared/draw.js';
import * as spec from '../shared/spec.js';

const REF =
  '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad/Cut25 Super (GPU & Performance Fixes.mp4.png';
const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';

GlobalFonts.registerFromPath(`${homedir()}/Library/Fonts/Gotham-Bold.otf`, 'Gotham-Bold');

const W = 1280;
const H = 720;
const TEXT = 'GPU & Performance Fixes';

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const measure: GlyphMetricsSource = {
  measureText(text, fontFamily, sizePx) {
    ctx.font = `700 ${sizePx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  },
};

const layout = computeLayout(TEXT, W, H, measure);
console.log('layout:', layout);

// transparent canvas, matching how this composites over real footage
const makeLayer: MakeLayer = (w, h) => {
  const layerCanvas = createCanvas(w, h);
  return { ctx: layerCanvas.getContext('2d') as any, image: layerCanvas };
};
drawSuperBar(ctx as any, layout, TEXT, DEFAULT_ANIM, spec.TEXT_FONT_FAMILY, makeLayer);

const outPath = `${OUT_DIR}/verify-still.png`;
writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log('wrote', outPath);

// --- diff against the reference render -------------------------------------------------
const refImg = await loadImage(REF);
const refCanvas = createCanvas(refImg.width, refImg.height);
const refCtx = refCanvas.getContext('2d');
refCtx.drawImage(refImg, 0, 0);
const refData = refCtx.getImageData(0, 0, refImg.width, refImg.height).data;
const ourData = ctx.getImageData(0, 0, W, H).data;

// Composite our transparent render over black, to match the reference's black background.
const diffCanvas = createCanvas(W, H);
const diffCtx = diffCanvas.getContext('2d');
diffCtx.fillStyle = '#000000';
diffCtx.fillRect(0, 0, W, H);
diffCtx.drawImage(canvas as any, 0, 0);
const compositedData = diffCtx.getImageData(0, 0, W, H).data;

// Bar region of interest, from the spec's measured bounds (720p pixel space)
const roi = { x0: 40, y0: 540, x1: 780, y1: 655 };
let maxDelta = 0;
let diffPixels = 0;
let totalPixels = 0;
const diffVis = createCanvas(W, H);
const diffVisCtx = diffVis.getContext('2d');
diffVisCtx.drawImage(refImg, 0, 0);

for (let y = roi.y0; y < roi.y1; y++) {
  for (let x = roi.x0; x < roi.x1; x++) {
    const i = (y * W + x) * 4;
    const dr = Math.abs(refData[i] - compositedData[i]);
    const dg = Math.abs(refData[i + 1] - compositedData[i + 1]);
    const db = Math.abs(refData[i + 2] - compositedData[i + 2]);
    const delta = Math.max(dr, dg, db);
    maxDelta = Math.max(maxDelta, delta);
    totalPixels++;
    if (delta > 40) {
      diffPixels++;
      diffVisCtx.fillStyle = 'rgba(255,0,255,0.6)';
      diffVisCtx.fillRect(x, y, 1, 1);
    }
  }
}

writeFileSync(`${OUT_DIR}/verify-diff.png`, diffVis.toBuffer('image/png'));
writeFileSync(`${OUT_DIR}/verify-composited.png`, diffCanvas.toBuffer('image/png'));

console.log('\n=== pixel diff report (bar region) ===');
console.log('max channel delta:', maxDelta);
console.log('differing pixels:', diffPixels, '/', totalPixels, `(${((diffPixels / totalPixels) * 100).toFixed(1)}%)`);
console.log('wrote diff overlay to', `${OUT_DIR}/verify-diff.png`);
console.log('wrote composited render to', `${OUT_DIR}/verify-composited.png`);
