# Quick Google Translate — Chrome Extension

A Chrome extension (Manifest V3) that adds one-click translation to your **3 most recently used languages**, eliminating the need to navigate Google Translate's full language list every time.

## Features

- **3 recent-language buttons** — instantly retranslate with your most-used languages
- **Full language search** — searchable list of ~100 languages
- **No double-wrapping** — detects when you're already on a translated page and re-wraps the original URL
- **No API key needed** — uses Google Translate's public URL interface
- **Synced across devices** — recent languages stored via `chrome.storage.sync`

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
├── popup.js               # Popup logic (recent langs, translate, search)
├── generate_icons.py      # Pure-Python icon generator (no external deps)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    ├── package.json
    └── test.js            # Playwright end-to-end tests
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

## Regenerating Icons

If you want to regenerate the icons from scratch (requires Python, no external packages needed):

```bash
python generate_icons.py
```

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save and sync recent language list across devices |
| `tabs` | Read the current tab's URL to build the translate link |

## Potential Future Improvements

- Pin/star specific languages as permanent favorites
- "Show original" button when already on a translated page
- Right-click context menu → Quick Translate → [lang]
- Keyboard shortcuts for the 3 recent language buttons
