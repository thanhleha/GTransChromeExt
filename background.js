chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    ['recentLanguages', 'hoverOriginalEnabled', 'selectionOriginalEnabled', 'hideGTPopup'],
    result => {
      const updates = {};
      if (!result.recentLanguages) updates.recentLanguages = ['vi', 'en', 'fr'];
      if (result.hoverOriginalEnabled === undefined) updates.hoverOriginalEnabled = true;
      if (result.selectionOriginalEnabled === undefined) updates.selectionOriginalEnabled = false;
      if (result.hideGTPopup === undefined) updates.hideGTPopup = true;
      if (Object.keys(updates).length) chrome.storage.sync.set(updates);
    }
  );
});
