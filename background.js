const jobs = new Map();

function filenameFromUrl(url, fallback = 'video') {
  try {
    const u = new URL(url);
    const part = decodeURIComponent(u.pathname.split('/').pop() || '');
    if (part && /\.[a-z0-9]{2,5}$/i.test(part)) return part.replace(/[\\/:*?"<>|]/g, '_');
  } catch {}
  return `${fallback}.mp4`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'DOWNLOAD_URL') return;

  const filename = message.filename || filenameFromUrl(message.url);
  chrome.downloads.download({
    url: message.url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    jobs.set(downloadId, { sourceUrl: message.url, filename });
    sendResponse({ ok: true, downloadId });
  });

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || !jobs.has(delta.id)) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    jobs.delete(delta.id);
  }
});
