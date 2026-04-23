chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    ['recentLanguages', 'triggerMode', 'hideGTPopup'],
    result => {
      const updates = {};
      if (!result.recentLanguages) updates.recentLanguages = ['vi', 'en', 'fr'];
      if (result.triggerMode === undefined) updates.triggerMode = 'hover';
      if (result.hideGTPopup === undefined) updates.hideGTPopup = true;
      if (Object.keys(updates).length) chrome.storage.sync.set(updates);
    }
  );
});
