import { exportVideo, probeVideo } from '../server/ffmpeg.js';
import { defaultBar } from '../shared/animate.js';

const INPUT = '/Users/anastasia.cynthia.tanawi/Downloads/Cut25 Super (GPU & Performance Fixes.mp4';
const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';

const probe = probeVideo(INPUT);
console.log('probe:', probe);

const bar = defaultBar('bar1', 'Windows Setup', 0.5);
bar.holdSec = 2;

await exportVideo({
  inputPath: INPUT,
  outputPath: `${OUT_DIR}/test-export.mp4`,
  bars: [bar],
  format: 'mp4',
  onProgress: (f) => process.stdout.write(`\rprogress: ${(f * 100).toFixed(0)}%`),
});
console.log('\ndone ->', `${OUT_DIR}/test-export.mp4`);

await exportVideo({
  inputPath: INPUT,
  outputPath: `${OUT_DIR}/test-export.mov`,
  bars: [bar],
  format: 'mov-prores',
  onProgress: (f) => process.stdout.write(`\rprogress (mov): ${(f * 100).toFixed(0)}%`),
});
console.log('\ndone ->', `${OUT_DIR}/test-export.mov`);
