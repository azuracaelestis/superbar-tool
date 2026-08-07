import { useEffect, useRef, useState } from 'react';
import { computeLayout, type GlyphMetricsSource } from '../shared/layout.js';
import { drawSuperBar, type MakeLayer } from '../shared/draw.js';
import { computeImportedLayout, drawImportedBar, type ImportedArtSpec } from '../shared/ninegrid.js';
import { sampleBar, defaultBar, type BarInstance, type EasingName } from '../shared/animate.js';
import { PRESETS } from './presets.js';
import Timeline from './Timeline.js';

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
  const [bar, setBar] = useState<BarInstance>(defaultBar('bar1', 'GPU & Performance Fixes', 0.5));
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

      const anim = sampleBar(bar, video.currentTime);
      if (anim) {
        const fontFamily = CJK_PATTERN.test(bar.text) ? 'GenJyuuGothic-Bold' : 'Gotham-Bold';
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
          const layout = computeImportedLayout(bar.text, art, upload.width, upload.height, measure, fontFamily);
          drawImportedBar(ctx as any, layout, art, bar.text, anim, fontFamily);
        } else {
          const layout = computeLayout(bar.text, upload.width, upload.height, measure, fontFamily);
          drawSuperBar(ctx as any, layout, bar.text, anim, fontFamily, makeLayer);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [upload, bar, fontsReady, preset.art, presetImage]);

  async function handleFile(file: File) {
    const form = new FormData();
    form.append('video', file);
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const info = await res.json();
    setUploadState(info);
    setExportState(null);
  }

  async function handleExport() {
    if (!upload) return;
    setExportState({ progress: 0, downloadUrl: null, error: null });
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: upload.id,
        text: bar.text,
        inSec: bar.inSec,
        holdSec: bar.holdSec,
        inDurationSec: bar.inDurationSec,
        outDurationSec: bar.outDurationSec,
        easingIn: bar.easingIn,
        easingOut: bar.easingOut,
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
              bar={bar}
              onScrub={(t) => {
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              onChangeBar={(patch) => setBar((b) => ({ ...b, ...patch }))}
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

        <label className="flex flex-col gap-1 text-sm">
          Text
          <input
            className="bg-zinc-800 rounded px-2 py-1"
            value={bar.text}
            onChange={(e) => setBar({ ...bar, text: e.target.value })}
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
              value={bar.inDurationSec}
              onChange={(e) => setBar({ ...bar, inDurationSec: Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-400">{bar.inDurationSec.toFixed(2)}s</span>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Out duration (s)
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={bar.outDurationSec}
              onChange={(e) => setBar({ ...bar, outDurationSec: Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-400">{bar.outDurationSec.toFixed(2)}s</span>
          </label>
        </div>

        <div className="flex gap-2">
          <label className="flex flex-col gap-1 text-sm flex-1">
            Ease in
            <select
              className="bg-zinc-800 rounded px-2 py-1"
              value={bar.easingIn}
              onChange={(e) => setBar({ ...bar, easingIn: e.target.value as EasingName })}
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            Ease out
            <select
              className="bg-zinc-800 rounded px-2 py-1"
              value={bar.easingOut}
              onChange={(e) => setBar({ ...bar, easingOut: e.target.value as EasingName })}
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
          disabled={!upload}
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
      </div>
    </div>
  );
}
