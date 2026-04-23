/**
 * Build a clean upload zip for the Chrome Web Store.
 *
 * Includes ONLY the files the extension needs at runtime:
 *   manifest.json, background.js, content.js, languages.js,
 *   popup.html, popup.css, popup.js, icons/icon{16,48,128}.png
 *
 * Excludes everything else (tests, git, README, source art, scripts).
 *
 * Run:  node build_zip.js
 * Output:  dist/quick-webpage-translate-v<version>.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const outName = `quick-webpage-translate-v${manifest.version}.zip`;
const outPath = path.join(DIST, outName);

// Files to include (relative to repo root). Keep this list tight.
const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'languages.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

// Clean and recreate stage dir
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

for (const rel of FILES) {
  const src = path.join(ROOT, rel);
  const dst = path.join(STAGE, rel);
  if (!fs.existsSync(src)) {
    console.error(`Missing required file: ${rel}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// Remove any prior zip at the same path
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

// Zip from inside the stage dir so the archive has no extra parent folder.
// PowerShell's Compress-Archive is present on all modern Windows installs.
const psCmd = `Compress-Archive -Path '*' -DestinationPath '${outPath.replace(/'/g, "''")}'`;
execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, {
  cwd: STAGE,
  stdio: 'inherit',
});

// Clean the stage directory — we only need the zip.
fs.rmSync(STAGE, { recursive: true, force: true });

const size = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\nBuilt ${path.relative(ROOT, outPath)} (${size} KB)`);
console.log('Upload this file in the Chrome Web Store Developer Dashboard.');
