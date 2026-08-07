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

// --- Left cap: a straight diagonal cut, not a curve -------------------------------------
// Fixed shape, relative to its own top-left attach vertex (0,0) = (xL_top, BAR_TOP).
// The whole bar's top-left vertex sits at LEFT_ATTACH_X; the diagonal runs down-and-right
// to the bottom-left vertex.
export const LEFT_ATTACH_X = 96;
export const LEFT_CAP_DX = 139.5; // horizontal travel of the diagonal over the full bar height

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
export const TEXT_RIGHT_PAD = 20; // text end -> right attach-x (the reference text runs almost to the attach point)
export const TEXT_BASELINE_FROM_TOP = 92; // baseline y, relative to BAR_TOP

// CJK fallback chain -- Gotham has no CJK glyphs.
export const FONT_FALLBACK_CHAIN = ['Gotham-Bold', 'GenJyuuGothic-Bold', 'DingTalk Sans'];

// --- Finch marks (approximated geometry; refine later via the artwork-import path) -------
export const RED_BIRD_COLOR = '#DA0025';
export const RED_BIRD_POS = { x: 305, y: 1232 }; // attach position, comp space
export const RED_BIRD_SIZE = { w: 155, h: 107 };

export const LITTLE_BIRD_COLOR = '#F7D35E';
export const LITTLE_BIRD_POS = { x: 299, y: 1240 };
export const LITTLE_BIRD_SIZE = { w: 71, h: 49 };

// --- The animation, per the AEP's own path keyframes on the right-cap attach x -----------
// (right edge stepped -445.95 -> -435.59 -> -343.99 -> +194.11 against a pinned left edge at
// -609.08; i.e. widths 163.13 / 173.49 / 265.08 / 803.19). We reproduce this as a single
// animated scalar -- t=0 opens at the nub width, t=1 reaches the fully computed bar width --
// rather than four duplicated path keyframes across three layers.
export const GROW_NUB_WIDTH = 163;
export const GROW_KEYFRAME_TS = [0, 0.15, 0.55, 1]; // normalized time
export const GROW_KEYFRAME_WIDTHS_RATIO = [163, 173, 265, 803]; // relative shape, scaled to actual barWidth at render time
