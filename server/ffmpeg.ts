import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { spawn, execFileSync } from 'node:child_process';
import type { BarInstance } from '../shared/animate.js';
import type { ImportedArtPayload } from '../shared/importedArt.js';
import { renderBarFrames } from './render.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
}

export function probeVideo(inputPath: string): ProbeResult {
  const out = execFileSync(ffprobeStatic.path, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration',
    '-of', 'json',
    inputPath,
  ]).toString();
  const json = JSON.parse(out);
  const stream = json.streams[0];
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: den ? num / den : num,
    durationSec: Number(stream.duration),
  };
}

export type ExportFormat = 'mp4' | 'mov' | 'mov-prores';

const FORMAT_ARGS: Record<ExportFormat, (ext: string) => string[]> = {
  mp4: () => ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy'],
  mov: () => ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy'],
  'mov-prores': () => ['-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'copy'],
};

const FORMAT_EXT: Record<ExportFormat, string> = { mp4: 'mp4', mov: 'mov', 'mov-prores': 'mov' };

export async function exportVideo(opts: {
  inputPath: string;
  outputPath: string;
  bars: BarInstance[];
  format: ExportFormat;
  art?: ImportedArtPayload; // one imported background, shared by every bar in this export
  onProgress?: (fractionDone: number) => void;
}): Promise<void> {
  const probe = probeVideo(opts.inputPath);
  const tmpDir = mkdtempSync(join(tmpdir(), 'superbar-'));

  try {
    // Render each bar's frame window to a transparent PNG sequence -- only the visible
    // window, not the whole timeline (a 4s bar on a 5-minute video is ~120 frames, not 9000).
    const overlays = await Promise.all(
      opts.bars.map(async (bar) => {
        const { framePaths, startFrame } = await renderBarFrames({
          bar,
          videoWidth: probe.width,
          videoHeight: probe.height,
          fps: probe.fps,
          outDir: tmpDir,
          art: opts.art,
        });
        return { bar, framePaths, startFrame, tIn: startFrame / probe.fps };
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const args: string[] = ['-y', '-i', opts.inputPath];
      for (const ov of overlays) {
        args.push('-framerate', String(probe.fps), '-i', `${tmpDir}/${ov.bar.id}_%06d.png`);
      }

      // Chain one overlay filter per bar; each input starts at tIn on the base timeline.
      let filter = '';
      let lastLabel = '0:v';
      overlays.forEach((ov, i) => {
        const inputIdx = i + 1;
        const outEnd = ov.tIn + ov.framePaths.length / probe.fps;
        const label = i === overlays.length - 1 ? 'vout' : `v${i}`;
        filter += `[${inputIdx}:v]setpts=PTS-STARTPTS+${ov.tIn}/TB[ovl${i}];`;
        filter += `[${lastLabel}][ovl${i}]overlay=0:0:enable='between(t,${ov.tIn},${outEnd})'[${label}];`;
        lastLabel = label;
      });
      filter = filter.replace(/;$/, '');

      args.push('-filter_complex', filter, '-map', `[${lastLabel}]`, '-map', '0:a?');
      args.push(...FORMAT_ARGS[opts.format](FORMAT_EXT[opts.format]));
      args.push('-progress', 'pipe:1', opts.outputPath);

      const proc = spawn(ffmpegPath as string, args);
      let stderr = '';
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.stdout?.on('data', (d) => {
        const text = d.toString();
        const match = text.match(/out_time_ms=(\d+)/);
        if (match && opts.onProgress) {
          const doneMs = Number(match[1]) / 1000;
          opts.onProgress(Math.min(1, doneMs / (probe.durationSec * 1000)));
        }
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
      });
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
