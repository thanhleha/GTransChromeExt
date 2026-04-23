# Chrome Web Store — listing content

Copy/paste these exact fields into the Developer Dashboard when you submit.

---

## Name (manifest field — already set)

```
Quick Webpage Translate
```

---

## Summary / short description (≤ 132 chars — this appears under the name in the Web Store)

```
One-click translation to your recent & pinned languages. Hover or select a word on translated pages to reveal the original.
```

---

## Single-purpose description (required by Chrome Web Store policy)

```
Translate the current webpage into one of your recently used or pinned languages with a single click, and reveal the original text of words on already-translated pages.
```

---

## Detailed description (pasted into the "Description" field on the listing)

```
Quick Webpage Translate gives multilingual readers a one-click shortcut to their most-used languages — no menus, no searching, no repeating yourself.

Why not just use Chrome's built-in translate?

Chrome's built-in feature works fine if you always translate to the same language. It falls short for anyone working across two or more languages:

• No language memory — Chrome remembers your browser's UI language, not the languages you actually translate *to*. Every non-default language takes 4–5 clicks through a submenu.
• No quick switching — jumping between Vietnamese, English, and French throughout the day means searching the language list over and over.
• Unreliable prompt — Chrome's "Translate this page?" banner doesn't always appear, especially on mixed-language pages.
• No quick way back to the original once you've translated.
• No way to check the original word when reading a translation.

What this extension does

• 3 recent-language buttons, reordered automatically as you use them.
• Pin any language as a permanent favorite — always visible above the recents.
• Full searchable list of ~100 languages.
• "Show original" button when you're already on a translated page — always reachable from the toolbar.
• On translated pages: pick a trigger mode (Hover a word for 1 second, or Select text with mouse/keyboard) and a small tooltip shows the original word or phrase in the source language.
• Suppresses Google Translate's intrusive "Original text" popup and the blue paragraph-wide hover highlight by default — your reading view stays clean. Toggle them back if you prefer the defaults.
• Works on any webpage and handles both translate.google.com and modern .translate.goog URLs without double-wrapping.
• Your recent languages, pinned favorites, and settings sync across devices via Chrome's built-in storage sync.

No account required. No analytics. No ads. No API key needed.

Privacy
The extension reads the active tab's URL (to build the translate link) and, on translated pages, sends the word or phrase you hovered or selected to Google Translate's public API to fetch its original form. Nothing is sent to any third-party server operated by this extension — there is no server operated by this extension. See the linked privacy policy for details.

Open source
Source code and issue tracker: https://github.com/thanhleha/GTransChromeExt
```

---

## Category

```
Productivity
```

---

## Language

```
English (United States)
```

---

## Permissions justifications (required for any permission you declare)

Google now asks you to justify each permission in a free-text box. Use these:

**`storage` justification**

```
Stores the user's recent languages, pinned favorite languages, and UI
preferences (hover/select trigger mode, suppress Google Translate's
intrusive popup) so the extension behaves consistently across sessions
and devices via chrome.storage.sync. No personal data is stored.
```

**`tabs` justification**

```
Reads the URL of the currently active tab so the extension can build the
correct Google Translate link for that page, detect if the page is
already a translated page (to avoid double-wrapping), and show the
"Show original" bar when appropriate. No browsing history is collected.
```

**Host permission — `https://translate.googleapis.com/*` justification**

```
On pages already translated by Google Translate (*.translate.goog), the
extension calls Google Translate's public web API to reverse-translate a
word or phrase the user hovers or selects, so it can display the
original text in a small tooltip. Only the specific word/phrase the user
interacts with is sent — not whole pages or browsing history.
```

**Remote code use**

```
No — the extension does not fetch or execute remote code. All JavaScript
is bundled in the extension package. It only makes read-only HTTPS API
calls to translate.googleapis.com to fetch translation strings as JSON.
```

---

## Data usage disclosures (the "Privacy practices" tab)

Check these boxes:

- ☑ Personally identifiable information — **NO**
- ☑ Health information — **NO**
- ☑ Financial and payment information — **NO**
- ☑ Authentication information — **NO**
- ☑ Personal communications — **NO**
- ☑ Location — **NO**
- ☑ Web history — **NO**
- ☑ User activity — **NO**
- ☑ Website content — **YES** — *"The extension sends the specific word
  or phrase the user hovers or selects on a translated page to Google
  Translate's public API to fetch the original text. No other page
  content is transmitted."*

Then check:

- ☑ I certify that the following disclosures are true: data is not sold
  to third parties, not used for purposes unrelated to the single
  purpose of the extension, not used to determine creditworthiness.

---

## Privacy policy URL

You need a publicly reachable URL. Easiest path: paste
`store_assets/PRIVACY_POLICY.md` content into a new **GitHub Gist**
(https://gist.github.com/ → New gist → paste → Create secret gist) and
use the raw Gist URL. Or add it as a page in your GitHub repo and use
the GitHub Pages URL. Either works.

---

## Promotional images (optional but recommended)

Chrome Web Store accepts:

- **Small promo tile**: 440×280 PNG — shows in search results
- **Marquee promo tile**: 1400×560 PNG — if you want to be considered for featuring

Not required for submission. Can be added later from the Developer Dashboard.
