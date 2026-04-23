(function () {
  'use strict';

  let hoverTimer = null;
  let enabled = true;
  let resolvedSourceLang = null;   // cached after first successful detection
  let sourceLangPending = null;    // in-flight promise so we don't double-fetch

  chrome.storage.sync.get(['hoverOriginalEnabled'], result => {
    enabled = result.hoverOriginalEnabled !== false;
  });

  chrome.storage.onChanged.addListener(changes => {
    if ('hoverOriginalEnabled' in changes) {
      enabled = changes.hoverOriginalEnabled.newValue !== false;
    }
  });

  function getPageLangs() {
    const params = new URLSearchParams(window.location.search);
    return {
      sourceLang: params.get('_x_tr_sl') || 'auto',
      targetLang: params.get('_x_tr_tl') || 'auto',
    };
  }

  // Try every reasonable metadata source for the original page language.
  // Falls back to an API call against untranslated text snippets in the DOM.
  async function resolveSourceLanguage(targetLang) {
    if (resolvedSourceLang) return resolvedSourceLang;
    if (sourceLangPending) return sourceLangPending;

    sourceLangPending = (async () => {
      const check = code => {
        const c = (code || '').split(/[-_]/)[0].toLowerCase();
        return c && c !== targetLang ? c : null;
      };

      // 1. _x_tr_sl URL param (already handled by caller but double-check)
      const slParam = new URLSearchParams(window.location.search).get('_x_tr_sl');
      if (slParam && slParam !== 'auto') return (resolvedSourceLang = slParam);

      // 2. <html lang>
      let lang = check(document.documentElement.getAttribute('lang'));
      if (lang) return (resolvedSourceLang = lang);

      // 3. og:locale
      lang = check(document.querySelector('meta[property="og:locale"]')?.getAttribute('content'));
      if (lang) return (resolvedSourceLang = lang);

      // 4. http-equiv content-language
      lang = check(document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content'));
      if (lang) return (resolvedSourceLang = lang);

      // 5. hreflang links (skip x-default)
      for (const link of document.querySelectorAll('link[hreflang]')) {
        lang = check(link.getAttribute('hreflang'));
        if (lang) return (resolvedSourceLang = lang);
      }

      // 6. API-based detection using untranslated text (notranslate / code blocks)
      //    These elements are left in the original language by Google Translate.
      const samples = [];
      document.querySelectorAll(
        '.notranslate, [translate="no"], code, pre, [class*="code"]'
      ).forEach(el => {
        const t = (el.textContent || '').trim();
        // Only plain text that has letters (skip numbers-only / symbols-only)
        if (t.length >= 4 && /[a-zA-Z]{3}/.test(t)) samples.push(t.slice(0, 40));
      });

      for (const sample of samples.slice(0, 3)) {
        try {
          const url =
            `https://translate.googleapis.com/translate_a/single` +
            `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t` +
            `&q=${encodeURIComponent(sample)}`;
          const resp = await fetch(url);
          const data = await resp.json();
          lang = check(data?.[2]);
          if (lang) return (resolvedSourceLang = lang);
        } catch (_) {}
      }

      return null;
    })();

    return sourceLangPending;
  }

  // Returns the word under (x,y), its Range, and its bounding rect.
  function getWordInfoAtPoint(x, y) {
    const caret = document.caretRangeFromPoint(x, y);
    if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const node = caret.startContainer;
    const text = node.textContent;
    const offset = caret.startOffset;

    let start = offset;
    let end = offset;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;

    const word = text.slice(start, end).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (word.length < 2) return null;

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);

    return { word, range, rect: range.getBoundingClientRect() };
  }

  async function fetchOriginalWord(word, readingLang, originalLang) {
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${encodeURIComponent(readingLang)}&tl=${encodeURIComponent(originalLang)}` +
      `&dt=t&q=${encodeURIComponent(word)}`;

    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    const translated = data?.[0]?.[0]?.[0];
    if (!translated || translated.toLowerCase() === word.toLowerCase()) return null;
    return translated;
  }

  // Overlay drawn at the word rect — no DOM modification, works on GT's nested <font> markup.
  function addPageHighlight(wordRect) {
    removePageHighlight();
    const el = document.createElement('div');
    el.id = '__qtrans_mark__';
    el.style.cssText = [
      'all:initial',
      'position:fixed',
      'z-index:2147483646',
      `left:${Math.round(wordRect.left - 2)}px`,
      `top:${Math.round(wordRect.top - 1)}px`,
      `width:${Math.round(wordRect.width + 4)}px`,
      `height:${Math.round(wordRect.height + 2)}px`,
      'background:rgba(254,240,138,0.7)',
      'border-radius:3px',
      'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(el);
  }

  function removePageHighlight() {
    document.getElementById('__qtrans_mark__')?.remove();
  }

  // Tooltip anchored just above the hovered word's line.
  // If no room above (near viewport top), flips just below the word instead.
  // This avoids the "block ancestor is too tall → tooltip lands at page bottom" bug.
  function createTooltip(wordRect, originalWord, langCode) {
    removeTooltipEl();

    const el = document.createElement('div');
    el.id = '__qtrans_hover__';
    el.style.cssText = [
      'all:initial',
      'position:fixed',
      'z-index:2147483647',
      'background:#303134',
      'color:#e8eaed',
      'border-radius:6px',
      'padding:5px 10px 6px',
      'font:400 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'pointer-events:none',
      'max-width:260px',
      'word-break:break-word',
      'box-shadow:0 2px 10px rgba(0,0,0,.4)',
      'opacity:0',
      'transition:opacity .1s ease',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#9aa0a6;margin-bottom:2px;';
    label.textContent = `Original (${langCode})`;

    const wordEl = document.createElement('div');
    wordEl.style.cssText = 'font-weight:600;font-size:14px;';
    wordEl.textContent = originalWord;

    el.append(label, wordEl);
    document.documentElement.appendChild(el);

    requestAnimationFrame(() => {
      const tw = el.offsetWidth;
      const th = el.offsetHeight;
      const GAP = 6;

      // Center horizontally on the word.
      let left = wordRect.left + wordRect.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

      // Place above the word's top edge; flip below if too close to viewport top.
      let top = wordRect.top - th - GAP;
      if (top < 8) top = wordRect.bottom + GAP;

      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.opacity = '1';
    });
  }

  function removeTooltipEl() {
    document.getElementById('__qtrans_hover__')?.remove();
  }

  function removeAll() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    removeTooltipEl();
    removePageHighlight();
  }

  let lastX = 0;
  let lastY = 0;

  document.addEventListener('mousemove', e => {
    lastX = e.clientX;
    lastY = e.clientY;

    clearTimeout(hoverTimer);
    removeTooltipEl();
    removePageHighlight();

    if (!enabled) return;

    hoverTimer = setTimeout(async () => {
      const info = getWordInfoAtPoint(lastX, lastY);
      if (!info) return;

      let { sourceLang, targetLang } = getPageLangs();
      if (targetLang === 'auto') return;

      if (sourceLang === 'auto') {
        sourceLang = await resolveSourceLanguage(targetLang);
        if (!sourceLang) return;
      }

      if (sourceLang === targetLang) return;

      try {
        const original = await fetchOriginalWord(info.word, targetLang, sourceLang);
        if (original) {
          addPageHighlight(info.rect);
          createTooltip(info.rect, original, sourceLang);
        }
      } catch (_) {}
    }, 1000);
  }, { passive: true });

  document.addEventListener('mouseleave', removeAll);
  document.addEventListener('scroll', removeAll, { passive: true, capture: true });
  document.addEventListener('keydown', removeAll);
})();
