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
// Two prior passes approximated these: first as plain triangles, then as a 4-point lens/kite
// polygon traced from the reference render's pixel width-profile. Both were guesses at a shape
// neither of us had the source for. The user then supplied the actual artwork --
// Desktop/little_bird_red.svg and little_bird_yellow.svg -- so these are now the REAL vector
// paths, not an approximation: each SVG's single <path> was parsed (resolving relative l/c
// commands to absolute), re-centered on its own path bounding box, and pre-scaled so the
// rendered size matches the reference video (see RED_BIRD_SCALE/LITTLE_BIRD_SCALE below --
// tune these, not the path data, if the size needs adjusting). Colors are taken directly from
// the SVGs' fill values.
export type FinchPathCmd =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

export const RED_BIRD_COLOR = '#DB0025';
export const RED_BIRD_CENTER_OFFSET = { x: 105.75, y: 0 };
// native path bbox: 235.50 x 175.83, pre-scaled by 0.56 below (from little_bird_red.svg)
export const RED_BIRD_PATH: FinchPathCmd[] = [
  { op: 'M', x: 65.26, y: -18.83 },
  { op: 'L', x: 11.45, y: 36.11 },
  { op: 'C', x1: 0.85, y1: 46.93, x2: -15.71, y2: 49.23, x: -28.87, y: 41.73 },
  { op: 'L', x: -64.94, y: 21.15 },
  { op: 'C', x1: -65.78, y1: 20.67, x2: -65.94, y2: 19.52, x: -65.26, y: 18.83 },
  { op: 'L', x: -11.45, y: -36.11 },
  { op: 'C', x1: -0.85, y1: -46.93, x2: 15.71, y2: -49.23, x: 28.87, y: -41.73 },
  { op: 'L', x: 64.94, y: -21.15 },
  { op: 'C', x1: 65.78, y1: -20.67, x2: 65.94, y2: -19.52, x: 65.26, y: -18.83 },
  { op: 'Z' },
];

export const LITTLE_BIRD_COLOR = '#F7D87A';
export const LITTLE_BIRD_CENTER_OFFSET = { x: 32.25, y: -38.25 };
// The little bird "jumps in" from behind the red bird: during its reveal sub-window its center
// travels from this start offset (= the red bird's own center, so it begins fully occluded behind
// red) up-and-left to LITTLE_BIRD_CENTER_OFFSET. Measured from the reference render: yellow's
// centroid slides from red's center height to its final resting spot as it emerges from behind red
// (red is drawn on top). It stays full size throughout -- this is a translate, not a scale-in.
export const LITTLE_BIRD_REVEAL_START_OFFSET = { x: 105.75, y: 0 };
// The little bird also enters slightly ROTATED and unwinds to its resting orientation as it
// finishes its jump-in (measured from the reference: its long axis rotates ~22deg over the entry).
// Applied about LITTLE_BIRD_ROTATION_PIVOT_OFFSET (bottom-center, below), eased to 0 by littleBirdT.
// Sign convention: positive = clockwise in screen space (y-down). The reference shows the bird
// entering rotated COUNTER-clockwise (right tip up, hinged at its bottom edge near red) and then
// rotating clockwise down into its resting orientation -- so this MUST be negative. An earlier pass
// had it positive, which mirrored the swing (the bird appeared to hinge from the top / wrong side).
// Tune magnitude here; do not flip the sign back to positive.
export const LITTLE_BIRD_REVEAL_START_ANGLE_RAD = (-22 * Math.PI) / 180;
// Rotation pivots about this point (in the path's own local, path-relative units -- same space
// as LITTLE_BIRD_PATH's coordinates) rather than the shape's center: the reference shows the
// bottom of the shape staying anchored near red's edge while the top swings down into place, a
// hinge at the bottom, not a spin about the middle. First estimate: bottom-center of the local
// bbox (half-height ~21.23, from the path's documented native bbox). Tune against reference.
export const LITTLE_BIRD_ROTATION_PIVOT_OFFSET = { x: 0, y: 21.23 };
// native path bbox: 109.39 x 81.67, pre-scaled by 0.52 below (from little_bird_yellow.svg)
export const LITTLE_BIRD_PATH: FinchPathCmd[] = [
  { op: 'M', x: 28.14, y: -8.12 },
  { op: 'L', x: 4.93, y: 15.57 },
  { op: 'C', x1: 0.36, y1: 20.24, x2: -6.78, y2: 21.23, x: -12.46, y: 17.99 },
  { op: 'L', x: -28.01, y: 9.12 },
  { op: 'C', x1: -28.37, y1: 8.92, x2: -28.44, y2: 8.42, x: -28.15, y: 8.12 },
  { op: 'L', x: -4.94, y: -15.58 },
  { op: 'C', x1: -0.37, y1: -20.24, x2: 6.78, y2: -21.23, x: 12.45, y: -18.0 },
  { op: 'L', x: 28.01, y: -9.12 },
  { op: 'C', x1: 28.37, y1: -8.92, x2: 28.44, y2: -8.42, x: 28.15, y: -8.12 },
  { op: 'Z' },
];

// --- The animation, per the AEP's own path keyframes on the right-cap attach x -----------
// (right edge stepped -445.95 -> -435.59 -> -343.99 -> +194.11 against a pinned left edge at
// -609.08; i.e. widths 163.13 / 173.49 / 265.08 / 803.19). We reproduce this as a single
// animated scalar -- t=0 opens at the nub width, t=1 reaches the fully computed bar width --
// rather than four duplicated path keyframes across three layers.
export const GROW_NUB_WIDTH = 163;
export const GROW_KEYFRAME_TS = [0, 0.15, 0.55, 1]; // normalized time
export const GROW_KEYFRAME_WIDTHS_RATIO = [163, 173, 265, 803]; // relative shape, scaled to actual barWidth at render time

// --- Staged reveal sub-window split of inDurationSec ---------------------------------------
// Ordered, non-overlapping: [red bird scale] -> [little bird scale] -> [bar grow + text fade].
// Fractions of inDurationSec; must sum to <= 1 (remainder goes to the bar/text stage). Chosen
// so each bird stage reads as a distinct beat rather than a blur -- adjust here only, do not
// fork sampleBar's ordering logic.
export const REVEAL_RED_BIRD_FRACTION = 0.25;
export const REVEAL_LITTLE_BIRD_FRACTION = 0.25;
