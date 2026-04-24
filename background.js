chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    ['recentLanguages', 'triggerMode', 'hideGTPopup', 'autoTranslateLinks', 'useWrapperFallback'],
    result => {
      const updates = {};
      if (!result.recentLanguages) updates.recentLanguages = ['vi', 'en', 'fr'];
      if (result.triggerMode === undefined) updates.triggerMode = 'hover';
      if (result.hideGTPopup === undefined) updates.hideGTPopup = true;
      if (result.autoTranslateLinks === undefined) updates.autoTranslateLinks = false;
      if (result.useWrapperFallback === undefined) updates.useWrapperFallback = false;
      if (Object.keys(updates).length) chrome.storage.sync.set(updates);
    }
  );
});

// ─── Per-tab translated-language tracking ─────────────────────────────────
// When content.js translates a page in-place it tells us the target language
// for that tab. On a subsequent same-tab navigation we look the language up
// and — if the user has "auto-translate followed links" enabled — re-inject
// content.js and re-translate the new page into the same language.
// chrome.storage.session is in-memory and clears on browser restart, which
// matches tab lifetime better than chrome.storage.local.

const TAB_KEY = id => `tab:${id}`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || !sender.tab) return;
  const key = TAB_KEY(sender.tab.id);

  if (msg.type === 'qtrans/set-tab-lang') {
    chrome.storage.session.set({ [key]: msg.targetLang })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'qtrans/clear-tab-lang') {
    chrome.storage.session.remove(key)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(TAB_KEY(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('http')) return;

  // Skip wrapper URLs — the static content_scripts match handles those.
  try {
    const u = new URL(tab.url);
    if (u.hostname.endsWith('.translate.goog')) return;
    if (u.hostname === 'translate.google.com') return;
  } catch (e) {
    return;
  }

  const key = TAB_KEY(tabId);
  const stored = await chrome.storage.session.get([key]).catch(() => ({}));
  const targetLang = stored[key];
  if (!targetLang) return;

  const settings = await chrome.storage.sync.get(['autoTranslateLinks']).catch(() => ({}));
  if (!settings.autoTranslateLinks) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content.js'],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'qtrans/translate-in-place',
      targetLang,
    });
  } catch (e) {
    // Page rejected injection (chrome://, PDF viewer, etc.) — nothing to do.
  }
});
