# Privacy Policy — Quick Webpage Translate

_Last updated: 2026-04-23_

This extension is operated by an individual developer. It does not run a
backend server, collect personal data, show ads, or use analytics.

## What the extension stores

Using Chrome's built-in `chrome.storage.sync` API, the extension saves:

- Your list of recently used languages (up to 3 codes, e.g. `en`, `vi`, `fr`).
- Your pinned/favorite language codes.
- UI preferences: trigger mode for the original-word tooltip (hover or
  select), and whether to suppress Google Translate's own popup on
  translated pages.

This data is stored in your Chrome profile and — if you are signed in to
Chrome with sync enabled — synced across your own devices by Google's
sync service. It is never transmitted to a server operated by this
extension, because this extension does not operate any server.

## What the extension reads from the page

- **Current tab URL** — read via the `tabs` permission to build the
  correct Google Translate link for the page you are on and to detect
  whether the page is already a translated page (so the translate link
  is not double-wrapped).
- **Text you hover or select on a translated page** — only the specific
  word or phrase you hover (for 1 second) or select is read, in order
  to send it to Google Translate's public API for reverse-translation.

The extension does **not** read arbitrary page content, form data,
passwords, or browsing history.

## What the extension sends to third parties

- When you hover or select text on a page already translated by Google
  Translate (a `*.translate.goog` page), the extension sends that
  specific word or phrase to Google Translate's public API at
  `https://translate.googleapis.com/translate_a/single` to fetch the
  corresponding original-language text. That API call is subject to
  Google's own privacy policy: https://policies.google.com/privacy.
- When you click a language button, the extension navigates the current
  tab to Google Translate. From that point on, Google's own privacy
  policy applies to anything you do inside Google Translate.

No other network requests are made.

## Data we do not collect

- No personally identifiable information.
- No browsing history.
- No cookies or local storage beyond the items listed under "What the
  extension stores" above.
- No analytics, telemetry, or crash reports.
- No advertising identifiers.

## Your choices

- Disable the extension at any time from `chrome://extensions`.
- Uninstall the extension to remove all locally stored settings.
- Turn off Chrome sync to stop the settings listed above from being
  synced across your devices.

## Contact

Questions or issues? Open an issue at
https://github.com/thanhleha/GTransChromeExt/issues.
