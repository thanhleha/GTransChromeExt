/**
 * Resize icons/source_1024.png into icons/icon{16,48,128}.png.
 *
 * What it does:
 *   1. Detects the white rounded-square region in the AI-generated source
 *      (by scanning from each edge for the first ~white pixel).
 *   2. Crops to that square and applies a rounded-square mask so corners
 *      are transparent.
 *   3. Downsamples to 128, 48, 16 using the browser's high-quality
 *      bilinear filter (Chromium). For 16×16 we stage through 64×64 to
 *      reduce aliasing.
 *
 * Run from project root:
 *   node resize_icon.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const sourcePath = path.resolve(__dirname, 'icons/source_1024.png');
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing source: ${sourcePath}`);
    process.exit(1);
  }
  const srcB64 = fs.readFileSync(sourcePath).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  const outputs = [
    { size: 128, path: path.resolve(__dirname, 'icons/icon128.png'), staged: false },
    { size: 48,  path: path.resolve(__dirname, 'icons/icon48.png'),  staged: false },
    { size: 16,  path: path.resolve(__dirname, 'icons/icon16.png'),  staged: true  },
  ];

  for (const { size, path: outPath, staged } of outputs) {
    const dataUrl = await page.evaluate(async ({ b64, size, staged }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();

      // 1. Read pixel data from the source.
      const scratch = document.createElement('canvas');
      scratch.width = img.width;
      scratch.height = img.height;
      const sctx = scratch.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const data = sctx.getImageData(0, 0, img.width, img.height).data;
      const W = img.width, H = img.height;

      // 2. Detect the rounded-square bounds by scanning for near-white pixels.
      const isWhite = (r, g, b) => r >= 235 && g >= 235 && b >= 235;
      let top = 0, bottom = H - 1, left = 0, right = W - 1;
      outer: for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (isWhite(data[i], data[i+1], data[i+2])) { top = y; break outer; }
        }
      }
      outer: for (let y = H - 1; y >= 0; y--) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (isWhite(data[i], data[i+1], data[i+2])) { bottom = y; break outer; }
        }
      }
      outer: for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          const i = (y * W + x) * 4;
          if (isWhite(data[i], data[i+1], data[i+2])) { left = x; break outer; }
        }
      }
      outer: for (let x = W - 1; x >= 0; x--) {
        for (let y = 0; y < H; y++) {
          const i = (y * W + x) * 4;
          if (isWhite(data[i], data[i+1], data[i+2])) { right = x; break outer; }
        }
      }
      const cropW = right - left + 1;
      const cropH = bottom - top + 1;
      const cropSize = Math.max(cropW, cropH);

      // 3. Build a square canvas at native crop size, center the source, apply rounded mask.
      const sq = document.createElement('canvas');
      sq.width = cropSize;
      sq.height = cropSize;
      const qctx = sq.getContext('2d');
      const offX = Math.floor((cropSize - cropW) / 2);
      const offY = Math.floor((cropSize - cropH) / 2);
      qctx.drawImage(img, left, top, cropW, cropH, offX, offY, cropW, cropH);

      // Rounded-square mask — radius matches the apparent ~12% corner radius of the AI output.
      const rad = cropSize * 0.14;
      qctx.globalCompositeOperation = 'destination-in';
      qctx.beginPath();
      qctx.moveTo(rad, 0);
      qctx.lineTo(cropSize - rad, 0);
      qctx.quadraticCurveTo(cropSize, 0, cropSize, rad);
      qctx.lineTo(cropSize, cropSize - rad);
      qctx.quadraticCurveTo(cropSize, cropSize, cropSize - rad, cropSize);
      qctx.lineTo(rad, cropSize);
      qctx.quadraticCurveTo(0, cropSize, 0, cropSize - rad);
      qctx.lineTo(0, rad);
      qctx.quadraticCurveTo(0, 0, rad, 0);
      qctx.closePath();
      qctx.fill();

      // 4. Downsample to target size.
      let srcCanvas = sq;
      if (staged) {
        // One intermediate halving pass to reduce aliasing for the 16px tile.
        const mid = document.createElement('canvas');
        mid.width = mid.height = 64;
        const mctx = mid.getContext('2d');
        mctx.imageSmoothingEnabled = true;
        mctx.imageSmoothingQuality = 'high';
        mctx.drawImage(sq, 0, 0, 64, 64);
        srcCanvas = mid;
      }
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(srcCanvas, 0, 0, size, size);
      return out.toDataURL('image/png');
    }, { b64: srcB64, size, staged });

    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(outPath, buf);
    console.log(`Wrote ${path.relative(__dirname, outPath)} (${size}x${size})`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
