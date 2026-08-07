import { useState } from 'react';
import { loadPdf, rasterizePdf, rasterizeSvg, cropCanvas, type LoadedPdf } from './pdfLayers.js';
import { autoGuessSlices, autoGuessContentBounds, type SliceHandles, type CropRect } from '../../shared/ninegrid.js';
import SliceEditor from './SliceEditor.js';
import CropEditor from './CropEditor.js';

export interface ImportedArtResult {
  dataUrl: string;
  width: number;
  height: number;
  slices: SliceHandles;
  textInsetLeft: number;
  textInsetRight: number;
  textBaselineFromTop: number;
}

interface Props {
  onImported: (art: ImportedArtResult) => void;
  onCancel: () => void;
}

type Step = 'pick' | 'crop' | 'slice';

export default function ArtworkImport({ onImported, onCancel }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());

  const [rawCanvas, setRawCanvas] = useState<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);

  const [croppedCanvas, setCroppedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [slices, setSlices] = useState<SliceHandles | null>(null);

  const [textInsetLeft, setTextInsetLeft] = useState(60);
  const [textInsetRight, setTextInsetRight] = useState(60);
  const [textBaselineFromTop, setTextBaselineFromTop] = useState(92);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setRawCanvas(null);
    setCroppedCanvas(null);
    setSlices(null);
    try {
      if (/\.(ai|pdf)$/i.test(file.name)) {
        const loaded = await loadPdf(file);
        setPdf(loaded);
        const defaultVisible = new Set(
          loaded.layers.filter((l) => !/^(bg|background|artboard|guide)/i.test(l.name)).map((l) => l.id),
        );
        setVisibleLayers(defaultVisible);
        if (loaded.layers.length === 0) await rasterizeAndCrop(loaded, new Set());
      } else if (/\.svg$/i.test(file.name)) {
        setPdf(null);
        const c = await rasterizeSvg(file);
        beginCrop(c);
      } else {
        setError('Please choose an .ai, .pdf, or .svg file.');
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    }
  }

  function beginCrop(c: HTMLCanvasElement) {
    setRawCanvas(c);
    setCrop(autoGuessContentBounds(c.getContext('2d')!.getImageData(0, 0, c.width, c.height) as any));
    setStep('crop');
  }

  async function rasterizeAndCrop(loaded: LoadedPdf, visible: Set<string>) {
    const c = await rasterizePdf(loaded, visible);
    beginCrop(c);
  }

  function toggleLayer(id: string) {
    const next = new Set(visibleLayers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleLayers(next);
  }

  function confirmCrop() {
    if (!rawCanvas || !crop) return;
    const cropped = cropCanvas(rawCanvas, crop);
    setCroppedCanvas(cropped);
    setSlices(autoGuessSlices(cropped.getContext('2d')!.getImageData(0, 0, cropped.width, cropped.height) as any));
    setStep('slice');
  }

  function handleConfirm() {
    if (!croppedCanvas || !slices) return;
    onImported({
      dataUrl: croppedCanvas.toDataURL('image/png'),
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      slices,
      textInsetLeft,
      textInsetRight,
      textBaselineFromTop,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
      <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Import background artwork</h2>

        {step === 'pick' && !pdf && (
          <label className="flex items-center justify-center border-2 border-dashed border-zinc-600 rounded-xl h-40 cursor-pointer hover:border-zinc-400">
            <input
              type="file"
              accept=".ai,.pdf,.svg"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <span className="text-zinc-400">Choose an .ai, .pdf, or .svg file</span>
          </label>
        )}

        {error && <div className="text-red-400 text-sm">{error}</div>}

        {step === 'pick' && pdf && pdf.layers.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Layers -- uncheck the artboard background or guides</span>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
              {pdf.layers.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={visibleLayers.has(l.id)} onChange={() => toggleLayer(l.id)} />
                  {l.name}
                </label>
              ))}
            </div>
            <button
              className="self-start bg-zinc-700 hover:bg-zinc-600 rounded px-3 py-1.5 text-sm"
              onClick={() => rasterizeAndCrop(pdf, visibleLayers)}
            >
              Rasterize selected layers
            </button>
          </div>
        )}

        {step === 'crop' && rawCanvas && crop && (
          <div className="flex flex-col gap-3">
            <span className="text-sm text-zinc-400">
              Drag the box to mark just the bar's own bounds -- exclude surrounding whitespace or decoration
              like a full-page background sweep. Everything outside this box is discarded.
            </span>
            <div className="bg-zinc-950 rounded overflow-hidden">
              <CropEditor canvas={rawCanvas} crop={crop} onChange={setCrop} />
            </div>
            <div className="flex justify-between">
              <button className="text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setStep('pick')}>
                Back to layers
              </button>
              <button className="bg-indigo-600 hover:bg-indigo-500 rounded px-4 py-1.5 text-sm font-medium" onClick={confirmCrop}>
                Confirm crop
              </button>
            </div>
          </div>
        )}

        {step === 'slice' && croppedCanvas && slices && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-400">
                Drag the two guides to mark the fixed end caps -- everything between them stretches with the text.
              </span>
              <div className="bg-zinc-950 rounded overflow-hidden">
                <SliceEditor canvas={croppedCanvas} slices={slices} onChange={setSlices} />
              </div>
              <button className="self-start text-sm text-zinc-400 hover:text-zinc-200" onClick={() => setStep('crop')}>
                Back to crop
              </button>
            </div>

            <div className="flex gap-3">
              <label className="flex flex-col gap-1 text-sm flex-1">
                Text inset (left)
                <input
                  type="number"
                  className="bg-zinc-800 rounded px-2 py-1"
                  value={textInsetLeft}
                  onChange={(e) => setTextInsetLeft(Number(e.target.value))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm flex-1">
                Text inset (right)
                <input
                  type="number"
                  className="bg-zinc-800 rounded px-2 py-1"
                  value={textInsetRight}
                  onChange={(e) => setTextInsetRight(Number(e.target.value))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm flex-1">
                Text baseline (from top)
                <input
                  type="number"
                  className="bg-zinc-800 rounded px-2 py-1"
                  value={textBaselineFromTop}
                  onChange={(e) => setTextBaselineFromTop(Number(e.target.value))}
                />
              </label>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200" onClick={onCancel}>
            Cancel
          </button>
          <button
            disabled={step !== 'slice' || !croppedCanvas || !slices}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded px-4 py-1.5 text-sm font-medium"
            onClick={handleConfirm}
          >
            Use this artwork
          </button>
        </div>
      </div>
    </div>
  );
}
