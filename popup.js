const DEFAULT_RECENT = ['vi', 'en', 'fr'];

function getLangName(code) {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

async function getRecentLanguages() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['recentLanguages'], result => {
      resolve(result.recentLanguages || DEFAULT_RECENT);
    });
  });
}

async function getPinnedLanguages() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['pinnedLanguages'], result => {
      resolve(result.pinnedLanguages || []);
    });
  });
}

async function togglePinnedLanguage(code) {
  const pinned = await getPinnedLanguages();
  const updated = pinned.includes(code) ? pinned.filter(c => c !== code) : [...pinned, code];
  return new Promise(resolve => {
    chrome.storage.sync.set({ pinnedLanguages: updated }, () => resolve(updated));
  });
}

async function saveRecentLanguage(code) {
  const recent = await getRecentLanguages();
  const updated = [code, ...recent.filter(c => c !== code)].slice(0, 3);
  return new Promise(resolve => {
    chrome.storage.sync.set({ recentLanguages: updated }, resolve);
  });
}

function getOriginalUrl(url) {
  // If already on a Google Translate page, extract the original URL
  try {
    if (url.includes('translate.google.com/translate')) {
      const params = new URL(url).searchParams;
      return params.get('u') || url;
    }
    if (url.includes('translate.googleusercontent.com')) {
      const params = new URL(url).searchParams;
      return params.get('u') || url;
    }
  } catch (e) {
    // fall through
  }
  return url;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
    return tab;
  }
  // Fallback: popup opened as a standalone page (e.g., automated tests) — the
  // active tab is the popup itself, so find the first real tab instead.
  const allTabs = await chrome.tabs.query({});
  return allTabs.find(t =>
    t.url &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('about:')
  ) || tab;
}

function isTranslatableUrl(url) {
  if (!url) return false;
  const blocked = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://', 'file://'];
  if (blocked.some(prefix => url.startsWith(prefix))) return false;
  try {
    const { hostname } = new URL(url);
    if (hostname === 'translate.google.com' || hostname === 'translate.googleusercontent.com') return false;
  } catch (e) {
    return false;
  }
  return true;
}

async function getUseWrapperFallback() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['useWrapperFallback'], result => {
      resolve(result.useWrapperFallback === true);
    });
  });
}

async function translateInPlace(tab, langCode) {
  // Inject content.js on demand — the manifest only statically injects it on
  // .translate.goog pages. The script guards against double-load.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'qtrans/translate-in-place',
      targetLang: langCode,
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function translatePage(langCode) {
  const tab = await getActiveTab();

  let parsed;
  try {
    parsed = new URL(tab.url);
  } catch (e) {
    showError();
    return;
  }

  // Case 1: already on a .translate.goog wrapper page — swap target language
  // in place. This works regardless of the fallback toggle, because the user
  // is already inside the wrapper and re-translating is the natural action.
  if (parsed.hostname.endsWith('.translate.goog')) {
    parsed.searchParams.set('_x_tr_sl', 'auto');
    parsed.searchParams.set('_x_tr_tl', langCode);
    await saveRecentLanguage(langCode);
    chrome.tabs.update(tab.id, { url: parsed.toString() });
    window.close();
    return;
  }

  const originalUrl = getOriginalUrl(tab.url);
  if (!isTranslatableUrl(originalUrl)) {
    showError();
    return;
  }

  const useWrapper = await getUseWrapperFallback();

  // Case 2: fallback toggle on — navigate to the wrapper (legacy behavior).
  if (useWrapper) {
    const translateUrl = `https://translate.google.com/translate?sl=auto&tl=${langCode}&u=${encodeURIComponent(originalUrl)}`;
    await saveRecentLanguage(langCode);
    chrome.tabs.update(tab.id, { url: translateUrl });
    window.close();
    return;
  }

  // Case 3: in-place translation. Inject content.js and message it.
  await saveRecentLanguage(langCode);
  translateInPlace(tab, langCode);  // fire-and-forget; popup closes immediately
  window.close();
}

function showError() {
  document.getElementById('errorMsg').classList.remove('hidden');
  document.getElementById('mainContent').classList.add('hidden');
}

function renderFavorites(pinnedCodes) {
  const section = document.getElementById('favoritesSection');
  const divider = document.getElementById('favoritesDivider');
  const container = document.getElementById('favButtons');
  container.innerHTML = '';

  if (pinnedCodes.length === 0) {
    section.classList.add('hidden');
    divider.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  divider.classList.remove('hidden');

  pinnedCodes.forEach(code => {
    const btn = document.createElement('button');
    btn.className = 'fav-btn';
    btn.textContent = getLangName(code);
    btn.title = `Translate to ${getLangName(code)}`;
    btn.dataset.lang = code;
    btn.addEventListener('click', () => translatePage(code));
    container.appendChild(btn);
  });
}

function renderRecentButtons(recentCodes) {
  const container = document.getElementById('recentButtons');
  container.innerHTML = '';
  recentCodes.forEach(code => {
    const btn = document.createElement('button');
    btn.className = 'recent-btn';
    btn.textContent = getLangName(code);
    btn.title = `Translate to ${getLangName(code)}`;
    btn.addEventListener('click', () => translatePage(code));
    container.appendChild(btn);
  });
}

function renderLanguageList(filter = '', pinned = []) {
  const container = document.getElementById('languageList');
  const lower = filter.toLowerCase().trim();
  const filtered = lower
    ? LANGUAGES.filter(l => l.name.toLowerCase().includes(lower) || l.code.toLowerCase().includes(lower))
    : LANGUAGES;

  container.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.textContent = 'No languages found';
    container.appendChild(empty);
    return;
  }

  filtered.forEach(lang => {
    const item = document.createElement('div');
    item.className = 'lang-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'lang-item-name';
    nameSpan.textContent = lang.name;

    const codeSpan = document.createElement('span');
    codeSpan.className = 'lang-item-code';
    codeSpan.textContent = lang.code;

    const star = document.createElement('button');
    star.className = 'star-btn' + (pinned.includes(lang.code) ? ' pinned' : '');
    star.textContent = '★';
    star.title = pinned.includes(lang.code) ? 'Remove from favorites' : 'Add to favorites';
    star.dataset.lang = lang.code;
    star.addEventListener('click', async e => {
      e.stopPropagation();
      const newPinned = await togglePinnedLanguage(lang.code);
      star.classList.toggle('pinned', newPinned.includes(lang.code));
      star.title = newPinned.includes(lang.code) ? 'Remove from favorites' : 'Add to favorites';
      renderFavorites(newPinned);
    });

    item.append(nameSpan, codeSpan, star);
    item.addEventListener('click', () => translatePage(lang.code));
    container.appendChild(item);
  });
}

function isTranslatedPage(url) {
  try {
    const { hostname, href } = new URL(url);
    return hostname.endsWith('.translate.goog') || href.includes('translate.google.com/translate');
  } catch (e) {
    return false;
  }
}

async function isInPlaceTranslated(tab) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.querySelector('meta[name="qtrans-translation"]'),
    });
    return !!results?.[0]?.result;
  } catch (e) {
    return false;
  }
}

async function showOriginalPage(tab) {
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname.endsWith('.translate.goog')) {
      chrome.tabs.goBack(tab.id);
      window.close();
      return;
    }
    if (parsed.href.includes('translate.google.com/translate')) {
      const origUrl = parsed.searchParams.get('u');
      if (origUrl) chrome.tabs.update(tab.id, { url: origUrl });
      window.close();
      return;
    }
    // In-place translated page — restore text nodes without navigating.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'qtrans/restore-original' });
    } catch (e) {}
  } catch (e) {}
  window.close();
}

async function init() {
  const tab = await getActiveTab();
  const originalUrl = getOriginalUrl(tab.url);

  if (!isTranslatableUrl(originalUrl)) {
    showError();
    return;
  }

  const showBar = isTranslatedPage(tab.url) || await isInPlaceTranslated(tab);
  if (showBar) {
    const bar = document.getElementById('showOriginalBar');
    bar.classList.remove('hidden');
    document.getElementById('showOriginalBtn').addEventListener('click', () => showOriginalPage(tab));
  }

  const [recent, pinned] = await Promise.all([getRecentLanguages(), getPinnedLanguages()]);
  renderFavorites(pinned);
  renderRecentButtons(recent);
  renderLanguageList('', pinned);

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', async () => {
    const currentPinned = await getPinnedLanguages();
    renderLanguageList(searchInput.value, currentPinned);
  });
  searchInput.focus();

  chrome.storage.sync.get(
    ['hideGTPopup', 'triggerMode', 'autoTranslateLinks', 'useWrapperFallback'],
    result => {
      const hideEl = document.getElementById('hideGTPopupToggle');
      hideEl.checked = result.hideGTPopup !== false;
      hideEl.addEventListener('change', () => chrome.storage.sync.set({ hideGTPopup: hideEl.checked }));

      const autoEl = document.getElementById('autoTranslateLinksToggle');
      autoEl.checked = result.autoTranslateLinks === true;
      autoEl.addEventListener('change', () => chrome.storage.sync.set({ autoTranslateLinks: autoEl.checked }));

      const wrapEl = document.getElementById('useWrapperFallbackToggle');
      wrapEl.checked = result.useWrapperFallback === true;
      wrapEl.addEventListener('change', () => chrome.storage.sync.set({ useWrapperFallback: wrapEl.checked }));

      const mode = result.triggerMode || 'hover';
      document.querySelectorAll('#triggerModeCtrl .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
        btn.addEventListener('click', () => {
          document.querySelectorAll('#triggerModeCtrl .seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          chrome.storage.sync.set({ triggerMode: btn.dataset.mode });
        });
      });
    }
  );
}

document.addEventListener('DOMContentLoaded', init);
