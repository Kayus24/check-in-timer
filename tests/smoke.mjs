import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredSource = [
  'index.html',
  'package.json',
  'postcss.config.js',
  'public/icon-192.svg',
  'public/icon-512.svg',
  'public/manifest.webmanifest',
  'public/resources/background-clean-v2.mp4',
  'public/sw-v2.js',
  'public/sw.js',
  'src/main.ts',
  'src/styles.css',
  'src/timer-glyphs.ts',
  'tailwind.config.js',
  'tests/tests.txt',
  'tsconfig.json',
  'vite.config.ts',
];
const requiredAssets = [
  'public/resources/map-reference.jpg',
  'public/resources/profile-reference.jpg',
];

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function pngDimensions(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const missing = requiredSource.filter((item) => !fs.existsSync(path.join(root, item)));
const assets = requiredAssets.map((item) => {
  const fullPath = path.join(root, item);
  if (!fs.existsSync(fullPath)) return { path: item, exists: false };
  const buffer = fs.readFileSync(fullPath);
  return {
    path: item,
    exists: true,
    bytes: buffer.length,
    dimensions: jpegDimensions(buffer) || pngDimensions(buffer),
  };
});
const invalidDimensions = assets.filter((asset) => asset.exists && (asset.dimensions?.width !== 931 || asset.dimensions?.height !== 2048));
const videoPath = path.join(root, 'public/resources/background-clean-v2.mp4');
const result = {
  generatedAt: new Date().toISOString(),
  baseline: { app: 'check-in-timer-a2r81o', version: 'v77', snapshot: '1789060544305' },
  requiredSource,
  missingSource: missing,
  assets,
  invalidDimensions,
  video: fs.existsSync(videoPath) ? { bytes: fs.statSync(videoPath).size } : { exists: false },
  pass: missing.length === 0 && invalidDimensions.length === 0 && assets.every((asset) => asset.exists),
};
fs.mkdirSync(path.join(root, 'artifacts/tests'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/tests/source-integrity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;

