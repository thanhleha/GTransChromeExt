(function () {
  'use strict';

  let hoverTimer = null;
  let activeTooltip = null;
  let enabled = true;
  let detectedSourceLang = null;

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
    const sourceLang = params.get('_x_tr_sl') || 'auto';
    const targetLang = params.get('_x_tr_tl') || 'auto';
    return { sourceLang, targetLang };
  }

  // When sl=auto, try to discover the original language from page metadata.
  // Google Translate often leaves og:locale and html[lang] untouched.
  function discoverSourceLang(targetLang) {
    if (detectedSourceLang) return detectedSourceLang;

    const htmlLang = document.documentElement.getAttribute('lang');
    if (htmlLang) {
      const code = htmlLang.split('-')[0].toLowerCase();
      if (code && code !== targetLang) {
        detectedSourceLang = code;
        return code;
      }
    }

    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) {
      const code = (ogLocale.getAttribute('content') || '').split('_')[0].toLowerCase();
      if (code && code !== targetLang) {
        detectedSourceLang = code;
        return code;
      }
    }

    return null;
  }

  function getWordAtPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const text = range.startContainer.textContent;
    const offset = range.startOffset;

    let start = offset;
    let end = offset;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;

    const raw = text.slice(start, end);
    // Strip leading/trailing punctuation, keep unicode letters/numbers
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return word.length >= 2 ? word : null;
  }

  async function fetchOriginalWord(word, readingLang, originalLang) {
    // Translate word FROM readingLang (what the user sees) BACK TO originalLang
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

  function createTooltip(x, y, originalWord, langCode) {
    removeTooltip();

    const el = document.createElement('div');
    el.id = '__qtrans_hover__';
    el.style.cssText = [
      'all:initial',
      'position:fixed',
      'z-index:2147483647',
      'background:#303134',
      'color:#e8eaed',
      'border-radius:6px',
      'padding:6px 10px',
      'font:400 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'pointer-events:none',
      'max-width:260px',
      'word-break:break-word',
      'box-shadow:0 2px 10px rgba(0,0,0,.4)',
      'opacity:0',
      'transition:opacity .1s ease',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#9aa0a6;margin-bottom:3px;';
    label.textContent = `Original (${langCode})`;

    const wordEl = document.createElement('div');
    wordEl.style.cssText = 'font-weight:500;';
    wordEl.textContent = originalWord;

    el.append(label, wordEl);
    document.documentElement.appendChild(el);
    activeTooltip = el;

    requestAnimationFrame(() => {
      const tw = el.offsetWidth;
      const th = el.offsetHeight;
      let left = x + 14;
      let top = y - th - 10;
      if (left + tw > window.innerWidth - 8) left = x - tw - 14;
      if (top < 8) top = y + 22;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.opacity = '1';
    });
  }

  function removeTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  let lastX = 0;
  let lastY = 0;

  document.addEventListener('mousemove', e => {
    lastX = e.clientX;
    lastY = e.clientY;

    clearTimeout(hoverTimer);
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }

    if (!enabled) return;

    hoverTimer = setTimeout(async () => {
      const word = getWordAtPoint(lastX, lastY);
      if (!word) return;

      let { sourceLang, targetLang } = getPageLangs();
      if (targetLang === 'auto') return;

      if (sourceLang === 'auto') {
        sourceLang = discoverSourceLang(targetLang);
        if (!sourceLang) return;
      }

      if (sourceLang === targetLang) return;

      try {
        const original = await fetchOriginalWord(word, targetLang, sourceLang);
        if (original) {
          createTooltip(lastX, lastY, original, sourceLang);
        }
      } catch (_) {}
    }, 1000);
  }, { passive: true });

  document.addEventListener('mouseleave', removeTooltip);
  document.addEventListener('scroll', removeTooltip, { passive: true, capture: true });
  document.addEventListener('keydown', removeTooltip);
})();
