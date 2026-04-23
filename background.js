chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['recentLanguages', 'hoverOriginalEnabled'], (result) => {
    const updates = {};
    if (!result.recentLanguages) updates.recentLanguages = ['vi', 'en', 'fr'];
    if (result.hoverOriginalEnabled === undefined) updates.hoverOriginalEnabled = true;
    if (Object.keys(updates).length) chrome.storage.sync.set(updates);
  });
});
