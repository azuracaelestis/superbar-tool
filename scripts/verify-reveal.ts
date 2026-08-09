import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar, type MakeLayer } from '../shared/draw.js';
import { sampleBar, defaultBar } from '../shared/animate.js';

GlobalFonts.registerFromPath(`${homedir()}/Library/Fonts/Gotham-Bold.otf`, 'Gotham-Bold');

const W = 1920, H = 1080;
const TEXT = 'GPU & Performance Fixes';
const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const measure: GlyphMetricsSource = {
  measureText(text, fontFamily, sizePx) {
    ctx.font = `700 ${sizePx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  },
};
const layout = computeLayout(TEXT, W, H, measure, 'Gotham-Bold');

const makeLayer: MakeLayer = (w, h) => {
  const layerCanvas = createCanvas(w, h);
  return { ctx: layerCanvas.getContext('2d') as any, image: layerCanvas };
};

const bar = { ...defaultBar('test', TEXT, 0), inDurationSec: 1.2, outDurationSec: 1.2 };

function renderPhase(label: string, ts: number[]) {
  console.log(`--- ${label} ---`);
  for (const [i, t] of ts.entries()) {
    const anim = sampleBar(bar, t);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (anim) drawSuperBar(ctx as any, layout, TEXT, anim, 'Gotham-Bold', makeLayer);
    writeFileSync(`${OUT_DIR}/verify-reveal-${label}-${String(i).padStart(2, '0')}.png`, canvas.toBuffer('image/png'));
    console.log(
      `t=${t.toFixed(3).padStart(6)}`,
      anim
        ? `redBirdT=${anim.redBirdT.toFixed(2)} littleBirdT=${anim.littleBirdT.toFixed(2)} growT=${anim.growT.toFixed(2)} opacity=${anim.opacity.toFixed(2)}`
        : 'null (outside window)',
    );
  }
}

const inTs = Array.from({ length: 16 }, (_, i) => (i / 15) * bar.inDurationSec);
renderPhase('in', inTs);

const holdEnd = bar.inDurationSec + bar.holdSec;
const outTs = Array.from({ length: 16 }, (_, i) => holdEnd + (i / 15) * bar.outDurationSec);
renderPhase('out', outTs);
