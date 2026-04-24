(function () {
  'use strict';

  // Guard against double-injection. The manifest statically injects this on
  // .translate.goog pages, and popup.js dynamically injects it on normal
  // pages via chrome.scripting.executeScript when the user clicks a language.
  if (window.__qtransLoaded__) return;
  window.__qtransLoaded__ = true;

  // Two modes share most of the logic here:
  //   - GT-wrapper mode: page is *.translate.goog. Suppress GT popup/highlight,
  //     rewrite outgoing links, and power hover/select-for-original against
  //     URL params.
  //   - In-place mode: any other page. Wait for a popup message to walk the
  //     DOM and replace text nodes with translations from translate.googleapis.
  //     Hover/select-for-original reads the target lang from local state.
  const IS_GT_WRAPPER = location.hostname.endsWith('.translate.goog');

  // ─── Settings ─────────────────────────────────────────────────────────────
  let hoverEnabled = true;
  let selectionEnabled = false;
  let hideGTPopup = true;
  let autoTranslateLinks;
  let resolvedSourceLang = null;
  let sourceLangPending = null;
  // Non-null only in in-place mode while a translation is active.
  let activeTargetLang = null;

  function applySettings(s) {
    const mode = s.triggerMode || 'hover';
    hoverEnabled = mode === 'hover';
    selectionEnabled = mode === 'selection';
    if (IS_GT_WRAPPER) {
      const nextHide = s.hideGTPopup !== false;
      if (nextHide !== hideGTPopup || !gtObserver) {
        hideGTPopup = nextHide;
        hideGTPopup ? startGTSuppression() : stopGTSuppression();
      }
      const nextAuto = !!s.autoTranslateLinks;
      if (nextAuto !== autoTranslateLinks) {
        autoTranslateLinks = nextAuto;
        autoTranslateLinks ? stopLinkRewriter() : startLinkRewriter();
      }
    }
  }

  chrome.storage.sync.get(
    ['triggerMode', 'hideGTPopup', 'autoTranslateLinks'],
    result => applySettings(result)
  );

  chrome.storage.onChanged.addListener(changes => {
    const next = {
      triggerMode: hoverEnabled ? 'hover' : 'selection',
      hideGTPopup,
      autoTranslateLinks,
    };
    if ('triggerMode' in changes) next.triggerMode = changes.triggerMode.newValue;
    if ('hideGTPopup' in changes) next.hideGTPopup = changes.hideGTPopup.newValue;
    if ('autoTranslateLinks' in changes) next.autoTranslateLinks = changes.autoTranslateLinks.newValue;
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
    // First-pass fallback against GT's own stylesheet rules. Cascade order can
    // still let GT win — the observer applies inline !important as the primary
    // mechanism. We broaden the selector to any gt-* / goog-te-* class because
    // the exact class name GT uses for paragraph hover highlight isn't stable.
    style.textContent =
      '[class*="gt-baf"],[class^="gt-"],[class*=" gt-"],[class*="goog-te-"]{' +
      'background:transparent!important;' +
      'background-color:transparent!important;' +
      'border-color:transparent!important;' +
      'border-left-width:0!important;' +
      'outline:none!important;' +
      'box-shadow:none!important' +
      '}';
    (document.head || document.documentElement).appendChild(style);
  }

  // Any class in the token list that starts with "gt-" or "goog-te-" implies
  // the element is part of GT's Back-and-Forth translation machinery.
  function hasGTClass(cls) {
    if (!cls) return false;
    const tokens = cls.split(/\s+/);
    for (const t of tokens) {
      if (/^gt-|^goog-te-/i.test(t)) return true;
    }
    return false;
  }

  // GT applies a very specific light-blue tint on hover. Colors observed:
  //   rgb(232, 240, 254), rgb(210, 227, 252), rgb(197, 216, 248),
  //   rgba(66, 133, 244, 0.1..0.3)
  // This predicate matches those without touching ordinary site backgrounds.
  function isGTBlueBg(el) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (!bg) return false;
    const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    const a = m[4] != null ? +m[4] : 1;
    if (a === 0) return false;
    // Opaque light-blue tint: rgb(232,240,254) etc. Blue highest, green high, red moderate.
    if (a > 0.5 && b >= 220 && g >= 200 && r >= 150 && b > r && b >= g) return true;
    // Translucent Google primary tint: rgba(66,133,244,0.1..0.3).
    if (a > 0 && a < 0.5 && b > r && b > 200 && g > r && r < 120) return true;
    return false;
  }

  function clearGTHighlight(el) {
    // Guard against observer feedback loop: only our code sets bg to
    // 'transparent' AND border-left-width to '0px'. If both already cleared,
    // GT hasn't re-applied anything since last pass — skip.
    if (
      el.style.getPropertyValue('background-color') === 'transparent' &&
      el.style.getPropertyValue('border-left-width') === '0px'
    ) return;

    // Inline !important beats any stylesheet rule regardless of cascade order.
    el.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('background-color', 'transparent', 'important');
    el.style.setProperty('background-image', 'none', 'important');
    // GT's paragraph hover also draws a left-edge blue bar via border-left.
    el.style.setProperty('border-left', '0 none transparent', 'important');
    el.style.setProperty('border-right', '0 none transparent', 'important');
    el.style.setProperty('border-top', '0 none transparent', 'important');
    el.style.setProperty('border-bottom', '0 none transparent', 'important');
    el.style.setProperty('outline', 'none', 'important');
    el.style.setProperty('box-shadow', 'none', 'important');
  }

  function shouldClearHighlight(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    // Don't touch our own injected elements (tooltip, highlight overlay, style tag).
    if (el.id && el.id.startsWith('__qtrans_')) return false;
    if (isGTPopupNode(el)) return false;
    return hasGTClass(el.getAttribute('class') || '') || isGTBlueBg(el);
  }

  function startGTSuppression() {
    if (gtObserver) return;
    injectGTSuppressCSS();
    // Hide any already-present GT popup containers.
    document.querySelectorAll(GT_SEL).forEach(suppressEl);
    // Clear highlights on any element already decorated with a gt-* class.
    document.querySelectorAll('[class*="gt-"],[class*="goog-te-"]').forEach(el => {
      if (shouldClearHighlight(el)) clearGTHighlight(el);
    });

    gtObserver = new MutationObserver(mutations => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (isGTPopupNode(node)) suppressEl(node);
          node.querySelectorAll?.(GT_SEL).forEach(suppressEl);
        }
        if (mut.type === 'attributes' && mut.target.nodeType === Node.ELEMENT_NODE) {
          const target = mut.target;
          if (isGTPopupNode(target)) {
            suppressEl(target);
          } else if (shouldClearHighlight(target)) {
            // Content element received a GT hover decoration — clear it.
            clearGTHighlight(target);
          }
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

  // ─── Link rewriter (escape the translator on click) ───────────────────────
  // On *.translate.goog pages, Google rewrites every outgoing link so the
  // next page stays inside the translator. When autoTranslateLinks is off we
  // rewrite those links back to their original URLs so clicking a link (or
  // middle-clicking, or copying the link) takes the user to the real page.

  let linkObserver = null;

  // Decode a Google-translated hostname.
  //   huggingface-co.translate.goog      → huggingface.co
  //   foo--bar-example-com.translate.goog → foo-bar.example.com
  // Google's encoding replaces '.' with '-' and '-' with '--'; reverse with
  // a placeholder so the two substitutions don't collide.
  function decodeGTHostname(host) {
    const SUFFIX = '.translate.goog';
    if (!host.endsWith(SUFFIX)) return null;
    const prefix = host.slice(0, -SUFFIX.length);
    if (!prefix) return null;
    return prefix.replace(/--/g, '\x00').replace(/-/g, '.').replace(/\x00/g, '-');
  }

  function toOriginalUrl(href) {
    try {
      const u = new URL(href, location.href);
      if (!u.hostname.endsWith('.translate.goog')) return null;
      const orig = decodeGTHostname(u.hostname);
      if (!orig) return null;
      u.hostname = orig;
      u.protocol = 'https:';
      // Google's translator params leak into the URL — strip them.
      for (const k of [...u.searchParams.keys()]) {
        if (k.startsWith('_x_tr_')) u.searchParams.delete(k);
      }
      return u.toString();
    } catch (_) {
      return null;
    }
  }

  function rewriteAnchor(a) {
    if (!a || !a.getAttribute) return;
    const orig = toOriginalUrl(a.href);
    if (!orig) return;
    if (a.getAttribute('href') !== orig) {
      // Stash the GT-wrapped form so we can restore it if the user flips
      // the setting on mid-page without reloading.
      if (!a.dataset.qtransGtHref) a.dataset.qtransGtHref = a.getAttribute('href');
      a.setAttribute('href', orig);
    }
  }

  function rewriteAllAnchors(root) {
    root.querySelectorAll?.('a[href]').forEach(rewriteAnchor);
  }

  function restoreAllAnchors() {
    document.querySelectorAll('a[data-qtrans-gt-href]').forEach(a => {
      const stored = a.dataset.qtransGtHref;
      if (stored) {
        a.setAttribute('href', stored);
        delete a.dataset.qtransGtHref;
      }
    });
  }

  function startLinkRewriter() {
    if (linkObserver) return;
    rewriteAllAnchors(document);
    linkObserver = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          if (n.tagName === 'A') rewriteAnchor(n);
          n.querySelectorAll?.('a[href]').forEach(rewriteAnchor);
        }
        if (m.type === 'attributes' && m.target.tagName === 'A') {
          rewriteAnchor(m.target);
        }
      }
    });
    linkObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
  }

  function stopLinkRewriter() {
    linkObserver?.disconnect();
    linkObserver = null;
    restoreAllAnchors();
  }

  // ─── In-place DOM translator ──────────────────────────────────────────────
  // Walks the page's text nodes, batches them, calls the public
  // translate_a/single endpoint, and replaces nodeValue in place. A
  // MutationObserver keeps the translation consistent as the page adds new
  // content (infinite scroll, SPA navigation, etc.). The original text for
  // each touched node is kept in the record so we can restore it later.

  // Block-level tags whose text should never be touched.
  const TRANSLATE_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  ]);

  const translatedNodes = [];  // [{ node, originalText, isTitle }]
  let translatorObserver = null;
  let pendingNewNodes = [];
  let pendingFlushTimer = null;

  function shouldSkipTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return true;
    const v = node.nodeValue;
    if (!v) return true;
    // Pure whitespace or no word characters at all — nothing to translate.
    if (!/\S/.test(v)) return true;
    if (!/\p{L}/u.test(v)) return true;
    let p = node.parentElement;
    while (p) {
      if (TRANSLATE_SKIP_TAGS.has(p.tagName)) return true;
      if (p.getAttribute?.('translate') === 'no') return true;
      if (p.classList?.contains('notranslate')) return true;
      if (p.id && p.id.startsWith('__qtrans_')) return true;
      if (p.getAttribute?.('contenteditable') === 'true') return true;
      p = p.parentElement;
    }
    return false;
  }

  function collectTextNodes(root) {
    if (!root) return [];
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return shouldSkipTextNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  async function translateOneApi(text, targetLang) {
    try {
      const url = 'https://translate.googleapis.com/translate_a/single' +
        '?client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(targetLang) +
        '&q=' + encodeURIComponent(text);
      const resp = await fetch(url);
      if (!resp.ok) return text;
      const data = await resp.json();
      const segs = data?.[0] || [];
      const out = segs.map(s => s?.[0] || '').join('');
      return out || text;
    } catch (_) {
      return text;
    }
  }

  // Batch multiple strings into a single request using `\n\n` as a boundary
  // marker. Google preserves paragraph breaks, so the split round-trips in
  // the common case. If the boundary count doesn't match, fall back to one
  // request per string for that batch.
  async function translateBatchApi(texts, targetLang) {
    if (texts.length === 1) {
      return [await translateOneApi(texts[0], targetLang)];
    }
    try {
      const joined = texts.join('\n\n');
      const url = 'https://translate.googleapis.com/translate_a/single' +
        '?client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(targetLang) +
        '&q=' + encodeURIComponent(joined);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('http ' + resp.status);
      const data = await resp.json();
      const segs = data?.[0] || [];
      const out = segs.map(s => s?.[0] || '').join('');
      const parts = out.split(/\n\n+/);
      if (parts.length === texts.length) return parts;
    } catch (_) {
      // fall through to per-item
    }
    return Promise.all(texts.map(t => translateOneApi(t, targetLang)));
  }

  // Run `fn` over `items` with at most `concurrency` in flight at a time.
  async function runWithConcurrency(items, concurrency, fn) {
    const state = { i: 0 };
    async function worker() {
      while (state.i < items.length) {
        const idx = state.i++;
        try { await fn(items[idx]); } catch (_) {}
      }
    }
    const n = Math.min(concurrency, items.length);
    const workers = Array.from({ length: n }, () => worker());
    await Promise.all(workers);
  }

  async function translateNodes(nodes, targetLang) {
    if (!nodes.length) return;
    const BATCH = 20;
    const batches = [];
    for (let i = 0; i < nodes.length; i += BATCH) {
      batches.push(nodes.slice(i, i + BATCH));
    }
    await runWithConcurrency(batches, 4, async batch => {
      const texts = batch.map(n => n.nodeValue);
      const translated = await translateBatchApi(texts, targetLang);
      for (let i = 0; i < batch.length; i++) {
        const node = batch[i];
        const out = translated[i];
        if (!node.isConnected) continue;
        if (!node.__qtrans_orig) {
          node.__qtrans_orig = node.nodeValue;
          translatedNodes.push({ node, originalText: node.nodeValue });
        }
        if (out && out !== node.nodeValue) node.nodeValue = out;
      }
    });
  }

  async function translateInPlace(targetLang) {
    if (!targetLang) return { ok: false, error: 'no target lang' };
    // Already translated to a different lang — revert first so we start from
    // the true original text rather than translating-of-translation.
    if (activeTargetLang && activeTargetLang !== targetLang) {
      restoreOriginal();
    }

    activeTargetLang = targetLang;
    markPageTranslated(targetLang);

    // Filter out nodes we've already translated — a second translateInPlace
    // call (e.g., tabs.onUpdated firing twice for one navigation) otherwise
    // wastes an API round-trip on every node.
    const nodes = collectTextNodes(document.body).filter(n => !n.__qtrans_orig);
    await translateNodes(nodes, targetLang);

    // Translate the document title — it's user-visible in the tab.
    if (document.title && !titleRecorded()) {
      const orig = document.title;
      try {
        const t = await translateOneApi(orig, targetLang);
        if (t && t !== orig) {
          translatedNodes.push({ node: null, originalText: orig, isTitle: true });
          document.title = t;
        }
      } catch (_) {}
    }

    startTranslatorObserver(targetLang);

    // Tell background to remember this tab's target lang so it can re-apply
    // the translation after same-tab navigations (when autoTranslateLinks
    // is on).
    try {
      chrome.runtime.sendMessage({ type: 'qtrans/set-tab-lang', targetLang });
    } catch (_) {}

    return { ok: true, count: translatedNodes.length };
  }

  function titleRecorded() {
    return translatedNodes.some(r => r.isTitle);
  }

  function restoreOriginal() {
    stopTranslatorObserver();
    for (const rec of translatedNodes) {
      if (rec.isTitle) {
        document.title = rec.originalText;
      } else if (rec.node && rec.node.isConnected) {
        rec.node.nodeValue = rec.originalText;
        delete rec.node.__qtrans_orig;
      }
    }
    translatedNodes.length = 0;
    activeTargetLang = null;
    document.getElementById('__qtrans_meta__')?.remove();

    // Stop background from auto-translating follow-on pages in this tab.
    try {
      chrome.runtime.sendMessage({ type: 'qtrans/clear-tab-lang' });
    } catch (_) {}
  }

  // Sentinel the popup reads (via chrome.scripting.executeScript) to decide
  // whether to show the "Show original page" bar on normal (non-wrapper)
  // pages.
  function markPageTranslated(targetLang) {
    let meta = document.getElementById('__qtrans_meta__');
    if (!meta) {
      meta = document.createElement('meta');
      meta.id = '__qtrans_meta__';
      meta.name = 'qtrans-translation';
      (document.head || document.documentElement).appendChild(meta);
    }
    meta.content = targetLang;
  }

  function flushPendingNewNodes(targetLang) {
    const nodes = pendingNewNodes.filter(n => n.isConnected && !n.__qtrans_orig);
    pendingNewNodes = [];
    pendingFlushTimer = null;
    if (nodes.length) translateNodes(nodes, targetLang).catch(() => {});
  }

  function startTranslatorObserver(targetLang) {
    stopTranslatorObserver();
    translatorObserver = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE) {
            if (!shouldSkipTextNode(n) && !n.__qtrans_orig) pendingNewNodes.push(n);
          } else if (n.nodeType === Node.ELEMENT_NODE) {
            for (const t of collectTextNodes(n)) {
              if (!t.__qtrans_orig) pendingNewNodes.push(t);
            }
          }
        }
      }
      if (pendingNewNodes.length && !pendingFlushTimer) {
        // Small debounce coalesces bursty mutations (SPA re-renders).
        pendingFlushTimer = setTimeout(() => flushPendingNewNodes(targetLang), 150);
      }
    });
    translatorObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopTranslatorObserver() {
    translatorObserver?.disconnect();
    translatorObserver = null;
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
    pendingNewNodes = [];
  }

  // ─── Message listener (popup → content script) ────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'qtrans/translate-in-place') {
      translateInPlace(msg.targetLang).then(
        r => sendResponse(r || { ok: true }),
        err => sendResponse({ ok: false, error: err?.message || String(err) })
      );
      return true; // async response
    }
    if (msg.type === 'qtrans/restore-original') {
      restoreOriginal();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'qtrans/state') {
      sendResponse({ translated: !!activeTargetLang, targetLang: activeTargetLang });
      return false;
    }
  });

  // ─── Language detection ───────────────────────────────────────────────────

  function getPageLangs() {
    if (IS_GT_WRAPPER) {
      const p = new URLSearchParams(window.location.search);
      return { sourceLang: p.get('_x_tr_sl') || 'auto', targetLang: p.get('_x_tr_tl') || 'auto' };
    }
    if (activeTargetLang) {
      return { sourceLang: 'auto', targetLang: activeTargetLang };
    }
    return { sourceLang: 'auto', targetLang: 'auto' };
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
