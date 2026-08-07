import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar, DEFAULT_ANIM, type MakeLayer } from '../shared/draw.js';

GlobalFonts.registerFromPath(`${homedir()}/Library/Fonts/Gotham-Bold.otf`, 'Gotham-Bold');
GlobalFonts.registerFromPath(`${homedir()}/Library/Fonts/GenJyuuGothic-Bold.otf`, 'GenJyuuGothic-Bold');

const W = 1920, H = 1080;
const STRINGS = [
  'Windows Setup',
  'Confirm Your Refresh Rate',
  'Cables & Connection Fixes',
  '视频显示器驱动程序更新与安装指南',   // Chinese -- exercises the CJK fallback chain
  'This Title Is Deliberately Way Too Long To Fit Inside The Frame Safe Zone At All',
];

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const measure: GlyphMetricsSource = {
  measureText(text, fontFamily, sizePx) {
    ctx.font = `700 ${sizePx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  },
};

const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';

const makeLayer: MakeLayer = (w, h) => {
  const layerCanvas = createCanvas(w, h);
  return { ctx: layerCanvas.getContext('2d') as any, image: layerCanvas };
};

for (const [i, text] of STRINGS.entries()) {
  const isCJK = /[一-鿿]/.test(text);
  const fontFamily = isCJK ? 'GenJyuuGothic-Bold' : 'Gotham-Bold';
  const layout = computeLayout(text, W, H, measure, fontFamily);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  drawSuperBar(ctx as any, layout, text, DEFAULT_ANIM, fontFamily, makeLayer);
  // patch font for CJK since drawSuperBar hardcodes spec.TEXT_FONT_FAMILY -- fine for this check,
  // real integration wires font selection through opts (todo, noted below)
  writeFileSync(`${OUT_DIR}/autowidth-${i}.png`, canvas.toBuffer('image/png'));
  console.log(
    `"${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`.padEnd(46),
    `coreWidth=${layout.coreWidth.toFixed(0).padStart(5)}`,
    `rightAttachX=${layout.rightAttachX.toFixed(0).padStart(5)}`,
    `clamped=${layout.clamped}`,
    `overSafeZone=${layout.overSafeZone}`,
  );
}
