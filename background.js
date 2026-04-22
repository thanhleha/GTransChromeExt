chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['recentLanguages'], (result) => {
    if (!result.recentLanguages) {
      chrome.storage.sync.set({ recentLanguages: ['vi', 'en', 'fr'] });
    }
  });
});
