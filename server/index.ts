import express from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, createReadStream, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { probeVideo, exportVideo, exportAlphaTemplate, exportAlphaBatch, applySpeed, type ExportFormat } from './ffmpeg.js';
import { defaultBar, type BarInstance, type EasingName } from '../shared/animate.js';
import type { ImportedArtPayload } from '../shared/importedArt.js';

const UPLOAD_DIR = '/tmp/superbar-uploads';
const OUTPUT_DIR = '/tmp/superbar-outputs';
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
// A 4x-rasterized background PNG easily runs a few MB as a base64 data URL -- default 100kb limit
// would reject every custom-artwork export.
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// Serve the operator's own installed font files -- matches how AE resolves them, no bundling.
const FONT_DIR = process.env.SUPERBAR_FONT_DIR || `${homedir()}/Library/Fonts`;
app.get('/fonts/:name', (req, res) => {
  const safeName = req.params.name.replace(/[^A-Za-z0-9.\-]/g, '');
  const path = `${FONT_DIR}/${safeName}`;
  if (!existsSync(path)) return res.status(404).end();
  res.sendFile(path);
});

const upload = multer({ dest: UPLOAD_DIR });

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const id = req.file.filename;
  const probe = probeVideo(req.file.path);
  res.json({ id, url: `/uploads/${id}`, ...probe });
});

interface Job {
  progress: number;
  done: boolean;
  error: string | null;
  outputPath: string | null;
  listeners: Set<express.Response>;
}
const jobs = new Map<string, Job>();

interface ExportBarPayload {
  id?: string;
  text: string;
  inSec: number;
  holdSec: number;
  inDurationSec?: number;
  outDurationSec?: number;
  easingIn?: EasingName;
  easingOut?: EasingName;
}

// Bar ids are used directly as a filename prefix in the per-bar frame-sequence glob
// (`${bar.id}_NNNNNN.png`, see server/render.ts / server/ffmpeg.ts) -- sanitize rather than trust
// client input for path construction, same pattern as the /fonts/:name route above.
function sanitizeBarId(raw: string | undefined, index: number): string {
  const safe = (raw ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe.length > 0 ? safe : `bar-${index}`;
}

app.post('/api/export', (req, res) => {
  const { uploadId, bars: barsPayload, format, art, mode, speed, width, height, fps } = req.body as {
    uploadId?: string;
    bars: ExportBarPayload[];
    format: ExportFormat;
    art?: ImportedArtPayload;
    mode?: 'burned' | 'alpha';
    speed?: number;
    width?: number;
    height?: number;
    fps?: number;
  };

  if (!Array.isArray(barsPayload) || barsPayload.length === 0) {
    return res.status(400).json({ error: 'bars must be a non-empty array' });
  }

  const seenIds = new Set<string>();
  const bars: BarInstance[] = barsPayload.map((bp, i) => {
    let id = sanitizeBarId(bp.id, i);
    while (seenIds.has(id)) id = `${id}-${i}`;
    seenIds.add(id);
    const b: BarInstance = { ...defaultBar(id, bp.text, bp.inSec), holdSec: bp.holdSec };
    if (bp.inDurationSec != null) b.inDurationSec = bp.inDurationSec;
    if (bp.outDurationSec != null) b.outDurationSec = bp.outDurationSec;
    if (bp.easingIn) b.easingIn = bp.easingIn;
    if (bp.easingOut) b.easingOut = bp.easingOut;
    return b;
  });

  // Motion-speed control: a bounded tempo multiplier, applied to BOTH export modes. Wins over
  // whatever inDurationSec/outDurationSec a bar payload separately requested (see applySpeed in
  // server/ffmpeg.ts, shared with exportAlphaBatch below).
  if (speed != null) applySpeed(bars, speed);

  const jobId = randomUUID();

  if (mode === 'alpha') {
    if (bars.length !== 1) {
      return res.status(400).json({ error: 'alpha mode supports exactly one bar in this phase' });
    }
    const outputPath = `${OUTPUT_DIR}/${jobId}.mov`;
    const job: Job = { progress: 0, done: false, error: null, outputPath, listeners: new Set() };
    jobs.set(jobId, job);

    exportAlphaTemplate({
      bar: bars[0],
      outputPath,
      width,
      height,
      fps,
      art,
      onProgress: (f) => {
        job.progress = f;
        for (const listener of job.listeners) listener.write(`data: ${JSON.stringify({ progress: f })}\n\n`);
      },
    })
      .then(() => {
        job.done = true;
        for (const listener of job.listeners) {
          listener.write(`data: ${JSON.stringify({ progress: 1, done: true })}\n\n`);
          listener.end();
        }
      })
      .catch((err) => {
        job.error = String(err.message || err);
        for (const listener of job.listeners) {
          listener.write(`data: ${JSON.stringify({ error: job.error })}\n\n`);
          listener.end();
        }
      });

    return res.json({ jobId });
  }

  // Default/'burned' mode -- unchanged behavior, still requires a real uploaded video.
  const inputPath = `${UPLOAD_DIR}/${uploadId}`;
  if (!uploadId || !existsSync(inputPath)) return res.status(404).json({ error: 'unknown uploadId' });

  // Defensive: the render engine composites every bar at the same fixed on-screen position
  // (overlay=0:0 per bar in server/ffmpeg.ts), so two visibly-overlapping bars would draw
  // directly on top of each other -- reject rather than silently produce a garbled export.
  const sortedBars = [...bars].sort((a, b) => a.inSec - b.inSec);
  for (let i = 1; i < sortedBars.length; i++) {
    const prevEnd = sortedBars[i - 1].inSec + sortedBars[i - 1].inDurationSec
      + sortedBars[i - 1].holdSec + sortedBars[i - 1].outDurationSec;
    if (sortedBars[i].inSec < prevEnd) {
      return res.status(400).json({
        error: `bars "${sortedBars[i - 1].text}" and "${sortedBars[i].text}" have overlapping visible windows`,
      });
    }
  }

  const ext = format === 'mp4' ? 'mp4' : 'mov';
  const outputPath = `${OUTPUT_DIR}/${jobId}.${ext}`;
  const job: Job = { progress: 0, done: false, error: null, outputPath, listeners: new Set() };
  jobs.set(jobId, job);

  exportVideo({
    inputPath,
    outputPath,
    bars,
    format,
    art,
    onProgress: (f) => {
      job.progress = f;
      for (const listener of job.listeners) listener.write(`data: ${JSON.stringify({ progress: f })}\n\n`);
    },
  })
    .then(() => {
      job.done = true;
      for (const listener of job.listeners) {
        listener.write(`data: ${JSON.stringify({ progress: 1, done: true })}\n\n`);
        listener.end();
      }
    })
    .catch((err) => {
      job.error = String(err.message || err);
      for (const listener of job.listeners) {
        listener.write(`data: ${JSON.stringify({ error: job.error })}\n\n`);
        listener.end();
      }
    });

  res.json({ jobId });
});

// CSV-batch alpha export: one standalone alpha-template .mov per input string, zipped into a
// single download. Alpha-only in this phase -- no uploadId, no source video. Reuses the same
// Job/SSE progress plumbing as /api/export; the download route below already derives its
// filename extension from job.outputPath, so a .zip output needs no changes there.
app.post('/api/export-batch', (req, res) => {
  const { texts, speed, width, height, fps } = req.body as {
    texts: string[];
    speed?: number;
    width?: number;
    height?: number;
    fps?: number;
  };

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'texts must be a non-empty array' });
  }

  const jobId = randomUUID();
  const outputPath = `${OUTPUT_DIR}/${jobId}.zip`;
  const job: Job = { progress: 0, done: false, error: null, outputPath, listeners: new Set() };
  jobs.set(jobId, job);

  exportAlphaBatch({
    texts,
    outputZipPath: outputPath,
    speed,
    width,
    height,
    fps,
    onProgress: (f) => {
      job.progress = f;
      for (const listener of job.listeners) listener.write(`data: ${JSON.stringify({ progress: f })}\n\n`);
    },
  })
    .then(() => {
      job.done = true;
      for (const listener of job.listeners) {
        listener.write(`data: ${JSON.stringify({ progress: 1, done: true })}\n\n`);
        listener.end();
      }
    })
    .catch((err) => {
      job.error = String(err.message || err);
      for (const listener of job.listeners) {
        listener.write(`data: ${JSON.stringify({ error: job.error })}\n\n`);
        listener.end();
      }
    });

  res.json({ jobId });
});

app.get('/api/export/:jobId/progress', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (job.done) {
    res.write(`data: ${JSON.stringify({ progress: 1, done: true })}\n\n`);
    return res.end();
  }
  if (job.error) {
    res.write(`data: ${JSON.stringify({ error: job.error })}\n\n`);
    return res.end();
  }

  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
});

app.get('/api/export/:jobId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.done || !job.outputPath) return res.status(404).end();
  const stat = statSync(job.outputPath);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="superbar-export${job.outputPath.slice(job.outputPath.lastIndexOf('.'))}"`);
  createReadStream(job.outputPath).pipe(res);
});

const PORT = Number(process.env.SUPERBAR_SERVER_PORT || 5184);
app.listen(PORT, () => {
  console.log(`superbar-tool server listening on http://localhost:${PORT}`);
});
