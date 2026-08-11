import { exportAlphaTemplate, ALLOWED_ALPHA_FPS } from '../server/ffmpeg.js';
import { defaultBar } from '../shared/animate.js';

const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';
const OUTPUT_PATH = `${OUT_DIR}/alpha-template-sample.mov`;

console.log('allowed fps:', ALLOWED_ALPHA_FPS.join(', '));

const bar = defaultBar('bar-1', 'GPU & Performance Fixes', 0);

const ffmpegArgs = [
  '-y', '-framerate', '30',
  '-i', '<tmpDir>/bar-1_%06d.png',
  '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-progress', 'pipe:1', OUTPUT_PATH,
];
console.log('ffmpeg args (paths abbreviated):', ffmpegArgs.join(' '));

await exportAlphaTemplate({
  bar,
  outputPath: OUTPUT_PATH,
  onProgress: (f) => process.stdout.write(`\rprogress: ${(f * 100).toFixed(0)}%`),
});

console.log('\ndone ->', OUTPUT_PATH);
console.log('next: ffprobe -show_streams', OUTPUT_PATH, '(confirm prores/yuva444p10le), then drop onto bright footage in Premiere and check for edge fringing on the white face + finch marks.');
