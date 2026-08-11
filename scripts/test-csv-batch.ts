import { parseCsv, extractTextColumn } from '../shared/csv.js';
import { exportAlphaBatch } from '../server/ffmpeg.js';

const OUT_DIR = '/private/tmp/claude-502/-Users-anastasia-cynthia-tanawi/025493ce-2a02-4d22-b1e4-7c32d6c59262/scratchpad';
const ZIP_PATH = `${OUT_DIR}/csv-batch-sample.zip`;

// Header row + a quoted field containing a comma + a CJK entry -- exercises the parser's quoting
// and the CJK font-fallback path exportAlphaTemplate already relies on via renderBarFrames.
const SAMPLE_CSV = [
  'text,notes',
  '"GPU & Performance Fixes",primary',
  '"Cables, Connectors & Ports",has a comma',
  '视频设置向导,cjk',
].join('\n');

const rows = parseCsv(SAMPLE_CSV);
console.log('parsed rows:', JSON.stringify(rows));

const texts = extractTextColumn(rows);
console.log('extracted texts:', texts);

await exportAlphaBatch({
  texts,
  outputZipPath: ZIP_PATH,
  onProgress: (f) => process.stdout.write(`\rprogress: ${(f * 100).toFixed(0)}%`),
});

console.log('\ndone ->', ZIP_PATH);
console.log('next: unzip -l', ZIP_PATH, '(confirm 001/002/003-slug.mov filenames), then ffprobe one entry for prores/yuva444p10le.');
