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

// Resolve extension path — use Windows path when running under WSL2
function resolveExtensionPath(linuxPath) {
  try {
    const winPath = execSync(`wslpath -w "${linuxPath}"`, { encoding: 'utf8' }).trim();
    return winPath;
  } catch {
    return linuxPath;
  }
}

const EXT_LINUX_PATH = path.resolve(__dirname, '..');
const EXT_PATH = resolveExtensionPath(EXT_LINUX_PATH);
const CHROME_WIN = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_AVAILABLE = (() => { try { require('fs').accessSync(CHROME_WIN); return true; } catch { return false; } })();

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

  if (CHROME_AVAILABLE) {
    console.log(`${INFO} Using Windows Chrome: ${CHROME_WIN}`);
    launchOptions.executablePath = CHROME_WIN;
  } else {
    console.log(`${INFO} Using Playwright Chromium`);
  }

  const context = await chromium.launchPersistentContext('', launchOptions);

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

    const navPromise = page.waitForURL(/translate\.google\.com/, { timeout: 10000 }).catch(() => null);
    await recentBtns[0].click();
    await navPromise;
    await page.waitForTimeout(500);

    const newUrl = page.url();
    assert(
      newUrl.includes('translate.google.com/translate'),
      `Navigated to Google Translate (URL: ${newUrl.slice(0, 70)}...)`
    );
    assert(
      newUrl.includes('example.com'),
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

    const navPromise = page.waitForURL(/translate\.google\.com/, { timeout: 10000 }).catch(() => null);
    await recentBtns[1].click();
    await navPromise;
    await page.waitForTimeout(500);

    const newUrl = page.url();
    const isDoubleWrapped = newUrl.includes(encodeURIComponent('translate.google.com/translate'));
    assert(!isDoubleWrapped, `No double-wrapping of translate URL`);
    assert(newUrl.includes('example.com'), 'Original domain preserved');

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

    const navP = page.waitForURL(/translate\.google\.com/, { timeout: 10000 }).catch(() => null);
    await jaItem.click();
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
