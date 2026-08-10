import { exportVideo, probeVideo } from '../server/ffmpeg.js';
import { defaultBar } from '../shared/animate.js';

const INPUT = '/Users/anastasia.cynthia.tanawi/Downloads/Cut25 Super (GPU & Performance Fixes.mp4';
const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';

const probe = probeVideo(INPUT);
console.log('probe:', probe);

const bar1 = { ...defaultBar('bar-1', 'First Title', 0.5), holdSec: 2 };
const bar1End = bar1.inSec + bar1.inDurationSec + bar1.holdSec + bar1.outDurationSec;
const bar2 = { ...defaultBar('bar-2', 'Second Title', bar1End + 0.5), holdSec: 2 };
console.log('bar-1 window:', bar1.inSec, '->', bar1End);
console.log('bar-2 window:', bar2.inSec, '->', bar2.inSec + bar2.inDurationSec + bar2.holdSec + bar2.outDurationSec);

await exportVideo({
  inputPath: INPUT,
  outputPath: `${OUT_DIR}/multi-bar-test.mp4`,
  bars: [bar1, bar2],
  format: 'mp4',
  onProgress: (f) => process.stdout.write(`\rprogress: ${(f * 100).toFixed(0)}%`),
});
console.log('\ndone ->', `${OUT_DIR}/multi-bar-test.mp4`);
