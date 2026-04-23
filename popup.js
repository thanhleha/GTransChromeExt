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

async function translatePage(langCode) {
  const tab = await getActiveTab();

  let translateUrl;
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname.endsWith('.translate.goog')) {
      // Modern Google Translate page — swap language in-place instead of re-wrapping
      parsed.searchParams.set('_x_tr_sl', 'auto');
      parsed.searchParams.set('_x_tr_tl', langCode);
      translateUrl = parsed.toString();
    } else {
      const originalUrl = getOriginalUrl(tab.url);
      if (!isTranslatableUrl(originalUrl)) {
        showError();
        return;
      }
      translateUrl = `https://translate.google.com/translate?sl=auto&tl=${langCode}&u=${encodeURIComponent(originalUrl)}`;
    }
  } catch (e) {
    showError();
    return;
  }

  await saveRecentLanguage(langCode);
  chrome.tabs.update(tab.id, { url: translateUrl });
  window.close();
}

function showError() {
  document.getElementById('errorMsg').classList.remove('hidden');
  document.getElementById('mainContent').classList.add('hidden');
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

function renderLanguageList(filter = '') {
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
    item.innerHTML = `<span class="lang-item-name">${lang.name}</span><span class="lang-item-code">${lang.code}</span>`;
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

async function showOriginalPage(tab) {
  try {
    const { hostname } = new URL(tab.url);
    if (hostname.endsWith('.translate.goog')) {
      chrome.tabs.goBack(tab.id);
    } else {
      const origUrl = new URL(tab.url).searchParams.get('u');
      if (origUrl) chrome.tabs.update(tab.id, { url: origUrl });
    }
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

  if (isTranslatedPage(tab.url)) {
    const bar = document.getElementById('showOriginalBar');
    bar.classList.remove('hidden');
    document.getElementById('showOriginalBtn').addEventListener('click', () => showOriginalPage(tab));
  }

  const recent = await getRecentLanguages();
  renderRecentButtons(recent);
  renderLanguageList();

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => renderLanguageList(searchInput.value));
  searchInput.focus();
}

document.addEventListener('DOMContentLoaded', init);
