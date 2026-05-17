#!/usr/bin/env node
/**
 * Generates app icon assets from BrandMark geometry.
 * BrandMark viewBox: 0 0 14 14
 *   - Rect  court outline: x=2 y=3 w=10 h=8 rx=0.4
 *   - Line  net (vertical):  x1=7  y1=3  x2=7  y2=11  strokeWidth=1.3
 *   - Line  center (horiz):  x1=2  y1=7  x2=12 y2=7   strokeWidth=1
 * bg: #1F6F4A, strokes: white
 */

import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const assets = resolve(root, 'assets');

const SIZE = 1024;
const BG = '#1F6F4A';
const STROKE = '#FFFFFF';

// Scale the 14×14 viewBox to 60% of icon size, centered.
const S = (SIZE * 0.60) / 14;
const O = (SIZE - 14 * S) / 2;

// Helper: round to 2 decimal places
const r = (n) => Math.round(n * 100) / 100;

function courtSvg(transparent = false) {
  const bg = transparent
    ? ''
    : `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>`;

  // Court outline rect
  const rx = O + 2 * S;
  const ry = O + 3 * S;
  const rw = 10 * S;
  const rh = 8 * S;
  const rrx = 0.4 * S;
  const rsw = S; // strokeWidth 1 in viewBox units

  // Net line (vertical)
  const nx = O + 7 * S;
  const ny1 = O + 3 * S;
  const ny2 = O + 11 * S;
  const nsw = 1.3 * S;

  // Center line (horizontal)
  const cx1 = O + 2 * S;
  const cx2 = O + 12 * S;
  const cy = O + 7 * S;
  const csw = S;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${bg}
  <rect x="${r(rx)}" y="${r(ry)}" width="${r(rw)}" height="${r(rh)}" rx="${r(rrx)}" fill="none" stroke="${STROKE}" stroke-width="${r(rsw)}"/>
  <line x1="${r(nx)}" y1="${r(ny1)}" x2="${r(nx)}" y2="${r(ny2)}" stroke="${STROKE}" stroke-width="${r(nsw)}"/>
  <line x1="${r(cx1)}" y1="${r(cy)}" x2="${r(cx2)}" y2="${r(cy)}" stroke="${STROKE}" stroke-width="${r(csw)}"/>
</svg>`;
}

async function generate(svgStr, outPath, { background } = {}) {
  const buf = Buffer.from(svgStr);
  let pipeline = sharp(buf);
  if (background) {
    pipeline = pipeline.flatten({ background });
  }
  await pipeline
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9, palette: false })
    .toFile(outPath);
  console.log(`✓ ${outPath}`);
}

async function main() {
  // icon.png — fully opaque RGB, no alpha (iOS requirement)
  await generate(courtSvg(false), resolve(assets, 'icon.png'), { background: BG });

  // adaptive-icon.png — transparent bg (Android adds backgroundColor from app.json)
  await generate(courtSvg(true), resolve(assets, 'adaptive-icon.png'));

  // splash-icon.png — opaque
  await generate(courtSvg(false), resolve(assets, 'splash-icon.png'), { background: BG });

  // splash.png — opaque
  await generate(courtSvg(false), resolve(assets, 'splash.png'), { background: BG });

  console.log('\nAll icon assets generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
