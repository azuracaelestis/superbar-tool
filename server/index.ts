import express from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, createReadStream, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { probeVideo, exportVideo, type ExportFormat } from './ffmpeg.js';
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

app.post('/api/export', (req, res) => {
  const { uploadId, text, inSec, holdSec, inDurationSec, outDurationSec, easingIn, easingOut, format, art } = req.body as {
    uploadId: string;
    text: string;
    inSec: number;
    holdSec: number;
    inDurationSec?: number;
    outDurationSec?: number;
    easingIn?: EasingName;
    easingOut?: EasingName;
    format: ExportFormat;
    art?: ImportedArtPayload;
  };

  const inputPath = `${UPLOAD_DIR}/${uploadId}`;
  if (!existsSync(inputPath)) return res.status(404).json({ error: 'unknown uploadId' });

  const bar: BarInstance = { ...defaultBar('bar1', text, inSec), holdSec };
  if (inDurationSec != null) bar.inDurationSec = inDurationSec;
  if (outDurationSec != null) bar.outDurationSec = outDurationSec;
  if (easingIn) bar.easingIn = easingIn;
  if (easingOut) bar.easingOut = easingOut;

  const jobId = randomUUID();
  const ext = format === 'mp4' ? 'mp4' : 'mov';
  const outputPath = `${OUTPUT_DIR}/${jobId}.${ext}`;
  const job: Job = { progress: 0, done: false, error: null, outputPath, listeners: new Set() };
  jobs.set(jobId, job);

  exportVideo({
    inputPath,
    outputPath,
    bars: [bar],
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
