// Extracted from Downloads/EP4-6.aep (comp "EP6 Cut25" + parent "Cut25 Super (GPU & Performance Fixes)")
// and cross-checked by pixel-measuring the shipped reference render
// "Cut25 Super (GPU & Performance Fixes).mp4" (1280x720, scale = 1280/1920 = 0.6667).
// All coordinates below are in 1920x1080 comp space; draw code scales by `s = videoHeight / 1080`.

export const COMP_WIDTH = 1920;
export const COMP_HEIGHT = 1080;

// --- Bar vertical extent -----------------------------------------------------------------
export const BAR_TOP = 820.5;
export const BAR_HEIGHT = 148.5;
export const BAR_BOTTOM = BAR_TOP + BAR_HEIGHT;

// --- Left cap: a circular arc, NOT a straight diagonal -----------------------------------
// An earlier pass called this "a straight diagonal cut," but that description came from
// eyeballing just the two contour endpoints, not fitting the trajectory between them. Refit
// directly against the reference render's row contour: a circle fits with RMSE 0.31px (720p
// scale) -- as clean a fit as the right cap's own arc. Center offset and radius below are in
// comp-space (x1.5 from the 720p fit), relative to the top-left attach vertex (LEFT_ATTACH_X,
// BAR_TOP). Unlike the right cap, this circle is not exactly tangent to the top edge at the
// attach point (small residual), so draw.ts computes the sweep angles from the actual
// center/radius via atan2 rather than assuming a right-angle tangency relationship.
export const LEFT_ATTACH_X = 96;
export const LEFT_CAP_RADIUS = 163.9;
export const LEFT_CAP_CENTER_OFFSET = { x: 164.4, y: -12.0 };

// --- Right cap: a true circular arc, not a bezier bulge ---------------------------------
// Fitted (Kasa least-squares circle fit) directly against the reference render's contour --
// the arc is tangent to the top edge exactly at the attach vertex (center sits R directly
// below it), which is why it reads as a clean quarter-circle-ish sweep rather than a blob.
// Fixed shape, relative to its own top-right attach vertex (0,0) = (xR_top, BAR_TOP).
// xR_top is NOT fixed -- it is barCoreRight, the one value the text measurement drives.
export const RIGHT_CAP_RADIUS = 211.5;
// Max horizontal extent (used only for the safe-zone check), matching where the arc
// crosses the bar's bottom edge.
export const RIGHT_CAP_BULGE_DX = 205;

// --- Minimum core width (left attach -> right attach), so tiny text never looks broken ---
export const MIN_CORE_WIDTH = 400;

// --- Fill colors + composite opacity (from AEP: Gray Super 3 / 2 / (unnamed) precomp) ----
export const FACE_COLOR = '#FFFFFF'; // "Gray Super 3"
export const EDGE_COLOR = '#B2B2B2'; // "Gray Super 2" and "Gray Super"
export const BAR_OPACITY = 0.9;
export const EDGE_Y_OFFSET = 10.63; // grey layers sit this far below the white face

// --- Text ---------------------------------------------------------------------------------
export const TEXT_COLOR = '#404041';
export const TEXT_FONT_FAMILY = 'Gotham-Bold';
export const TEXT_SIZE = 53; // pt at 1920x1080; calibrated against the reference render's measured 456px-wide text
export const TEXT_LEFT_PAD = 185; // attach-x -> text start
// text end -> right attach-x. The true measured value is slightly NEGATIVE (the reference
// text's own right edge already runs ~8px (720p) past the attach point, since the cap's arc
// keeps bulging outward past it anyway) -- an earlier pass rounded that up to a "safe" +20,
// which was actually a real ~21px (comp-space -12 vs +20) width-overshoot bug, confirmed by
// re-measuring the reference's own core width (571px @ 720p) against ours (592.7px) for
// identical text.
export const TEXT_RIGHT_PAD = -12;
export const TEXT_BASELINE_FROM_TOP = 92; // baseline y, relative to BAR_TOP

// CJK fallback chain -- Gotham has no CJK glyphs.
export const FONT_FALLBACK_CHAIN = ['Gotham-Bold', 'GenJyuuGothic-Bold', 'DingTalk Sans'];

// --- Finch marks -------------------------------------------------------------------------
// A previous pass derived these from the AEP's own position/anchor math (comp-native
// 1920x1080, no extra scaling) -- correct in principle, but it still left both marks ~35-50px
// off from where the real reference render actually shows them, and drew each as a plain
// 3-point triangle when the reference shows a tapered, rotated lens/kite shape (width rises,
// plateaus, then falls -- not a monotonic triangle). Both are now measured directly from the
// reference render's pixels instead: a per-row width-profile scan of each mark, isolating red
// (R >> G,B) and yellow (R,G >> B) pixels, gives real bounding boxes and four corner points
// (top / right-bulge / bottom / left-bulge) that are point-symmetric about the mark's own
// center. Both centers, conveniently, land on clean relationships to the bar's own anchors:
// Red Bird's bbox-center sits exactly on BAR_TOP; Little Bird's is a fixed offset from
// (LEFT_ATTACH_X, BAR_TOP). Offsets and vertices are in comp-space (x1.5 from the 720p
// measurement, matching the bar geometry's own convention), relative to the bar's attach point.
export const RED_BIRD_COLOR = '#DA0025';
export const RED_BIRD_CENTER_OFFSET = { x: 105.75, y: 0 };
export const RED_BIRD_VERTICES = [
  { x: 14.25, y: -43.5 }, // top point
  { x: 65.25, y: -21 }, // right bulge
  { x: -11.25, y: 43.5 }, // bottom point
  { x: -65.25, y: 21 }, // left bulge
];

export const LITTLE_BIRD_COLOR = '#F7D35E';
export const LITTLE_BIRD_CENTER_OFFSET = { x: 32.25, y: -38.25 };
export const LITTLE_BIRD_VERTICES = [
  { x: 6, y: -18.75 },
  { x: 27.75, y: -9 },
  { x: -6, y: 18.75 },
  { x: -27.75, y: 7.5 },
];

// --- The animation, per the AEP's own path keyframes on the right-cap attach x -----------
// (right edge stepped -445.95 -> -435.59 -> -343.99 -> +194.11 against a pinned left edge at
// -609.08; i.e. widths 163.13 / 173.49 / 265.08 / 803.19). We reproduce this as a single
// animated scalar -- t=0 opens at the nub width, t=1 reaches the fully computed bar width --
// rather than four duplicated path keyframes across three layers.
export const GROW_NUB_WIDTH = 163;
export const GROW_KEYFRAME_TS = [0, 0.15, 0.55, 1]; // normalized time
export const GROW_KEYFRAME_WIDTHS_RATIO = [163, 173, 265, 803]; // relative shape, scaled to actual barWidth at render time
