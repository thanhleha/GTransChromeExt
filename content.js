(function () {
  'use strict';

  // ─── Settings ─────────────────────────────────────────────────────────────
  let hoverEnabled = true;
  let selectionEnabled = false;
  let hideGTPopup = true;
  let resolvedSourceLang = null;
  let sourceLangPending = null;

  function applySettings(s) {
    const mode = s.triggerMode || 'hover';
    hoverEnabled = mode === 'hover';
    selectionEnabled = mode === 'selection';
    const nextHide = s.hideGTPopup !== false;
    if (nextHide !== hideGTPopup || !gtObserver) {
      hideGTPopup = nextHide;
      hideGTPopup ? startGTSuppression() : stopGTSuppression();
    }
  }

  chrome.storage.sync.get(
    ['triggerMode', 'hideGTPopup'],
    result => applySettings(result)
  );

  chrome.storage.onChanged.addListener(changes => {
    const next = {
      triggerMode: hoverEnabled ? 'hover' : 'selection',
      hideGTPopup,
    };
    if ('triggerMode' in changes) next.triggerMode = changes.triggerMode.newValue;
    if ('hideGTPopup' in changes) next.hideGTPopup = changes.hideGTPopup.newValue;
    applySettings(next);
  });

  // ─── GT Popup Suppression ─────────────────────────────────────────────────
  // Hides the "Original text" popup that Google Translate injects on
  // .translate.goog pages when you hover/click translated text.

  // Selector targets only actual GT popup containers, not content-level elements.
  const GT_SEL = [
    '.gt-baf-container',
    '.goog-te-bubble',
    '.goog-tooltip',
    '#goog-gt-tt',
  ].join(',');

  let gtObserver = null;

  function suppressEl(el) {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  function isGTPopupNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const c = (node.getAttribute('class') || '') + ' ' + (node.getAttribute('id') || '');
    return /gt-baf-container|goog-te-bubble|goog-tooltip|goog-gt-tt/i.test(c);
  }

  function injectGTSuppressCSS() {
    if (document.getElementById('__qtrans_css__')) return;
    const style = document.createElement('style');
    style.id = '__qtrans_css__';
    // Clear GT's blue paragraph hover highlight without hiding the paragraph.
    style.textContent = '[class*="gt-baf"]{background:transparent!important;background-color:transparent!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function startGTSuppression() {
    if (gtObserver) return;
    injectGTSuppressCSS();
    // Hide any already-present GT popup containers.
    document.querySelectorAll(GT_SEL).forEach(suppressEl);

    gtObserver = new MutationObserver(mutations => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (isGTPopupNode(node)) suppressEl(node);
          node.querySelectorAll?.(GT_SEL).forEach(suppressEl);
        }
        // Catch GT popups made visible via inline style change.
        if (mut.type === 'attributes' && isGTPopupNode(mut.target)) {
          suppressEl(mut.target);
        }
      }
    });

    gtObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  function stopGTSuppression() {
    gtObserver?.disconnect();
    gtObserver = null;
    document.getElementById('__qtrans_css__')?.remove();
  }

  // ─── Language detection ───────────────────────────────────────────────────

  function getPageLangs() {
    const p = new URLSearchParams(window.location.search);
    return { sourceLang: p.get('_x_tr_sl') || 'auto', targetLang: p.get('_x_tr_tl') || 'auto' };
  }

  async function resolveSourceLanguage(targetLang) {
    if (resolvedSourceLang) return resolvedSourceLang;
    if (sourceLangPending) return sourceLangPending;

    sourceLangPending = (async () => {
      const ck = raw => {
        const c = (raw || '').split(/[-_]/)[0].toLowerCase();
        return c && c !== targetLang ? c : null;
      };

      const slParam = new URLSearchParams(window.location.search).get('_x_tr_sl');
      if (slParam && slParam !== 'auto') return (resolvedSourceLang = slParam);

      let lang;
      lang = ck(document.documentElement.getAttribute('lang'));
      if (lang) return (resolvedSourceLang = lang);

      lang = ck(document.querySelector('meta[property="og:locale"]')?.getAttribute('content'));
      if (lang) return (resolvedSourceLang = lang);

      lang = ck(document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content'));
      if (lang) return (resolvedSourceLang = lang);

      for (const link of document.querySelectorAll('link[hreflang]')) {
        lang = ck(link.getAttribute('hreflang'));
        if (lang) return (resolvedSourceLang = lang);
      }

      // API-based detection: use text that GT leaves untranslated (code/notranslate).
      const samples = [];
      document.querySelectorAll('.notranslate,[translate="no"],code,pre,[class*="code"]')
        .forEach(el => {
          const t = (el.textContent || '').trim();
          if (t.length >= 4 && /[a-zA-Z]{3}/.test(t)) samples.push(t.slice(0, 40));
        });

      for (const sample of samples.slice(0, 3)) {
        try {
          const url = `https://translate.googleapis.com/translate_a/single` +
            `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(sample)}`;
          const data = await (await fetch(url)).json();
          lang = ck(data?.[2]);
          if (lang) return (resolvedSourceLang = lang);
        } catch (_) {}
      }

      return null;
    })();

    return sourceLangPending;
  }

  // ─── Word / text utilities ────────────────────────────────────────────────

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

  // ─── Translation API ──────────────────────────────────────────────────────

  async function fetchOriginalText(text, readingLang, originalLang) {
    const url = `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${encodeURIComponent(readingLang)}&tl=${encodeURIComponent(originalLang)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();

    // Concatenate all translated segments in case the text spans multiple chunks.
    const segments = data?.[0];
    if (!segments) return null;
    const translated = segments.map(s => s?.[0] || '').join('').trim();
    if (!translated || translated.toLowerCase() === text.toLowerCase()) return null;
    return translated;
  }

  // ─── Overlay highlight ────────────────────────────────────────────────────

  function addPageHighlight(rect) {
    removePageHighlight();
    const el = document.createElement('div');
    el.id = '__qtrans_mark__';
    el.style.cssText = [
      'all:initial',
      'position:fixed',
      'z-index:2147483646',
      `left:${Math.round(rect.left - 2)}px`,
      `top:${Math.round(rect.top - 1)}px`,
      `width:${Math.round(rect.width + 4)}px`,
      `height:${Math.round(rect.height + 2)}px`,
      'background:rgba(254,240,138,0.7)',
      'border-radius:3px',
      'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(el);
  }

  function removePageHighlight() {
    document.getElementById('__qtrans_mark__')?.remove();
  }

  // ─── Tooltip ──────────────────────────────────────────────────────────────

  function createTooltip(anchorRect, originalText, langCode) {
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
      'max-width:280px',
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
    wordEl.textContent = originalText;

    el.append(label, wordEl);
    document.documentElement.appendChild(el);

    requestAnimationFrame(() => {
      const tw = el.offsetWidth;
      const th = el.offsetHeight;
      const GAP = 6;

      let left = anchorRect.left + anchorRect.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

      let top = anchorRect.top - th - GAP;
      if (top < 8) top = anchorRect.bottom + GAP;

      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.opacity = '1';
    });
  }

  function removeTooltipEl() {
    document.getElementById('__qtrans_hover__')?.remove();
  }

  // ─── Shared cleanup ───────────────────────────────────────────────────────

  function removeAll() {
    clearTimeout(hoverTimer);
    clearTimeout(selectionTimer);
    hoverTimer = null;
    selectionTimer = null;
    removeTooltipEl();
    removePageHighlight();
  }

  // ─── Hover mode ───────────────────────────────────────────────────────────

  let hoverTimer = null;
  let lastX = 0;
  let lastY = 0;

  document.addEventListener('mousemove', e => {
    lastX = e.clientX;
    lastY = e.clientY;

    clearTimeout(hoverTimer);
    hoverTimer = null;
    removeTooltipEl();
    removePageHighlight();

    if (!hoverEnabled) return;

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
        const original = await fetchOriginalText(info.word, targetLang, sourceLang);
        if (original) {
          addPageHighlight(info.rect);
          createTooltip(info.rect, original, sourceLang);
        }
      } catch (_) {}
    }, 1000);
  }, { passive: true });

  // ─── Selection mode ───────────────────────────────────────────────────────
  // Triggers on any text selection (double-click, drag, keyboard Shift+arrows).
  // After 1 s of stable selection, translates the selected text back to original.

  let selectionTimer = null;

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = null;

    if (!selectionEnabled) return;

    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text || text.length < 2) {
      removeTooltipEl();
      removePageHighlight();
      return;
    }

    selectionTimer = setTimeout(async () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;
      const text = sel.toString().trim();
      if (!text || text.length < 2) return;

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      let { sourceLang, targetLang } = getPageLangs();
      if (targetLang === 'auto') return;
      if (sourceLang === 'auto') {
        sourceLang = await resolveSourceLanguage(targetLang);
        if (!sourceLang) return;
      }
      if (sourceLang === targetLang) return;

      try {
        const original = await fetchOriginalText(text, targetLang, sourceLang);
        if (original) {
          // No custom highlight overlay for selections — browser highlight is sufficient.
          createTooltip(rect, original, sourceLang);
        }
      } catch (_) {}
    }, 1000);
  });

  document.addEventListener('mouseleave', removeAll);
  document.addEventListener('scroll', removeAll, { passive: true, capture: true });
  document.addEventListener('keydown', e => {
    // Don't cancel on Shift (used for keyboard text selection).
    if (!e.shiftKey) removeAll();
  });
})();
