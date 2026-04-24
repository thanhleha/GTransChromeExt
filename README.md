# Quick Webpage Translate — Chrome Extension

A Chrome extension (Manifest V3) that translates webpages **in place** with one click and
gives you fast access to the languages you actually use. The URL stays
original, every link stays real, and your browser history and bookmarks
keep pointing at the true page — not at a Google-hosted proxy.

## Why this extension, not Chrome's built-in Web Page Translate?

**Chrome's built-in translate** works well *if* you always translate to the same language (your browser's default). But it falls short for multilingual users:

- **No language memory.** Chrome remembers your browser's UI language, not *which* languages you actually translate pages to. If you regularly switch between Vietnamese, English, and French, there is no shortcut — you have to right-click → Translate to → More languages → search every single time.
- **Slow to reach non-default languages.** Translating to anything other than your configured browser language requires 4–5 clicks through a context menu and a search field buried in a submenu.
- **No quick switching between languages.** If you're a researcher, translator, or language learner jumping between three languages throughout the day, Chrome gives you zero help remembering or accelerating that pattern.
- **Unreliable prompt.** Chrome's "Translate this page?" banner doesn't always appear — it depends on language detection heuristics that can miss mixed-language pages or fail silently.
- **No "show original" affordance in the toolbar.** Once translated, getting back to the original page requires finding the translate bar inside the page (which can be hidden or scrolled away), not from your toolbar.
- **No word-level original lookup.** Reading a translated page, you often want to know exactly what word was used in the original — Chrome offers no way to check without opening a separate tab.

**This extension solves those problems directly:**

- One click per language — your 3 most-used languages are always in the popup, no menus, no typing.
- Learns your pattern — the list reorders itself automatically as you use it.
- Pin permanent favorites — languages you always need stay pinned above the recents.
- Consistent "Show original" button — always accessible from the toolbar, regardless of what the page itself renders.
- Translates in place — the URL, links on the page, bookmarks, and back-button behavior all stay native. No redirection through a `*.translate.goog` subdomain.
- Hover or select a word to see the original — on translated pages, choose a trigger mode (Hover for 1 s, or Select text) and a small tooltip shows the original word in the source language.
- Clean reading experience — no top bar injected by Google, no intrusive "Original text" popup, no paragraph-wide blue hover highlight.

If you only ever translate everything to one language and Chrome's banner works reliably for you, the built-in is fine. If you work across multiple languages daily, this extension removes the friction.

## Features

- **In-place translation by default** — walks the page's text nodes and replaces them via Google Translate's public API, so the URL stays `arxiv.org` (not `arxiv-org.translate.goog`), link targets stay real, and Back/Forward/Bookmarks behave naturally.
- **3 recent-language buttons** — instantly retranslate with your most-used languages, reordered automatically.
- **Pinned favorites** — star any language to keep it permanently above the recent list.
- **Full language search** — searchable list of ~100 languages.
- **Show original** — one-click button to restore every text node on the page to its original text, no navigation required.
- **Reveal original word/phrase** — on a translated page, pick a trigger in the popup (mutually exclusive): **Hover** a word for 1 s, or **Select** text with mouse/keyboard; a small tooltip shows the original text in the source language.
- **Auto-translate followed links** — optional toggle: when you click a link on a translated page, the new page is translated into the same language automatically. Hover/select works on the follow-on page too.
- **Google Translate wrapper fallback** — optional toggle: if a specific page renders poorly in in-place mode, flip the toggle and the extension uses Google's `translate.google.com/translate?u=…` wrapper instead (the legacy behavior). The wrapper mode also suppresses GT's intrusive popup and blue paragraph hover-highlight, and optionally rewrites GT-wrapped anchor hrefs back to originals.
- **Translates dynamic content** — a MutationObserver keeps translating text added by SPAs and infinite scroll.
- **No API key needed** — uses Google Translate's public endpoints.
- **Synced across devices** — recents, favorites, and settings stored via `chrome.storage.sync`.

## How it works

### Default: in-place translation

When you click a language button, the extension injects `content.js` into the active tab (via `chrome.scripting.executeScript`) and sends it the target language. `content.js` then:

1. Walks the page's text nodes (skipping `<script>`, `<style>`, `<code>`, `<pre>`, `<input>`, anything marked `translate="no"` or `.notranslate`, and our own injected UI).
2. Batches ~20 text nodes per request (joined with `\n\n`), calls `https://translate.googleapis.com/translate_a/single` with `sl=auto&tl=<lang>`, up to 4 batches in flight at a time.
3. Replaces each node's `nodeValue` with the translated text, stashing the original so "Show original" can revert.
4. Translates `document.title` so the browser tab label is also localized.
5. Starts a `MutationObserver` so text added later (SPA re-renders, infinite scroll) is translated too.
6. Tells the background service worker the tab's target language, so — if you've enabled **Auto-translate followed links** — clicking an internal link auto-translates the destination page into the same language.

The URL bar never changes. Link `href` attributes are never touched. A hidden `<meta name="qtrans-translation">` sentinel is added so the popup can detect the translated state and show the "Show original" bar.

### Fallback: Google Translate wrapper

If you turn on **Use Google Translate wrapper** in the popup, clicking a language button falls back to the original behavior — navigating the tab to:

```
https://translate.google.com/translate?sl=auto&tl={lang}&u={currentUrl}
```

This is the same approach the extension used prior to v1.0.0. The tab ends up at `{host-with-dashes}.translate.goog/...`. Use this when a page renders poorly under in-place translation (for example, heavy client-side frameworks that re-key elements on every render).

On a `*.translate.goog` page, the extension still does useful work:

- Suppresses Google Translate's "Original text" popup and the blue paragraph-wide hover highlight that GT injects on hover.
- Hover/select-for-original continues to work, rounding-tripping through `translate.googleapis.com`.
- The optional **Auto-translate followed links** toggle — when **off** (default), anchor `href` attributes are rewritten to their real URLs, so middle-click, copy-link-address, and the status bar all show the real destination and clicking escapes the wrapper; when **on**, links are left as GT-wrapped so follow-on pages stay translated.

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. The "Quick Webpage Translate" icon will appear in your toolbar

## Reloading the extension after code changes

When you pull new code or edit any file locally, Chrome won't pick up the changes automatically. To reload:

1. Open `chrome://extensions/`
2. Find **Quick Webpage Translate** in the list
3. Click the **reload icon** (circular arrow ↺) on the extension card
4. Close and reopen the extension popup — changes are now live

> You do not need to remove and re-add the extension. The reload button is enough for JS/HTML/CSS changes. If you change `manifest.json`, a reload is also sufficient unless you add new permissions (which would require re-accepting them).

## Project Structure

```
GTransChromeExt/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — defaults + per-tab target-lang tracking + auto-translate on navigation
├── content.js             # Dual-mode: in-place translator (any page, injected on demand) +
│                          # GT-wrapper helper (statically injected on *.translate.goog)
├── languages.js           # Full language list (~100 languages)
├── popup.html             # Extension popup UI
├── popup.css              # Google-style popup styling
├── popup.js               # Popup logic (recent langs, favorites, translate, search, settings)
├── resize_icon.js         # Crops + masks + resamples icons/source_1024.png → the 3 sizes
├── build_zip.js           # Stages the runtime files and zips them for Chrome Web Store upload
├── capture_screenshots.js # Generates the 1280×800 marketing shot for the store listing
├── generate_icons.py      # (legacy) pure-Python procedural icon generator
├── icons/
│   ├── source_1024.png    # Hand-designed (AI-generated) source at 1024×1024
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── store_assets/
│   ├── STORE_LISTING.md   # Copy-paste content for the Chrome Web Store dashboard
│   ├── PRIVACY_POLICY.md  # Required by the store; host as a Gist or GH Pages URL
│   └── screenshot_popup.png
└── tests/
    ├── package.json
    └── test.js            # Playwright end-to-end test suite
```

## Running Tests

The test suite uses [Playwright](https://playwright.dev/) and launches a real Chrome window with the extension loaded.

> **Important:** Run tests natively on Windows (not inside WSL2). Playwright controls Chrome via Linux kernel pipes which Windows Chrome cannot read.

```powershell
cd tests
npm install
node test.js
```

> Note on v1.0.0: the existing tests were written against the pre-v1 wrapper-navigation behavior. They exercise the fallback path (GT-wrapper mode) and still work when the test harness pre-seeds `useWrapperFallback: true` in `chrome.storage.sync`. Dedicated tests for the new in-place translator are a TODO.

## Regenerating Icons

1. Put a square source image at `icons/source_1024.png` (1024×1024 PNG,
   rounded-square composition with margin around it is fine — the script
   auto-crops to the rounded-square region).
2. Run the resize script (uses Playwright's bundled Chromium to do the
   cropping, masking, and high-quality downsampling — no extra deps
   beyond what the test suite already installs):

   ```bash
   NODE_PATH=./tests/node_modules node resize_icon.js
   ```

   This produces `icons/icon16.png`, `icons/icon48.png`, and
   `icons/icon128.png` with transparent rounded corners.

> The older `generate_icons.py` produced a procedural blue-circle icon
> and is kept only for historical reference.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save and sync recent languages, favorites, and UI settings; per-tab target language is kept in `chrome.storage.session` for auto-translate-on-navigation. |
| `tabs` | Read the active tab's URL (to detect wrapper / in-place state) and react to navigation events to re-apply translation in the same tab. |
| `scripting` | Inject `content.js` into the active tab on demand when the user clicks a language (in-place mode) or when the tab navigates with auto-translate on. |
| `activeTab` | Grants temporary access to the current tab when the popup is opened, so `scripting.executeScript` can run without a broad `<all_urls>` host permission. |
| `https://translate.googleapis.com/*` (host) | Fetches translations (whole-page text and reverse-translations for hover/select). |

## Potential Future Improvements

- Right-click context menu → Quick Webpage Translate → [lang]
- Keyboard shortcuts for the 3 recent language buttons
- Cancellation of in-flight translation requests when the user rapidly switches target language
- Translate element attributes (`alt`, `title`, `placeholder`) in addition to text nodes

---

© 2026 Thanh-Le Ha. Built with the assistance of [Claude](https://claude.ai) (Anthropic).
