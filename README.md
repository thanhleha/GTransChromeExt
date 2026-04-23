# Quick Google Translate — Chrome Extension

A Chrome extension (Manifest V3) that adds one-click translation to your **3 most recently used languages**, eliminating the need to navigate Google Translate's full language list every time.

## Why this extension, not Chrome's built-in Web Page Translate?

Chrome has a built-in translation feature, so this is a fair question.

**Chrome's built-in translate** works well *if* you always translate to the same language (your browser's default). But it falls short for multilingual users:

- **No language memory.** Chrome remembers your browser's UI language, not *which* languages you actually translate pages to. If you regularly switch between Vietnamese, English, and French, there is no shortcut — you have to right-click → Translate to → More languages → search every single time.
- **Slow to reach non-default languages.** Translating to anything other than your configured browser language requires 4–5 clicks through a context menu and a search field buried in a submenu.
- **No quick switching between languages.** If you're a researcher, translator, or language learner jumping between three languages throughout the day, Chrome gives you zero help remembering or accelerating that pattern.
- **Unreliable prompt.** Chrome's "Translate this page?" banner doesn't always appear — it depends on language detection heuristics that can miss mixed-language pages or fail silently.
- **No "show original" affordance in the toolbar.** Once translated, getting back to the original page requires finding the translate bar inside the page (which can be hidden or scrolled away), not from your toolbar.

**This extension solves those problems directly:**

- One click per language — your 3 most-used languages are always in the popup, no menus, no typing.
- Learns your pattern — the list reorders itself automatically as you use it.
- Pin permanent favorites — languages you always need stay pinned above the recents.
- Consistent "Show original" button — always accessible from the toolbar, regardless of what the page itself renders.
- Works on any page — no reliance on Chrome's auto-detect heuristics; you choose when to translate and to what language.

If you only ever translate everything to one language and Chrome's banner works reliably for you, the built-in is fine. If you work across multiple languages daily, this extension removes the friction.

## Features

- **3 recent-language buttons** — instantly retranslate with your most-used languages, reordered automatically
- **Pinned favorites** — star any language to keep it permanently above the recent list
- **Full language search** — searchable list of ~100 languages
- **Show original** — one-click button to return to the untranslated page, always visible from the toolbar
- **No double-wrapping** — detects when you're already on a translated page and re-wraps the original URL cleanly
- **Handles modern Google Translate URLs** — works with both `translate.google.com` and `.translate.goog` domain formats
- **No API key needed** — uses Google Translate's public URL interface
- **Synced across devices** — recents and favorites stored via `chrome.storage.sync`

## How it works

Clicking a language button redirects the current tab to:

```
https://translate.google.com/translate?sl=auto&tl={lang}&u={currentUrl}
```

If the current page is already a Google Translate page, the extension extracts the original URL first to avoid double-wrapping.

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. The "Quick Google Translate" icon will appear in your toolbar

## Project Structure

```
GTransChromeExt/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — initializes defaults on install
├── languages.js           # Full language list (~100 languages)
├── popup.html             # Extension popup UI
├── popup.css              # Google-style popup styling
├── popup.js               # Popup logic (recent langs, favorites, translate, search)
├── generate_icons.py      # Pure-Python icon generator (no external deps)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    ├── package.json
    └── test.js            # Playwright end-to-end tests (7 tests)
```

## Running Tests

The test suite uses [Playwright](https://playwright.dev/) and launches a real Chrome window with the extension loaded.

> **Important:** Run tests natively on Windows (not inside WSL2). Playwright controls Chrome via Linux kernel pipes which Windows Chrome cannot read.

```powershell
cd tests
npm install
node test.js
```

### What the tests cover

1. Popup renders 3 recent language buttons
2. Language list is searchable and filterable
3. Clicking a recent button navigates to Google Translate
4. Already-translated pages are re-translated without double-wrapping
5. Choosing a new language promotes it to the top of the recent list
6. "Show original" bar appears when on a translated page
7. Pin/unpin a language adds and removes it from the favorites section

## Regenerating Icons

If you want to regenerate the icons from scratch (requires Python, no external packages needed):

```bash
python generate_icons.py
```

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save and sync recent languages and favorites across devices |
| `tabs` | Read the current tab's URL to build the translate link |

## Potential Future Improvements

- Right-click context menu → Quick Translate → [lang]
- Keyboard shortcuts for the 3 recent language buttons

---

© 2026 Thanh-Le Ha. Built with the assistance of [Claude](https://claude.ai) (Anthropic).
