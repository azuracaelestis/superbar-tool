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
  clearRect(x: number, y: number, w: number, h: number): void;
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

  // Left cap: a circular arc, fitted directly against the reference render's contour (see
  // spec.ts) rather than assumed tangent -- so the sweep angles are computed from the actual
  // center/radius via atan2, not a fixed acos-from-tangent shortcut like the right cap below.
  const leftRadius = spec.LEFT_CAP_RADIUS * s;
  const leftCx = leftAttachX + spec.LEFT_CAP_CENTER_OFFSET.x * s;
  const leftCy = top + spec.LEFT_CAP_CENTER_OFFSET.y * s;
  const leftTopAngle = Math.atan2(top - leftCy, leftAttachX - leftCx);
  const leftBottomDx = -Math.sqrt(Math.max(0, leftRadius * leftRadius - (bottom - leftCy) ** 2));
  const leftBottomAngle = Math.atan2(bottom - leftCy, leftBottomDx);
  const leftBottomX = leftCx + leftBottomDx;

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
  // sweep the left cap back up from bottom to top -- reverse direction of a top->bottom sweep
  // uses the opposite anticlockwise flag to retrace the same arc, per Canvas2D's arc() convention
  ctx.arc(leftCx, leftCy, leftRadius, leftBottomAngle, leftTopAngle, false);
  ctx.closePath();
}

export interface AnimState {
  growT: number; // 0 = nub width, 1 = fully grown; default 1 for a static/held frame
  opacity: number; // overall bar opacity multiplier, for fade in/out; default 1
}

export const DEFAULT_ANIM: AnimState = { growT: 1, opacity: 1 };

/** A scratch canvas the runtime hands drawSuperBar so the 3-layer background group can be
 *  flattened at full opacity BEFORE `BAR_OPACITY` is applied once to the result -- see the note
 *  above drawBackgroundGroup() for why per-layer alpha blending was wrong. `image` is whatever
 *  `ctx.drawImage()`'s first argument expects on that runtime (an HTMLCanvasElement in the
 *  browser, @napi-rs/canvas's Canvas in Node) -- same "runtime supplies it, shared code treats it
 *  as opaque" pattern shared/ninegrid.ts already uses for imported artwork. */
export interface OffscreenLayer {
  ctx: DrawCtx;
  image: unknown;
}

export type MakeLayer = (width: number, height: number) => OffscreenLayer;

export function drawSuperBar(
  ctx: DrawCtx,
  layout: BarLayout,
  text: string,
  anim: AnimState,
  fontFamily: string,
  makeLayer: MakeLayer,
) {
  drawBackgroundGroup(ctx, layout, anim, makeLayer);

  // Finch marks -- approximate geometry, anchored to the bar's left edge (independent of width)
  drawFinchMarks(ctx, layout, anim.opacity);

  drawBarText(ctx, layout, text, anim, fontFamily);
}

/**
 * Draws the three stacked background layers (two grey edges + white face) and composites them
 * onto `ctx` as ONE flattened group at `BAR_OPACITY`.
 *
 * This used to draw each layer directly onto the main canvas at `globalAlpha = BAR_OPACITY`,
 * which is a different (and wrong) compositing model from the real AE file: in AE, the 90%
 * opacity applies once to the *pre-composited result* of all three stacked layers, not to each
 * layer individually. Per-layer alpha blending meant the two identical-offset grey fills
 * compounded (two passes at 90% alpha compound to ~99%), and that inflated edge then bled through
 * the translucent white face across the whole interior -- measured on a real render: our face came
 * out at ~247 where the reference (and the correct math) gives ~233. Flattening the group at full
 * opacity first and applying `BAR_OPACITY` once to the flattened result matches AE exactly: the
 * grey layers are now only visible where the offset leaves them poking out past the face's own
 * silhouette, not bleeding through it.
 */
function drawBackgroundGroup(ctx: DrawCtx, layout: BarLayout, anim: AnimState, makeLayer: MakeLayer) {
  const { s } = layout;
  const widthRatio = growProgressToWidthRatio(anim.growT);
  const rightAttachX = layout.leftAttachX + layout.coreWidth * widthRatio;

  const groupLeft = layout.leftAttachX;
  const groupTop = layout.barTop;
  const groupWidth = Math.ceil(rightAttachX + spec.RIGHT_CAP_BULGE_DX * s - groupLeft);
  const groupHeight = Math.ceil(layout.barHeight + spec.EDGE_Y_OFFSET * s);

  const layer = makeLayer(groupWidth, groupHeight);
  const localLayout: BarLayout = { ...layout, leftAttachX: 0, barTop: 0 };

  layer.ctx.clearRect(0, 0, groupWidth, groupHeight);

  // Two grey edge layers, offset below the face -- reproduces the AEP's "Gray Super" / "Gray Super 2"
  layer.ctx.fillStyle = spec.EDGE_COLOR;
  tracePath(layer.ctx, localLayout, widthRatio, spec.EDGE_Y_OFFSET * s);
  layer.ctx.fill();
  tracePath(layer.ctx, localLayout, widthRatio, spec.EDGE_Y_OFFSET * s);
  layer.ctx.fill();

  // White face on top ("Gray Super 3")
  layer.ctx.fillStyle = spec.FACE_COLOR;
  tracePath(layer.ctx, localLayout, widthRatio, 0);
  layer.ctx.fill();

  ctx.save();
  ctx.globalAlpha = spec.BAR_OPACITY * anim.opacity;
  ctx.drawImage(layer.image, 0, 0, groupWidth, groupHeight, groupLeft, groupTop, groupWidth, groupHeight);
  ctx.restore();
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

/** Draws one finch mark as a 4-point lens/kite polygon, traced from the reference render's own
 *  per-row width profile (see spec.ts) rather than a plain 3-point triangle. `centerOffset` is
 *  relative to the bar's own attach point (leftAttachX, barTop); `vertices` are relative to the
 *  mark's own center, both in comp-space, scaled by `s` here. */
function drawFinchMark(
  ctx: DrawCtx,
  layout: BarLayout,
  centerOffset: { x: number; y: number },
  vertices: { x: number; y: number }[],
) {
  const { s, leftAttachX, barTop } = layout;
  const cx = leftAttachX + centerOffset.x * s;
  const cy = barTop + centerOffset.y * s;
  ctx.beginPath();
  vertices.forEach((v, i) => {
    const x = cx + v.x * s;
    const y = cy + v.y * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawFinchMarks(ctx: DrawCtx, layout: BarLayout, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;

  // Little bird (yellow) -- drawn first, so Red Bird (topmost in the real AE layer stack)
  // correctly paints over most of it, leaving just a sliver visible -- matching the real
  // composition rather than fully hiding it.
  ctx.fillStyle = spec.LITTLE_BIRD_COLOR;
  drawFinchMark(ctx, layout, spec.LITTLE_BIRD_CENTER_OFFSET, spec.LITTLE_BIRD_VERTICES);

  // Red bird -- on top, per the AEP's own layer order.
  ctx.fillStyle = spec.RED_BIRD_COLOR;
  drawFinchMark(ctx, layout, spec.RED_BIRD_CENTER_OFFSET, spec.RED_BIRD_VERTICES);

  ctx.restore();
}
