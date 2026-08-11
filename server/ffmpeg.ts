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

// Frame rates the alpha template encoder accepts. Kept as an explicit allowlist (rather than
// accepting any number) so a typo'd fps fails loudly at export time instead of silently producing
// a file whose frame count doesn't match what a Premiere editor expects for their own timeline.
export const ALLOWED_ALPHA_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

function assertValidAlphaFps(fps: number): void {
  if (!ALLOWED_ALPHA_FPS.some((f) => Math.abs(f - fps) < 0.001)) {
    throw new Error(`fps ${fps} not supported for alpha export; allowed: ${ALLOWED_ALPHA_FPS.join(', ')}`);
  }
}

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

/**
 * Exports the super bar as a STANDALONE transparent template -- no source video, no compositing.
 * Sibling to exportVideo, not a branch inside it: this never calls probeVideo and never builds an
 * overlay filter graph, since there's no base video to overlay onto.
 *
 * Encoded as ProRes 4444 in a .mov with STRAIGHT (non-premultiplied) alpha, so a video editor can
 * drop it onto their own timeline as a clean overlay. `renderBarFrames()` already writes PNG
 * frames -- PNG has no premultiplied-alpha mode, so those frames are straight alpha by
 * construction. Composited over the transparent frames without ever compositing them over a
 * black/matte background before encoding (that would premultiply against black and darken every
 * anti-aliased edge pixel into a visible fringe once dropped over bright footage) keeps that
 * property all the way to the encoded file: `-pix_fmt yuva444p10le` with `-profile:v 4` is
 * ProRes's 4444 profile, confirmed against the bundled ffmpeg-static binary to support this pixel
 * format with a 16-bit alpha plane by default.
 */
export async function exportAlphaTemplate(opts: {
  bar: BarInstance;
  outputPath: string;
  width?: number; // default 1920
  height?: number; // default 1080
  fps?: number; // default 30; must be one of ALLOWED_ALPHA_FPS
  art?: ImportedArtPayload;
  onProgress?: (fractionDone: number) => void;
}): Promise<void> {
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const fps = opts.fps ?? 30;
  assertValidAlphaFps(fps);

  const tmpDir = mkdtempSync(join(tmpdir(), 'superbar-alpha-'));
  try {
    // Same rendering function exportVideo uses -- no fork. Frame filenames are already 0-indexed
    // relative to the bar's own startFrame regardless of bar.inSec, so the encoded file's own
    // frame 0 lands exactly on the bar's animation start no matter what inSec was set to.
    const { framePaths } = await renderBarFrames({
      bar: opts.bar,
      videoWidth: width,
      videoHeight: height,
      fps,
      outDir: tmpDir,
      art: opts.art,
    });
    const totalDurationSec = framePaths.length / fps;

    await new Promise<void>((resolve, reject) => {
      const args: string[] = [
        '-y',
        '-framerate', String(fps),
        '-i', `${tmpDir}/${opts.bar.id}_%06d.png`,
        '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-progress', 'pipe:1',
        opts.outputPath,
      ];

      const proc = spawn(ffmpegPath as string, args);
      let stderr = '';
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.stdout?.on('data', (d) => {
        const text = d.toString();
        const match = text.match(/out_time_ms=(\d+)/);
        if (match && opts.onProgress) {
          const doneMs = Number(match[1]) / 1000;
          opts.onProgress(Math.min(1, doneMs / (totalDurationSec * 1000)));
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
