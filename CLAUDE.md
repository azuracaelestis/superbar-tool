# CLAUDE.md

Guidance for AI agents (and humans) working in **superbar-tool**. Read this before touching
rendering, geometry, or animation code — this project has non-obvious conventions that exist for
real reasons, and "cleaning them up" without understanding them reintroduces shipped bugs.

---

## What this is

A tool for ViewSonic operators to burn an animated **"super bar"** lower-third (the branded
title bar with the ViewSonic finch marks) onto a video. The operator uploads a clip, types the
title, tunes timing, previews it live in the browser, and exports a new video with the bar
composited in.

This is an **ongoing project**, rolled out one ViewSonic Design System at a time. **ViewSonic
Corporate** is live today. **ViewSonic Education**, **ViewSonic ProAV**, and **ViewSonic Business**
are coming soon — their presets are already wired into the UI but ship disabled until each
division's AE source is mined to the same fidelity (see `src/presets.ts`). The architecture is
built for this: adding a Design System is meant to be filling in its baked artwork and flipping a
flag, not reshaping the engine.

The whole project's north star is **fidelity to the After Effects source**. The procedural bar
is reverse-engineered from `EP4-6.aep` and pixel-calibrated against a shipped reference render
(`Cut25 Super (GPU & Performance Fixes).mp4`). "Looks about right" is not the bar; "matches the
reference render" is. When in doubt, compare against the reference, don't eyeball.

---

## Commands

```bash
npm run dev         # Vite dev server — the browser preview UI (src/)
npm run server      # Express API on Node — upload, render, ffmpeg export (server/)
npm run dev:all     # both together (web + api), color-tagged
npm run build       # production build of the web UI
npm run verify:still # render one frame and diff it against the reference PNG (scripts/)
```

There is no unit-test runner. Verification is **visual**: the `scripts/verify-*.ts` files render
frames with `@napi-rs/canvas` and either dump PNGs for eyeballing or diff against a reference.
Treat these as the test suite — if you change geometry or animation, render and look.

### Fonts (required for correct output)

Rendering needs the real brand font installed locally; the server and browser both resolve it
from the operator's font folder, mirroring how AE resolves it (no bundling):

- `Gotham-Bold.otf` — the ViewSonic brand font (all titles). ViewSonic branding is Gotham-only.

Default lookup dir is `~/Library/Fonts`; override with the `SUPERBAR_FONT_DIR` env var. If the font
is missing the code degrades gracefully (falls back), but measurements and output **will not match
the reference** — so a fidelity check on a machine without Gotham is meaningless.

---

## Architecture: one brain, two front-ends

The single most important rule: **`shared/` is the source of truth for both the browser preview
and the server-side export.** They import the exact same layout, animation, and draw code so a
frame previewed in the browser is the same frame that gets exported. Never fork rendering logic
into `src/` or `server/` — if preview and export drift, the tool is lying to the operator.

```
shared/            <-- render/layout/animation engine (browser + node both import this)
  spec.ts          <-- ALL calibrated constants (comp-space geometry, colors, timing, finch paths)
  layout.ts        <-- auto-width solver: text measurement -> bar geometry (procedural bar)
  draw.ts          <-- procedural bar renderer + DrawCtx interface + finch marks + shared text
  ninegrid.ts      <-- imported-artwork (9-slice) bar renderer + slice auto-detection
  animate.ts       <-- the timeline: sampleBar(t) -> AnimState (staged reveal, easings)
  importedArt.ts   <-- wire format for a browser-imported baked background (browser -> server)

src/               <-- React preview UI (Vite). Draws to a <canvas> via shared/draw.ts each frame
  App.tsx          <-- main app: upload, controls, live preview loop
  Timeline.tsx     <-- timing scrubber
  presets.ts       <-- brand Design System registry (Corporate is live; others are placeholders)
  import/          <-- artwork import flow (crop, slice editor, PDF layer extraction)

server/            <-- Node/Express export pipeline
  index.ts         <-- API: /api/upload, /api/export (+ SSE job progress), /fonts/:name
  render.ts        <-- renders the transparent PNG frame sequence via shared/ + @napi-rs/canvas
  ffmpeg.ts        <-- probes the source video, muxes frames over it (ffmpeg-static)

scripts/           <-- visual verification harnesses (the de-facto test suite)
```

### Render flow (export)

1. `probeVideo()` reads the source width/height/fps (`ffmpeg.ts`).
2. For each bar's visible window, `renderBarFrames()` (`render.ts`) samples the animation with
   `sampleBar(t)` and draws each frame with `drawSuperBar()` (procedural) **or**
   `drawImportedBar()` (9-slice), producing transparent PNGs.
3. `exportVideo()` composites that PNG sequence over the source video with ffmpeg.

The browser preview runs the same `sampleBar` → `drawSuperBar`/`drawImportedBar` loop against a
`<canvas>`, just without the ffmpeg muxing step.

### Alpha-template export (no source video)

`exportAlphaTemplate()` (`server/ffmpeg.ts`), a sibling to `exportVideo()`, exports the bar as a
**standalone transparent template** for a video editor to drag onto their own Premiere timeline as
an overlay — no uploaded video involved at all. It's reached via `POST /api/export` with
`mode: 'alpha'` (default `mode` is `'burned'`, today's existing behavior, unchanged); alpha mode
supports exactly one bar per export and ignores `uploadId` entirely.

It reuses `renderBarFrames()` verbatim (no fork) and encodes the resulting PNG sequence directly —
no `probeVideo`, no overlay filter, no audio map, since there's no base video to composite onto.
Contract:

- **ProRes 4444 in a `.mov`** (`-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le`), tagged
  `bt709`. Confirmed against the bundled `ffmpeg-static` binary: `prores_ks` supports
  `yuva444p10le` with a 16-bit alpha plane by default; the encoded bitstream reports as
  `yuva444p12le` (ProRes 4444's native 12-bit precision — this is correct, not a mismatch with the
  10-bit input pixel format requested).
- **Straight (non-premultiplied) alpha.** PNG has no premultiplied-alpha mode, so every frame
  `renderBarFrames()` writes is already straight alpha — nothing in this path composites those
  frames over a black/matte background before encoding, so that property survives to the encoded
  file untouched. This matters concretely: premultiplying against black would darken every
  semi-transparent edge pixel (anti-aliased strokes, the finch marks' rounded corners) into a
  visible black fringe once the file is dropped over bright footage. Verified directly by sampling
  edge pixels at varying alpha in an exported frame — RGB stays constant (e.g. the little bird's
  `~(250,213,117)` edge pixels read the same color at `alpha=42` as at `alpha=225`) instead of
  darkening toward black as alpha drops.
- **fps** must be one of `ALLOWED_ALPHA_FPS` (`23.976, 24, 25, 29.97, 30, 50, 59.94, 60`) — an
  explicit allowlist so a typo'd fps fails loudly rather than producing a file with an unexpected
  frame count.
- **`speed`** (optional, on the `/api/export` request, applies to **both** modes): a tempo
  multiplier clamped to `[0.5, 2.0]`. Maps to `inDurationSec = REF_IN / speed`,
  `outDurationSec = REF_OUT / speed`, where `REF_IN`/`REF_OUT` are `defaultBar`'s own stock values
  (`0.6`/`0.4`) reused directly rather than duplicated as separate constants. This **overrides**
  whatever `inDurationSec`/`outDurationSec` a bar payload separately requested — an explicit
  `speed` is authoritative, not just a fallback default. `holdSec` and the easings are untouched;
  `sampleBar` (`shared/animate.ts`) normalizes elapsed time to `[0,1]` before easing, so scaling
  these two durations changes tempo only, never the reveal *shape*.

Verify with `scripts/test-alpha-export.ts` (direct-call harness, matches the `test-export.ts`
pattern) — `ffprobe` the output for `profile=4444`/`codec_tag_string=ap4h`, and actually drop the
sample onto bright footage in Premiere to eyeball edge fringing before trusting a change here.

Out of scope for now, on purpose: multi-bar alpha compositing (several templates layered), a UI
mode picker. CSV-driven batch generation is covered next.

### CSV/Excel-driven batch alpha export

`POST /api/export-batch` (`server/index.ts`) generates one standalone alpha-template `.mov` per
input string — for a video auditor with a spreadsheet of product/title names who wants one file
per row without retyping each name into the editor. Alpha-only: no `uploadId`, no source video,
same as `exportAlphaTemplate` above. Body: `{ texts: string[], speed?, width?, height?, fps? }`.

- **`exportAlphaBatch()`** (`server/ffmpeg.ts`) loops `exportAlphaTemplate` once per string,
  **sequentially** (not in parallel, to bound concurrent ffmpeg processes and keep `onProgress` a
  meaningful "N of M rows done"), then zips the results with the system `zip` binary
  (`execFileSync('zip', ['-j', '-q', ...])` — no new npm dependency; this tool already only ships
  for a local Mac team via `start.command`, and `/usr/bin/zip` is standard there). Capped at
  `MAX_BATCH_ROWS = 200` — a guardrail against an oversized spreadsheet spawning hundreds of ffmpeg
  processes, not a real expected ceiling.
- **File naming**: each row becomes `NNN-slug.mov` (e.g. row 3 "GPU & Performance Fixes" →
  `003-gpu-performance-fixes.mov`) — the index prefix keeps the zip listing sorted/stable even with
  duplicate or blank names; the slug keeps it human-identifiable, which is the actual point for an
  auditor matching files back to spreadsheet rows.
- **`shared/csv.ts`** parses the uploaded `.csv` client-side (browser reads the file as text, no
  server-side CSV parsing): a small RFC4180-ish parser handling Excel's `"..."`-quoted fields
  (embedded commas/quotes/newlines), then `extractTextColumn()` reads a `text`/`name`/`title`/
  `label` header column if row 0 has one, otherwise treats every row (including row 0) as data and
  reads column 0. Blank rows/cells are skipped.
- **`speed`** is the same knob as above (`applySpeed()` in `server/ffmpeg.ts`, now shared by both
  `/api/export` and `exportAlphaBatch` rather than duplicated) — one clamp definition either path
  can't drift out of sync on.
- **UI**: `src/CsvBatch.tsx`, mounted unconditionally in `App.tsx`'s sidebar (no uploaded video
  required) — file input, a row-count/preview list, a speed slider, and the same progress-bar/
  download-link pattern as the main export panel (reuses the existing `Job`/SSE plumbing and the
  `/api/export/:jobId/progress`+`/download` routes as-is; a `.zip` output path flows through the
  download route's existing extension-based `Content-Disposition` with no route change needed).

Verify with `scripts/test-csv-batch.ts` (direct-call harness: parses a sample CSV with a quoted
comma and a CJK entry, then calls `exportAlphaBatch` directly) — `unzip -l` the result to confirm
the `NNN-slug.mov` naming, and `ffprobe` an extracted entry to confirm it's still ProRes
4444/`yuva444p10le`.

Out of scope for now, on purpose: batch-generating *burned-in* video variants (same uploaded video,
each row's name composited at the same in-point) — a plausible future extension, but needs a shared
`uploadId` and timing model across rows, which this phase doesn't touch.

---

## The two background renderers

There are **two ways** a bar background gets drawn, and they share the text layer so text timing
and placement can never drift between them:

- **Procedural bar** — `drawSuperBar()` in `draw.ts`, driven by the calibrated constants in
  `spec.ts`. This is the real, reference-matched ViewSonic Corporate bar. It traces the bar
  silhouette (diagonal left cap, stretchable middle, rounded right cap) and paints the finch marks.
- **Imported 9-slice bar** — `drawImportedBar()` in `ninegrid.ts`, for when a division's baked
  artwork is imported. The background is a pre-rasterized PNG sliced into fixed caps + a stretchable
  middle; only the text is drawn live on top.

Both call the shared `drawBarText()`. The active Design System `preset` decides which path runs:
absent `art` → procedural; present `art` → 9-slice (`src/presets.ts`). Corporate is live; Education,
Business, and ProAV are wired but disabled until their `.aep` files are mined to the same fidelity.

**When you change text behavior, verify it in BOTH paths.** They pass slightly different things to
`drawBarText` (see the text-reveal note below).

---

## Core conventions (do not violate casually)

### 1. Everything is comp-space (1920×1080), scaled by `s`

All geometry constants in `spec.ts` are in **1920×1080 comp coordinates**. Draw code multiplies by
`s = videoHeight / 1080` at render time. **Never hardcode device pixels** and never bake a specific
output resolution into a constant. A value that isn't multiplied by `s` somewhere is almost
certainly a bug.

### 2. `DrawCtx` is a deliberately minimal shared surface

`draw.ts` defines `DrawCtx` as a structural subset of the canvas API that **both** the browser's
`CanvasRenderingContext2D` and `@napi-rs/canvas`'s context implement identically. This is what keeps
preview and export pixel-identical. Before adding a method to `DrawCtx`:

- Confirm both runtimes implement it the same way.
- Add the **smallest** thing that works (e.g. we build clip rectangles from `beginPath`/`lineTo`
  rather than adding a `rect()` method).

Keep the surface small on purpose.

### 3. `spec.ts` constants are measured, not invented

The numbers in `spec.ts` come from mining the AE file and pixel-fitting the reference render (circle
fits, `atan2` sweep angles, measured text widths, layer offsets). Do **not** tweak them to taste. If
one must change, re-measure against the reference and update the comment explaining the derivation.
The comments encode *why* a value is what it is — they are load-bearing, not decoration.

### 4. Sign / pivot / scale conventions on the finch marks

`drawFinchMark()` places a mark by hand-transforming its vector path (not `ctx.rotate/scale`) to stay
within the minimal `DrawCtx` surface. Watch these:

- **Screen space is y-down.** Positive rotation = **clockwise**.
- **Rotation** happens about `pivotOffset` (in the path's own local units), **not** the shape's
  center. The little (yellow) bird hinges at its **bottom** (`LITTLE_BIRD_ROTATION_PIVOT_OFFSET`),
  and enters rotated **counter-clockwise** (negative angle) then unwinds to rest. A positive angle
  mirrors the swing and reads as hinging from the wrong side — this was a real shipped bug; the
  sign is intentionally negative, don't "fix" it back.
- **Scale** is applied after rotation and, at rest, scales about the shape's bbox center. The yellow
  bird scales in from a point (`littleBirdT`, small→full) in lockstep with its translate + rotation —
  it does **not** enter at full size. The red bird likewise scales in from a point at its center.
- **Layer order:** yellow is drawn first, red paints over it (matches the AE layer stack).

### 5. Text reveals with the bar, and is clipped to the bar's true silhouette

The title must appear **together with** the white background, not ahead of it. `drawBarText` no
longer cross-fades on its own timer (that let it show full-width while the bar was still a stub).
Instead:

- **Procedural bar:** `drawSuperBar` clips the text to the **actual bar silhouette** (`tracePath` at
  the current `widthRatio`) before drawing it, so the title is revealed by the bar's own width-wipe —
  cap included. Do **not** clip to a vertical line at the attach point: the text intentionally runs
  slightly past that vertex (`TEXT_RIGHT_PAD` is negative) into the rounded right cap, so a straight
  clip shears off the final letter.
- **Imported 9-slice bar:** passes `revealRightX = drawnWidth` (the grown right edge, past the caps)
  into `drawBarText`, which clips to it. Text is inset there, so it never overhangs.

If you touch the reveal, re-check the tail of the longest title at full width in **both** paths.

### 6. Animation is one scalar timeline

`animate.ts` owns time. `sampleBar(bar, t)` returns an `AnimState` (`growT`, `opacity`, `redBirdT`,
`littleBirdT`); draw code is a pure function of that state. The reveal is **staged and ordered**:
red bird scales in → little bird scales/translates/rotates in → bar grows + text reveals; the out
phase mirrors it in reverse. Adjust ordering/fractions via the `REVEAL_*` constants in `spec.ts` —
don't fork the sequencing logic in `sampleBar`.

---

## Gotchas

- **Preview ≠ export drift** is the worst failure mode. If a change lives in `src/` or `server/`
  instead of `shared/`, ask why. Rendering logic belongs in `shared/`.
- **Font missing** → silent fallback → measurements wrong → fidelity check invalid. Verify with the
  real fonts installed.
- **Gotham-only branding.** The current code still has a CJK font-switch (a regex selecting a
  `GenJyuuGothic-Bold` fallback) in both `render.ts` and `App.tsx` — a leftover, not brand-approved.
  Per brand, all titles render in Gotham. That fallback path should be removed from both files; until
  it is, keep the two in sync so behavior doesn't diverge between preview and export.
- **`express.json` limit is raised to 25mb** on purpose: a 4×-rasterized imported background as a
  base64 data URL easily exceeds the default 100kb.
- **`@napi-rs/canvas` and browser canvas must agree.** Anything that renders differently between them
  breaks the whole preview-equals-export guarantee. When adding drawing ops, prefer ones you've
  confirmed match.
- The `scripts/verify-*.ts` files contain **absolute scratch paths** from when they were written.
  They're harnesses, not part of the build — repoint the paths locally when you use them.

---

## Direction (not yet built — guardrails, not features)

Planned, **not** implemented. Do not treat anything below as current behavior, and don't scaffold
UI or API surface for it speculatively. It's here so that when this work *does* start, it builds on
the right seams instead of fighting them — the point is what to preserve, not a spec to build from.
Detailed specs (exact UI, exact payload shape) belong in a design doc / issue when the work starts,
not here.

- **Multiple bars per video (timeline).** One video often covers several products, each wanting its
  own bar at its own moment. The render/export core is **already multi-bar**: `exportVideo` takes
  `bars: BarInstance[]` and chains one time-gated ffmpeg overlay per bar (`server/ffmpeg.ts`). The
  single-bar limit lives only in the `/api/export` payload shape (`server/index.ts`, which flattens
  to one `text`/`inSec`/`holdSec`) and the single `bar` state in `App.tsx`. So this is primarily a
  **timeline UI + API-shape** project, not an engine rewrite.
  **Guardrail:** keep the model plural end to end as this gets built — don't add new single-bar
  assumptions anywhere in the stack. **Open question the engine permits but the UI must decide:**
  whether two bars' visible windows may overlap on screen at once (stacked lanes) or must be
  mutually exclusive (single lane, prevent overlap) — resolve this before designing the timeline UI,
  since it decides the whole interaction model.

- **Name bar variant (two lines of copy).** Same logic as the super bar — same auto-width solver,
  animation timeline, and finch marks — but a two-line text block instead of one.
  **Guardrail:** treat it as a bar *variant*, not a new engine. When it's built, add a
  `kind`/variant discriminator (and a second text line) to `BarInstance`; branch the text layout,
  not the reveal/geometry pipeline in `animate.ts` or the finch-mark drawing in `draw.ts`. The
  fidelity rule in this file still applies to it: two-line metrics (line height, vertical centering,
  any resulting bar-height change) get measured against an AE reference render, not eyeballed —
  grab that reference early, before writing layout code.



- Match the existing comment density. Non-obvious geometry and every calibrated constant carries a
  comment explaining its derivation and any sign/pivot convention. Preserve and update these; a
  future agent will re-break the code without them.
- Prefer the **smallest diff** that fixes the actual cause. This codebase was built by isolating one
  fidelity bug at a time and fixing it precisely.
- When you change anything visual, **render it and compare to the reference** before calling it done.
  Describe the change as intent ("the mark now hinges from the bottom edge"), not just as a bug fix —
  it helps the next reader see what the correct behavior is.
