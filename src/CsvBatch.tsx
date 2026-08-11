import { useState } from 'react';
import { parseCsv, extractTextColumn } from '../shared/csv.js';

const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;
const PREVIEW_COUNT = 5;

interface BatchExportState {
  progress: number;
  downloadUrl: string | null;
  error: string | null;
}

// Standalone panel: batch-generates one alpha-template .mov per CSV row, zipped into a single
// download. Doesn't touch bars[]/selectedBarId -- alpha export needs no uploaded video, so this
// is independent of the rest of App's editor state.
export default function CsvBatch() {
  const [texts, setTexts] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [exportState, setExportState] = useState<BatchExportState | null>(null);

  async function handleFile(file: File) {
    const raw = await file.text();
    const rows = parseCsv(raw);
    setTexts(extractTextColumn(rows));
    setFileName(file.name);
    setExportState(null);
  }

  async function handleExportBatch() {
    if (texts.length === 0) return;
    setExportState({ progress: 0, downloadUrl: null, error: null });
    const res = await fetch('/api/export-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, speed }),
    });
    const data = await res.json();
    if (!res.ok) {
      setExportState({ progress: 0, downloadUrl: null, error: data.error ?? 'export failed' });
      return;
    }
    const { jobId } = data;
    const es = new EventSource(`/api/export/${jobId}/progress`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.error) {
        setExportState({ progress: 0, downloadUrl: null, error: msg.error });
        es.close();
      } else if (msg.done) {
        setExportState({ progress: 1, downloadUrl: `/api/export/${jobId}/download`, error: null });
        es.close();
      } else {
        setExportState({ progress: msg.progress, downloadUrl: null, error: null });
      }
    };
  }

  return (
    <div className="flex flex-col gap-2 text-sm border-t border-zinc-700 pt-4">
      <span>Batch export (CSV)</span>
      <label className="flex flex-col gap-1">
        <input
          type="file"
          accept=".csv"
          className="text-xs text-zinc-400"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {fileName && (
        <div className="text-xs text-zinc-400">
          {texts.length === 0 ? (
            <span>{fileName}: no text column found</span>
          ) : (
            <>
              <div>{fileName}: {texts.length} row{texts.length === 1 ? '' : 's'} loaded</div>
              <ul className="mt-1 list-disc list-inside">
                {texts.slice(0, PREVIEW_COUNT).map((t, i) => (
                  <li key={i} className="truncate">{t}</li>
                ))}
                {texts.length > PREVIEW_COUNT && <li>+{texts.length - PREVIEW_COUNT} more</li>}
              </ul>
            </>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1">
        Speed
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <span className="text-xs text-zinc-400">{speed.toFixed(2)}x</span>
      </label>

      <button
        disabled={texts.length === 0}
        onClick={handleExportBatch}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded px-3 py-2 font-medium"
      >
        Export batch ({texts.length} alpha .mov)
      </button>

      {exportState && (
        <div>
          {exportState.error ? (
            <span className="text-red-400">{exportState.error}</span>
          ) : exportState.downloadUrl ? (
            <a href={exportState.downloadUrl} className="text-indigo-400 underline">
              Download batch (zip)
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
  );
}
