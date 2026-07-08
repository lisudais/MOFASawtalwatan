// One-off dev utility: renders public/mofa-logo.svg down to the PWA icon sizes
// referenced in public/manifest.json. Not imported by the app itself.
import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'node:fs';

const SOURCE = './public/mofa-logo.svg';
const TARGETS = [
  { file: './public/icon-192.png', size: 192 },
  { file: './public/icon-512.png', size: 512 },
  { file: './public/badge-72.png', size: 72 },
];

for (const { file, size } of TARGETS) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0A1628';
  ctx.fillRect(0, 0, size, size);
  const img = await loadImage(SOURCE);
  const pad = size * 0.12;
  ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
  writeFileSync(file, canvas.toBuffer('image/png'));
  console.log(`wrote ${file}`);
}
