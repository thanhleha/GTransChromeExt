/**
 * Capture a 1280×800 screenshot of the popup for the Chrome Web Store listing.
 *
 * The Web Store accepts 1280×800 or 640×400. We render the 300px-wide popup
 * centered on a 1280×800 canvas with a soft background so it reads well at
 * thumbnail size in the listing.
 *
 * Outputs:  store_assets/screenshot_popup.png
 *
 * Run:  NODE_PATH=./tests/node_modules node capture_screenshots.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const EXT_PATH = ROOT;
const OUT_DIR = path.join(ROOT, 'store_assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const userDataDir = path.join(os.tmpdir(), 'qwt-screenshot-' + Date.now());
  // Use Playwright's bundled Chromium (matches the test suite) — system
  // Chrome causes profile conflicts and the service worker may not register.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'],
  });

  // Wait for the extension service worker to register so we can find its ID.
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).hostname;

  // Pre-seed storage: pin a few favorites and set a nice recent list so the
  // screenshot shows the full UI populated, not the empty default.
  const bootstrap = await context.newPage();
  await bootstrap.goto(`chrome-extension://${extensionId}/popup.html`);
  await bootstrap.waitForLoadState('domcontentloaded');
  await bootstrap.evaluate(() => new Promise(r =>
    chrome.storage.sync.set({
      recentLanguages: ['vi', 'en', 'fr'],
      pinnedLanguages: ['ja', 'de'],
      triggerMode: 'hover',
      hideGTPopup: true,
    }, r)
  ));
  await bootstrap.close();

  // Open a normal web page first so the popup's getActiveTab() fallback finds
  // a translatable tab — otherwise the popup shows "Cannot translate this page".
  const hostTab = await context.newPage();
  await hostTab.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await hostTab.waitForTimeout(300);

  // 1. Screenshot the popup directly (chrome-extension:// origin — can't be
  //    embedded as an iframe in a normal page, so we capture it first, then
  //    composite the resulting PNG into the marketing layout via <img>).
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 320, height: 560 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForLoadState('domcontentloaded');
  await popupPage.waitForTimeout(500);
  const popupPngBuf = await popupPage.screenshot({ omitBackground: false });
  const popupB64 = popupPngBuf.toString('base64');
  await popupPage.close();
  await hostTab.close();

  // 2. Compose the 1280×800 marketing shot with the popup image beside a
  //    short value prop. This reads better at thumbnail size than a bare
  //    300×500 popup floating on white.
  const stage = await context.newPage();
  await stage.setViewportSize({ width: 1280, height: 800 });
  await stage.setContent(`
    <!doctype html>
    <html><head><style>
      html, body { margin: 0; height: 100%; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
      body {
        background: linear-gradient(135deg, #fff5f2 0%, #eaf7f5 100%);
        display: flex; align-items: center; justify-content: center; gap: 80px;
        padding: 40px 60px; box-sizing: border-box;
      }
      .pitch { max-width: 520px; color: #202124; }
      .pitch h1 { font-size: 52px; margin: 0 0 20px; letter-spacing: -0.8px; line-height: 1.05; }
      .pitch p { font-size: 20px; line-height: 1.5; color: #3c4043; margin: 0 0 14px; }
      .popup-frame {
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(32, 33, 36, .18), 0 4px 10px rgba(32, 33, 36, .08);
        overflow: hidden; background: #fff;
        display: block;
      }
      .popup-frame img { display: block; width: 320px; height: auto; }
      .accent { color: #FF6B5B; font-weight: 600; }
    </style></head>
    <body>
      <div class="pitch">
        <h1>One click.<br>Any language.</h1>
        <p>Your top 3 languages are always in the popup — no menus, no typing.</p>
        <p>Pin favorites. Hover a word on translated pages to see the <span class="accent">original</span>.</p>
      </div>
      <div class="popup-frame">
        <img src="data:image/png;base64,${popupB64}" alt="Popup">
      </div>
    </body></html>
  `);
  await stage.waitForTimeout(400);

  const outPath = path.join(OUT_DIR, 'screenshot_popup.png');
  await stage.screenshot({ path: outPath, fullPage: false, omitBackground: false });
  console.log(`Wrote ${path.relative(ROOT, outPath)} (1280×800)`);

  await context.close();
}

main().catch(e => { console.error(e); process.exit(1); });
