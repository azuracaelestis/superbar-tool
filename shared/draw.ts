import * as spec from './spec.js';
import type { BarLayout } from './layout.js';
import { growProgressToWidthRatio } from './layout.js';

// Structural subset of CanvasRenderingContext2D that both the browser and
// @napi-rs/canvas implement identically -- this is what keeps preview and export in sync.
export interface DrawCtx {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  closePath(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: unknown,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
  measureText(text: string): { width: number };
  fillStyle: string;
  globalAlpha: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
}

/** Builds the bar's closed silhouette path: fixed diagonal left cap, stretchable top/bottom
 *  edges, fixed rounded/tapered right cap -- offset vertically by `yOffset` (used to place the
 *  grey edge layers below the white face, per the AEP's 10.63px layer offset). */
function tracePath(ctx: DrawCtx, layout: BarLayout, widthRatio: number, yOffset: number) {
  const { s, leftAttachX, barTop, barHeight } = layout;
  const rightAttachX = layout.leftAttachX + layout.coreWidth * widthRatio;
  const top = barTop + yOffset;
  const bottom = top + barHeight;

  const leftBottomX = leftAttachX + spec.LEFT_CAP_DX * s;

  // Right cap: a true circular arc, tangent to the top edge at the attach vertex --
  // center sits directly below it by the radius, fitted against the reference render.
  const radius = spec.RIGHT_CAP_RADIUS * s;
  const cx = rightAttachX;
  const cy = top + radius;
  const bottomAngle = Math.acos((cy - bottom) / radius); // angle from straight-down to the bottom edge
  const rightBottomX = cx + radius * Math.sin(bottomAngle);

  ctx.beginPath();
  ctx.moveTo(leftAttachX, top); // top-left vertex
  ctx.lineTo(rightAttachX, top); // straight top edge (this is what grows)
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + bottomAngle, false); // sweep out and down
  ctx.lineTo(leftBottomX, bottom); // straight bottom edge
  ctx.closePath(); // diagonal left cap, back up to the top-left vertex
}

export interface AnimState {
  growT: number; // 0 = nub width, 1 = fully grown; default 1 for a static/held frame
  opacity: number; // overall bar opacity multiplier, for fade in/out; default 1
}

export const DEFAULT_ANIM: AnimState = { growT: 1, opacity: 1 };

export function drawSuperBar(
  ctx: DrawCtx,
  layout: BarLayout,
  text: string,
  anim: AnimState = DEFAULT_ANIM,
  fontFamily: string = spec.TEXT_FONT_FAMILY,
) {
  const { s } = layout;
  const widthRatio = growProgressToWidthRatio(anim.growT);

  ctx.save();
  ctx.globalAlpha = spec.BAR_OPACITY * anim.opacity;

  // Two grey edge layers, offset below the face -- reproduces the AEP's "Gray Super" / "Gray Super 2"
  ctx.fillStyle = spec.EDGE_COLOR;
  tracePath(ctx, layout, widthRatio, spec.EDGE_Y_OFFSET * s);
  ctx.fill();
  tracePath(ctx, layout, widthRatio, spec.EDGE_Y_OFFSET * s);
  ctx.fill();

  // White face on top ("Gray Super 3")
  ctx.fillStyle = spec.FACE_COLOR;
  tracePath(ctx, layout, widthRatio, 0);
  ctx.fill();

  ctx.restore();

  // Finch marks -- approximate geometry, anchored to the bar's left edge (independent of width)
  drawFinchMarks(ctx, layout, anim.opacity);

  drawBarText(ctx, layout, text, anim, fontFamily);
}

/** The text layer alone -- shared between the procedural bar above and the imported-artwork
 *  (9-slice) bar in ninegrid.ts, so text placement/reveal timing can never drift between them. */
export function drawBarText(
  ctx: DrawCtx,
  layout: BarLayout,
  text: string,
  anim: AnimState = DEFAULT_ANIM,
  fontFamily: string = spec.TEXT_FONT_FAMILY,
) {
  // Only draw once the bar has grown past the nub, so it doesn't overflow a narrow bar.
  if (anim.growT <= 0.3) return;
  const textOpacity = Math.min(1, (anim.growT - 0.3) / 0.3) * anim.opacity;
  ctx.save();
  ctx.globalAlpha = textOpacity;
  ctx.fillStyle = spec.TEXT_COLOR;
  ctx.font = `700 ${layout.textSizePx}px ${fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, layout.textX, layout.textBaselineY);
  ctx.restore();
}

function drawFinchMarks(ctx: DrawCtx, layout: BarLayout, opacity: number) {
  const { s } = layout;
  ctx.save();
  ctx.globalAlpha = opacity;

  // Little bird (yellow) -- simple triangle approximation
  ctx.fillStyle = spec.LITTLE_BIRD_COLOR;
  ctx.beginPath();
  const lb = spec.LITTLE_BIRD_POS;
  const lbw = spec.LITTLE_BIRD_SIZE.w * s;
  const lbh = spec.LITTLE_BIRD_SIZE.h * s;
  ctx.moveTo(lb.x * s, lb.y * s - lbh);
  ctx.lineTo(lb.x * s + lbw, lb.y * s);
  ctx.lineTo(lb.x * s, lb.y * s + lbh * 0.3);
  ctx.closePath();
  ctx.fill();

  // Red bird -- simple triangle approximation, layered above/right of the little bird
  ctx.fillStyle = spec.RED_BIRD_COLOR;
  ctx.beginPath();
  const rb = spec.RED_BIRD_POS;
  const rbw = spec.RED_BIRD_SIZE.w * s;
  const rbh = spec.RED_BIRD_SIZE.h * s;
  ctx.moveTo(rb.x * s, rb.y * s - rbh);
  ctx.lineTo(rb.x * s + rbw, rb.y * s);
  ctx.lineTo(rb.x * s, rb.y * s + rbh * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
