(function () {
  'use strict';

  let hoverTimer = null;
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
    return {
      sourceLang: params.get('_x_tr_sl') || 'auto',
      targetLang: params.get('_x_tr_tl') || 'auto',
    };
  }

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

  // Returns the word under (x,y) plus its Range and bounding rect.
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

  // Walk up to the nearest block-level ancestor (p, div, h1-h6, li, td, …).
  // Used to position the tooltip above the whole block so it never overlaps
  // the lines of text below.
  function getBlockAncestor(node) {
    const BLOCKS = new Set([
      'P','DIV','ARTICLE','SECTION','MAIN','ASIDE','LI','TD','TH',
      'BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6','HEADER','FOOTER','FIGURE',
    ]);
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== document.body) {
      if (BLOCKS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return document.body;
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

  // Overlay-based highlight — no DOM modification, never fails on complex GT markup.
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
      'background:rgba(254,240,138,0.65)',
      'border-radius:3px',
      'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(el);
  }

  function removePageHighlight() {
    document.getElementById('__qtrans_mark__')?.remove();
  }

  // Tooltip is placed above the block ancestor (entire paragraph), not just above
  // the single word line, so it never covers the surrounding translated text.
  function createTooltip(wordRect, blockRect, originalWord, langCode) {
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

      // Horizontally center on the hovered word.
      let left = wordRect.left + wordRect.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

      // Vertically: above the block ancestor so no translated text is covered.
      let top = blockRect.top - th - GAP;
      if (top < 8) {
        // Not enough room above — show below the block instead.
        top = blockRect.bottom + GAP;
      }

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
        sourceLang = discoverSourceLang(targetLang);
        if (!sourceLang) return;
      }

      if (sourceLang === targetLang) return;

      try {
        const original = await fetchOriginalWord(info.word, targetLang, sourceLang);
        if (original) {
          const blockRect = getBlockAncestor(info.range.startContainer).getBoundingClientRect();
          addPageHighlight(info.rect);
          createTooltip(info.rect, blockRect, original, sourceLang);
        }
      } catch (_) {}
    }, 1000);
  }, { passive: true });

  document.addEventListener('mouseleave', removeAll);
  document.addEventListener('scroll', removeAll, { passive: true, capture: true });
  document.addEventListener('keydown', removeAll);
})();
