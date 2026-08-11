import { useEffect, useRef, useState } from 'react';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar, type MakeLayer } from '../shared/draw.js';
import { computeImportedLayout, drawImportedBar, type ImportedArtSpec } from '../shared/ninegrid.js';
import { sampleBar, defaultBar, type BarInstance, type EasingName } from '../shared/animate.js';
import { PRESETS } from './presets.js';
import Timeline from './Timeline.js';
import CsvBatch from './CsvBatch.js';

const CJK_PATTERN = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;
const EASINGS: EasingName[] = ['linear', 'easeOut', 'easeInOut', 'easeOutBack'];

let fontsLoaded = false;
async function ensureFonts() {
  if (fontsLoaded) return;
  const gotham = new FontFace('Gotham-Bold', 'url(/fonts/Gotham-Bold.otf)', { weight: '700' });
  const gen = new FontFace('GenJyuuGothic-Bold', 'url(/fonts/GenJyuuGothic-Bold.ttf)', { weight: '700' });
  await Promise.all(
    [gotham, gen].map(async (f) => {
      try {
        await f.load();
        document.fonts.add(f);
      } catch {
        // font missing on this machine -- rendering falls back to the browser default
      }
    }),
  );
  fontsLoaded = true;
}

interface UploadInfo {
  id: string;
  url: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
}

export default function App() {
  const [upload, setUploadState] = useState<UploadInfo | null>(null);
  const [bars, setBars] = useState<BarInstance[]>([defaultBar('bar-1', 'GPU & Performance Fixes', 0.5)]);
  const [selectedBarId, setSelectedBarId] = useState<string>('bar-1');
  const nextIdRef = useRef(2);
  const selectedBar = bars.find((b) => b.id === selectedBarId) ?? null;
  const [format, setFormat] = useState<'mp4' | 'mov' | 'mov-prores'>('mp4');
  const [exportState, setExportState] = useState<{ progress: number; downloadUrl: string | null; error: string | null } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  const [presetId, setPresetId] = useState<(typeof PRESETS)[number]['id']>('corporate');
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const [presetImage, setPresetImage] = useState<HTMLImageElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    ensureFonts().then(() => setFontsReady(true));
  }, []);

  // A preset with baked `art` supplies its own image; the procedural presets (Corporate today)
  // don't need one.
  useEffect(() => {
    if (!preset.art) {
      setPresetImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setPresetImage(img);
    img.src = preset.art.dataUrl;
  }, [preset.art]);

  // Live preview: redraw the bar over the video every frame, synced to playback time.
  useEffect(() => {
    if (!upload || !fontsReady) return;
    let raf = 0;
    const measureCanvas = measureCanvasRef.current ?? document.createElement('canvas');
    measureCanvasRef.current = measureCanvas;
    const measureCtx = measureCanvas.getContext('2d')!;
    const measure: GlyphMetricsSource = {
      measureText(text, fontFamily, sizePx) {
        measureCtx.font = `700 ${sizePx}px ${fontFamily}`;
        return measureCtx.measureText(text).width;
      },
    };

    const makeLayer: MakeLayer = (w, h) => {
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = w;
      layerCanvas.height = h;
      return { ctx: layerCanvas.getContext('2d') as any, image: layerCanvas };
    };

    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d')!;
      canvas.width = upload.width;
      canvas.height = upload.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Bars never overlap in time (enforced by Timeline's drag clamps), so at most one is ever
      // active -- loop and draw whichever one sampleBar returns non-null for, then stop.
      for (const b of bars) {
        const anim = sampleBar(b, video.currentTime);
        if (!anim) continue;
        const fontFamily = CJK_PATTERN.test(b.text) ? 'GenJyuuGothic-Bold' : 'Gotham-Bold';
        if (preset.art && presetImage) {
          const art: ImportedArtSpec = {
            image: presetImage,
            width: preset.art.width,
            height: preset.art.height,
            slices: preset.art.slices,
            textInsetLeft: preset.art.textInsetLeft,
            textInsetRight: preset.art.textInsetRight,
            textBaselineFromTop: preset.art.textBaselineFromTop,
          };
          const layout = computeImportedLayout(b.text, art, upload.width, upload.height, measure, fontFamily);
          drawImportedBar(ctx as any, layout, art, b.text, anim, fontFamily);
        } else {
          const layout = computeLayout(b.text, upload.width, upload.height, measure, fontFamily);
          drawSuperBar(ctx as any, layout, b.text, anim, fontFamily, makeLayer);
        }
        break;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [upload, bars, fontsReady, preset.art, presetImage]);

  async function handleFile(file: File) {
    const form = new FormData();
    form.append('video', file);
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const info = await res.json();
    setUploadState(info);
    setExportState(null);
  }

  async function handleExport() {
    if (!upload || bars.length === 0) return;
    setExportState({ progress: 0, downloadUrl: null, error: null });
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: upload.id,
        bars: bars.map((b) => ({
          id: b.id,
          text: b.text,
          inSec: b.inSec,
          holdSec: b.holdSec,
          inDurationSec: b.inDurationSec,
          outDurationSec: b.outDurationSec,
          easingIn: b.easingIn,
          easingOut: b.easingOut,
        })),
        format,
        art: preset.art,
      }),
    });
    const { jobId } = await res.json();
    const es = new EventSource(`/api/export/${jobId}/progress`);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.error) {
        setExportState({ progress: 0, downloadUrl: null, error: data.error });
        es.close();
      } else if (data.done) {
        setExportState({ progress: 1, downloadUrl: `/api/export/${jobId}/download`, error: null });
        es.close();
      } else {
        setExportState({ progress: data.progress, downloadUrl: null, error: null });
      }
    };
  }

  function patchSelectedBar(patch: Partial<BarInstance>) {
    setBars((bs) => bs.map((b) => (b.id === selectedBarId ? { ...b, ...patch } : b)));
  }

  function patchBar(id: string, patch: Partial<BarInstance>) {
    setBars((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // Always appended after the last (by inSec) existing bar's own end, with a small fixed gap --
  // deterministic and simple, no mid-timeline insertion. Room-check mirrors this so the "+ Add
  // bar" button can be disabled instead of silently no-op'ing when there's nothing to click into.
  const NEW_BAR_GAP_SEC = 0.25;
  function newBarPlacement(): number {
    const sorted = [...bars].sort((a, b) => a.inSec - b.inSec);
    const last = sorted[sorted.length - 1];
    return last ? last.inSec + last.inDurationSec + last.holdSec + last.outDurationSec + NEW_BAR_GAP_SEC : 0;
  }
  const newBarDefaultLength = 0.6 + 4 + 0.4; // matches defaultBar's stock in+hold+out
  const hasRoomForNewBar = !!upload && newBarPlacement() + newBarDefaultLength <= upload.durationSec;

  function addBar() {
    if (!upload || !hasRoomForNewBar) return;
    const id = `bar-${nextIdRef.current++}`;
    const newBar = defaultBar(id, 'New text', newBarPlacement());
    setBars((bs) => [...bs, newBar]);
    setSelectedBarId(id);
  }

  function deleteBar(id: string) {
    setBars((bs) => {
      const next = bs.filter((b) => b.id !== id);
      if (id === selectedBarId) {
        const sorted = [...next].sort((a, b) => a.inSec - b.inSec);
        setSelectedBarId(sorted[0]?.id ?? '');
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 p-6 flex gap-6">
      <div className="flex-1 flex flex-col gap-4">
        {!upload ? (
          <label className="flex-1 flex items-center justify-center border-2 border-dashed border-zinc-600 rounded-xl cursor-pointer hover:border-zinc-400 transition-colors min-h-[400px]">
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <span className="text-zinc-400">Drop a video here, or click to choose one</span>
          </label>
        ) : (
          <>
            <div className="relative bg-black rounded-xl overflow-hidden">
              <video ref={videoRef} src={upload.url} controls className="w-full block" />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            </div>
            <Timeline
              durationSec={upload.durationSec}
              videoRef={videoRef}
              bars={bars}
              selectedBarId={selectedBarId}
              onSelectBar={setSelectedBarId}
              onScrub={(t) => {
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              onChangeBar={patchBar}
            />
          </>
        )}
      </div>

      <div className="w-80 flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Super Bar Tool</h1>

        <div className="flex flex-col gap-1 text-sm">
          Design System
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                disabled={!p.enabled}
                onClick={() => setPresetId(p.id)}
                className={`rounded px-2 py-1.5 text-sm text-left ${
                  !p.enabled
                    ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                    : presetId === p.id
                      ? 'bg-indigo-600'
                      : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {p.label}
                {!p.enabled && <div className="text-xs text-zinc-500">Coming soon</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span>Super bars ({bars.length})</span>
          <div className="flex gap-2">
            <button
              disabled={!upload || !hasRoomForNewBar}
              onClick={addBar}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:text-zinc-500 disabled:cursor-not-allowed rounded px-2 py-1"
            >
              + Add bar
            </button>
            <button
              disabled={!selectedBar}
              onClick={() => selectedBar && deleteBar(selectedBar.id)}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:text-zinc-500 disabled:cursor-not-allowed rounded px-2 py-1"
            >
              Delete
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Text
          <input
            className="bg-zinc-800 rounded px-2 py-1 disabled:opacity-50"
            disabled={!selectedBar}
            value={selectedBar?.text ?? ''}
            onChange={(e) => patchSelectedBar({ text: e.target.value })}
          />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-col gap-1 text-sm flex-1">
            In duration (s)
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              disabled={!selectedBar}
              value={selectedBar?.inDurationSec ?? 0}
              onChange={(e) => patchSelectedBar({ inDurationSec: Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-400">{(selectedBar?.inDurationSec ?? 0).toFixed(2)}s</span>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Out duration (s)
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              disabled={!selectedBar}
              value={selectedBar?.outDurationSec ?? 0}
              onChange={(e) => patchSelectedBar({ outDurationSec: Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-400">{(selectedBar?.outDurationSec ?? 0).toFixed(2)}s</span>
          </label>
        </div>

        <div className="flex gap-2">
          <label className="flex flex-col gap-1 text-sm flex-1">
            Ease in
            <select
              className="bg-zinc-800 rounded px-2 py-1 disabled:opacity-50"
              disabled={!selectedBar}
              value={selectedBar?.easingIn ?? 'easeOut'}
              onChange={(e) => patchSelectedBar({ easingIn: e.target.value as EasingName })}
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Ease out
            <select
              className="bg-zinc-800 rounded px-2 py-1 disabled:opacity-50"
              disabled={!selectedBar}
              value={selectedBar?.easingOut ?? 'easeOut'}
              onChange={(e) => patchSelectedBar({ easingOut: e.target.value as EasingName })}
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Format
          <select
            className="bg-zinc-800 rounded px-2 py-1"
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="mp4">MP4 (H.264)</option>
            <option value="mov">MOV (H.264)</option>
            <option value="mov-prores">MOV (ProRes 422 HQ)</option>
          </select>
        </label>

        <button
          disabled={!upload || bars.length === 0}
          onClick={handleExport}
          className="mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded px-3 py-2 font-medium"
        >
          Export
        </button>

        {exportState && (
          <div className="text-sm">
            {exportState.error ? (
              <span className="text-red-400">{exportState.error}</span>
            ) : exportState.downloadUrl ? (
              <a href={exportState.downloadUrl} className="text-indigo-400 underline">
                Download export
              </a>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${exportState.progress * 100}%` }} />
                </div>
                <span className="text-zinc-400">{Math.round(exportState.progress * 100)}%</span>
              </div>
            )}
          </div>
        )}

        <CsvBatch />
      </div>
    </div>
  );
}
