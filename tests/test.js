/**
 * Playwright integration test for Quick Google Translate extension.
 *
 * Run:
 *   cd tests
 *   npm install
 *   node test.js
 *
 * Uses the system Chrome on Windows (via WSL2 path) so no display server is needed.
 */
const { chromium } = require('playwright');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Resolve extension path — convert Linux path to Windows path when running under WSL2
function resolveExtensionPath(linuxPath) {
  if (os.platform() === 'win32') return linuxPath; // already a Windows path
  try {
    const winPath = execSync(`wslpath -w "${linuxPath}"`, { encoding: 'utf8' }).trim();
    return winPath;
  } catch {
    return linuxPath;
  }
}

const EXT_LINUX_PATH = path.resolve(__dirname, '..');
const EXT_PATH = resolveExtensionPath(EXT_LINUX_PATH);

// Locate system Chrome — check Windows paths or WSL2 mount
const CHROME_CANDIDATES = os.platform() === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
  : ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME_PATH = CHROME_CANDIDATES.find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } });
const CHROME_AVAILABLE = !!CHROME_PATH;

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[34mℹ\x1b[0m';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ${PASS} ${message}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${message}`);
    failed++;
  }
}

async function launchWithExtension() {
  // Use a fresh temp profile to avoid conflicts with a running Chrome instance
  const userDataDir = path.join(os.tmpdir(), 'playwright-gtrans-test-' + Date.now());

  const launchOptions = {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ['--disable-extensions'],
  };

  // Prefer Playwright Chromium for reliability; fall back to system Chrome
  if (!CHROME_AVAILABLE) {
    console.log(`${INFO} Using Playwright Chromium`);
  } else {
    console.log(`${INFO} Using Playwright Chromium (system Chrome skipped to avoid profile conflicts)`);
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  // Wait for the extension service worker to register
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  const extensionId = new URL(serviceWorker.url()).hostname;
  console.log(`${INFO} Extension ID: ${extensionId}\n`);
  return { context, extensionId };
}

async function openPopup(context, extensionId) {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForLoadState('domcontentloaded');
  await popupPage.waitForTimeout(200);
  return popupPage;
}

async function runTests() {
  console.log('\n\x1b[1mQuick Google Translate — Extension Tests\x1b[0m\n');
  console.log(`Extension path: ${EXT_PATH}`);

  let context, extensionId;
  try {
    ({ context, extensionId } = await launchWithExtension());
  } catch (e) {
    console.error(`${FAIL} Failed to launch browser with extension:\n`, e.message);
    process.exit(1);
  }

  // ─── Test 1: Popup renders 3 recent language buttons ────────────────────
  console.log('Test 1: Popup renders 3 recent language buttons');
  try {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(500);

    const popup = await openPopup(context, extensionId);
    const recentBtns = await popup.$$('.recent-btn');
    assert(recentBtns.length === 3, `Shows 3 recent buttons (got ${recentBtns.length})`);

    const btnTexts = await Promise.all(recentBtns.map(b => b.textContent()));
    assert(btnTexts.every(t => t.trim().length > 0), `All buttons have labels: [${btnTexts.map(t => t.trim()).join(', ')}]`);

    await popup.close();
    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 1 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 2: Language list renders and is searchable ────────────────────
  console.log('\nTest 2: Language list renders and search works');
  try {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(500);

    const popup = await openPopup(context, extensionId);
    const allItems = await popup.$$('.lang-item');
    assert(allItems.length > 50, `Full list renders ${allItems.length} languages`);

    await popup.fill('#searchInput', 'viet');
    await popup.waitForTimeout(150);
    const filtered = await popup.$$('.lang-item');
    assert(filtered.length >= 1, `Searching "viet" returns at least 1 result`);

    const firstText = await filtered[0].textContent();
    assert(firstText.includes('Vietnamese'), `First match is Vietnamese (got: "${firstText.trim()}")`);

    // Clear search restores full list
    await popup.fill('#searchInput', '');
    await popup.waitForTimeout(150);
    const restored = await popup.$$('.lang-item');
    assert(restored.length > 50, `Clearing search restores full list (${restored.length} items)`);

    await popup.close();
    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 2 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 3: Clicking a recent button navigates to Google Translate ──────
  console.log('\nTest 3: Clicking recent language translates the page');
  try {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(500);
    const originalUrl = 'https://example.com/';

    const popup = await openPopup(context, extensionId);
    const recentBtns = await popup.$$('.recent-btn');
    const btnLabel = (await recentBtns[0].textContent()).trim();
    console.log(`  ${INFO} Clicking: "${btnLabel}"`);

    const navPromise = page.waitForURL(/(translate\.google\.com|\.translate\.goog)/, { timeout: 10000 }).catch(() => null);
    try { await recentBtns[0].click(); } catch (e) { /* popup closes via window.close() — expected */ }
    await navPromise;
    await page.waitForTimeout(500);

    const newUrl = page.url();
    assert(
      newUrl.includes('translate.google.com/translate') || newUrl.includes('.translate.goog'),
      `Navigated to Google Translate (URL: ${newUrl.slice(0, 80)}...)`
    );
    // Modern GT uses example-com.translate.goog; classic uses example.com in query param
    assert(
      newUrl.includes('example.com') || newUrl.includes('example-com'),
      'Original domain is in the translate URL'
    );

    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 3 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 4: Already-translated page → original URL extracted ───────────
  console.log('\nTest 4: Translating an already-translated page avoids double-wrapping');
  try {
    const page = await context.newPage();
    const alreadyTranslated =
      'https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Fwww.example.com%2F';
    await page.goto(alreadyTranslated);
    await page.waitForTimeout(1000);

    const popup = await openPopup(context, extensionId);
    const recentBtns = await popup.$$('.recent-btn');

    const navPromise = page.waitForURL(/(translate\.google\.com|\.translate\.goog)/, { timeout: 10000 }).catch(() => null);
    try { await recentBtns[1].click(); } catch (e) { /* popup closes via window.close() — expected */ }
    await navPromise;
    await page.waitForTimeout(500);

    const newUrl = page.url();
    const isDoubleWrapped = newUrl.includes(encodeURIComponent('translate.google.com/translate'));
    assert(!isDoubleWrapped, `No double-wrapping of translate URL`);
    // Modern GT uses example-com.translate.goog; classic uses example.com in query param
    assert(newUrl.includes('example.com') || newUrl.includes('example-com'), 'Original domain preserved');

    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 4 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 5: Clicking list item updates recent buttons (language memory) ─
  console.log('\nTest 5: Choosing a new language moves it to top of recent list');
  try {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(500);

    // Pick Japanese (unlikely to be in defaults)
    const popup1 = await openPopup(context, extensionId);
    await popup1.fill('#searchInput', 'Japanese');
    await popup1.waitForTimeout(150);
    const jaItem = await popup1.$('.lang-item');
    assert(jaItem !== null, 'Japanese found in language list');

    const navP = page.waitForURL(/(translate\.google\.com|\.translate\.goog)/, { timeout: 10000 }).catch(() => null);
    try { await jaItem.click(); } catch (e) { /* popup closes via window.close() — expected */ }
    await navP;
    await page.waitForTimeout(500);

    // Reopen popup and check Japanese is now first recent
    const popup2 = await openPopup(context, extensionId);
    const newRecent = await popup2.$$('.recent-btn');
    const firstLabel = (await newRecent[0].textContent()).trim();
    assert(firstLabel === 'Japanese', `Japanese is now first recent button (got: "${firstLabel}")`);
    assert(newRecent.length === 3, 'Still 3 recent buttons after adding Japanese');

    await popup2.close();
    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 5 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 6: Show original bar appears on translated pages ──────────────
  console.log('\nTest 6: "Show original" bar appears when on a translated page');
  try {
    const page = await context.newPage();
    const translateUrl = 'https://translate.google.com/translate?sl=auto&tl=vi&u=https%3A%2F%2Fexample.com%2F';
    await page.goto(translateUrl);
    await page.waitForTimeout(1000);

    const popup = await openPopup(context, extensionId);
    const bar = await popup.$('#showOriginalBar');
    const barVisible = bar ? !(await bar.getAttribute('class')).includes('hidden') : false;
    assert(barVisible, '"Show original" bar is visible on a translated page');

    const btn = await popup.$('#showOriginalBtn');
    assert(btn !== null, '"Show original" button exists');

    await popup.close();
    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 6 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 7: Pin/unpin a language adds/removes it from favorites ─────────
  console.log('\nTest 7: Pin/unpin language updates favorites section');
  try {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(500);

    // Open popup — favorites section should be hidden initially
    const popup1 = await openPopup(context, extensionId);
    const favSection = await popup1.$('#favoritesSection');
    const initialClass = await favSection.getAttribute('class');
    assert(initialClass.includes('hidden'), 'Favorites section is hidden when no languages pinned');

    // Find the star next to French and click it
    await popup1.fill('#searchInput', 'French');
    await popup1.waitForTimeout(150);
    const frenchStar = await popup1.$('.star-btn');
    assert(frenchStar !== null, 'Star button found for French');
    await frenchStar.click();
    await popup1.waitForTimeout(200);

    const favSectionAfterPin = await popup1.$('#favoritesSection');
    const classAfterPin = await favSectionAfterPin.getAttribute('class');
    assert(!classAfterPin.includes('hidden'), 'Favorites section is visible after pinning');
    const favBtns = await popup1.$$('.fav-btn');
    assert(favBtns.length === 1, `Favorites has 1 button (got ${favBtns.length})`);

    // Unpin — click the star again (now filled/pinned)
    await frenchStar.click();
    await popup1.waitForTimeout(200);
    const classAfterUnpin = await favSectionAfterPin.getAttribute('class');
    assert(classAfterUnpin.includes('hidden'), 'Favorites section hidden after unpinning');

    await popup1.close();
    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 7 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 8: Hover tooltip and highlight on translated page ─────────────
  console.log('\nTest 8: Hover over word shows tooltip above paragraph with highlight');
  try {
    // Intercept the page navigation to return stable test HTML
    const TEST_ORIGIN = 'https://de-m-wikipedia-org.translate.goog';
    const TEST_URL = `${TEST_ORIGIN}/wiki/Berlin?_x_tr_sl=de&_x_tr_tl=en&_x_tr_hl=en`;

    await context.route(`${TEST_ORIGIN}/**`, async route => {
      if (route.request().resourceType() === 'document') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Berlin</title></head>
<body>
<div style="height:200px"></div>
<p id="target">Berlin is the capital and largest city of Germany.</p>
</body>
</html>`,
        });
      } else {
        await route.continue().catch(() => {});
      }
    });

    // Mock the translate API so any query returns a known word
    await context.route('https://translate.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([[['Hauptstadt', 'capital', null, null]], null, 'en']),
      });
    });

    const page = await context.newPage();
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);

    // Find the viewport position of the word "capital" in the test paragraph
    const wordPos = await page.evaluate(() => {
      const para = document.getElementById('target');
      if (!para || !para.firstChild) return null;
      const text = para.firstChild.textContent;
      const idx = text.indexOf('capital');
      if (idx === -1) return null;
      const range = document.createRange();
      range.setStart(para.firstChild, idx);
      range.setEnd(para.firstChild, idx + 'capital'.length);
      const r = range.getBoundingClientRect();
      const pr = para.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, paraTop: pr.top, paraBottom: pr.bottom };
    });

    assert(wordPos !== null, 'Test paragraph found and "capital" word located');

    if (wordPos) {
      // Hover for 1.5 s without moving
      await page.mouse.move(wordPos.x, wordPos.y);
      await page.waitForTimeout(1500);

      const markExists = await page.evaluate(() => !!document.getElementById('__qtrans_mark__'));
      assert(markExists, 'Word highlight overlay (#__qtrans_mark__) appears after 1 s hover');

      const tooltipInfo = await page.evaluate(() => {
        const el = document.getElementById('__qtrans_hover__');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), top: r.top, bottom: r.bottom };
      });
      assert(tooltipInfo !== null, 'Tooltip (#__qtrans_hover__) appears after 1 s hover');

      if (tooltipInfo) {
        assert(
          tooltipInfo.text.includes('Hauptstadt'),
          `Tooltip shows mocked original word — got: "${tooltipInfo.text}"`
        );
        // Tooltip must not overlap the paragraph — either fully above or fully below
        const abovePara = tooltipInfo.bottom <= wordPos.paraTop + 2;
        const belowPara = tooltipInfo.top >= wordPos.paraBottom - 2;
        assert(
          abovePara || belowPara,
          `Tooltip (${Math.round(tooltipInfo.top)}–${Math.round(tooltipInfo.bottom)}px) does not overlap paragraph (${Math.round(wordPos.paraTop)}–${Math.round(wordPos.paraBottom)}px)`
        );
      }

      // Move mouse away — both elements should be removed
      await page.mouse.move(10, 10);
      await page.waitForTimeout(200);
      const markGone = await page.evaluate(() => !document.getElementById('__qtrans_mark__'));
      const tooltipGone = await page.evaluate(() => !document.getElementById('__qtrans_hover__'));
      assert(markGone, 'Highlight overlay removed when mouse moves away');
      assert(tooltipGone, 'Tooltip removed when mouse moves away');
    }

    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 8 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 9: GT popup suppression hides injected GT elements ────────────
  console.log('\nTest 9: GT popup suppression hides injected GT popup elements');
  try {
    const page = await context.newPage();
    await page.goto(`https://de-m-wikipedia-org.translate.goog/wiki/Berlin?_x_tr_sl=de&_x_tr_tl=en`, {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
    await page.waitForTimeout(800);

    // Inject a fake GT popup element — the observer should hide it immediately.
    const hidden = await page.evaluate(() => {
      const fake = document.createElement('div');
      fake.className = 'gt-baf-container';
      fake.style.cssText = 'position:fixed;top:100px;left:100px;width:200px;height:100px;display:block;';
      fake.textContent = 'Fake GT popup';
      document.body.appendChild(fake);
      // Give the MutationObserver one microtask tick to react.
      return new Promise(resolve => {
        setTimeout(() => {
          const style = window.getComputedStyle(fake);
          resolve({ display: fake.style.display, pointerEvents: fake.style.pointerEvents });
        }, 100);
      });
    });

    assert(
      hidden.display === 'none',
      `GT popup suppressed (display: ${hidden.display})`
    );

    await page.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 9 threw: ${e.message}`);
    failed++;
  }

  // ─── Test 10: Selection mode shows tooltip for selected text ─────────────
  console.log('\nTest 10: Selecting text shows tooltip after 1 s (selection mode)');
  try {
    // Enable selection mode in storage before opening the page.
    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await settingsPage.waitForLoadState('domcontentloaded');
    await settingsPage.evaluate(() =>
      chrome.storage.sync.set({ selectionOriginalEnabled: true })
    );
    await settingsPage.close();

    const TEST_ORIGIN2 = 'https://de-m-wikipedia-org.translate.goog';
    const TEST_URL2 = `${TEST_ORIGIN2}/wiki/Test2?_x_tr_sl=de&_x_tr_tl=en&_x_tr_hl=en`;

    // Reuse existing mocked routes from test 8.
    const page = await context.newPage();
    await page.goto(TEST_URL2, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);

    // Programmatically select "capital" in the paragraph.
    const selPos = await page.evaluate(() => {
      const para = document.getElementById('target');
      if (!para || !para.firstChild) return null;
      const text = para.firstChild.textContent;
      const idx = text.indexOf('capital');
      if (idx === -1) return null;
      const range = document.createRange();
      range.setStart(para.firstChild, idx);
      range.setEnd(para.firstChild, idx + 'capital'.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const r = range.getBoundingClientRect();
      return { top: r.top };
    });

    assert(selPos !== null, 'Text selected programmatically');

    // Wait 1.5 s for the selection timer to fire.
    await page.waitForTimeout(1500);

    const tooltipInfo2 = await page.evaluate(() => {
      const el = document.getElementById('__qtrans_hover__');
      if (!el) return null;
      return { text: el.textContent.trim() };
    });

    assert(tooltipInfo2 !== null, 'Tooltip appears after 1 s selection');
    if (tooltipInfo2) {
      assert(
        tooltipInfo2.text.includes('Hauptstadt'),
        `Tooltip shows mocked original for selection — got: "${tooltipInfo2.text}"`
      );
    }

    // Clear selection — tooltip should disappear.
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.waitForTimeout(200);
    const gone = await page.evaluate(() => !document.getElementById('__qtrans_hover__'));
    assert(gone, 'Tooltip removed when selection is cleared');

    await page.close();
    // Reset selection mode setting via extension popup page.
    const resetPage = await context.newPage();
    await resetPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await resetPage.waitForLoadState('domcontentloaded');
    await resetPage.evaluate(() => chrome.storage.sync.set({ selectionOriginalEnabled: false }));
    await resetPage.close();
  } catch (e) {
    console.log(`  ${FAIL} Test 10 threw: ${e.message}`);
    failed++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  const total = passed + failed;
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : `${failed} failed`} / ${total} total`);

  if (failed === 0) {
    console.log('\n\x1b[32mAll tests passed! The extension is working correctly. ✓\x1b[0m\n');
  } else {
    console.log('\n\x1b[31mSome tests failed. See output above for details.\x1b[0m\n');
  }

  await context.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
