const mediaByTab = new Map();
const activeDownloads = new Map();
const seen = new Map();

const MEDIA_RE = /\.(mp4|webm|mkv|mov|m4v|avi|flv|wmv|ts|m3u8|mpd)(?:[?#]|$)/i;
const HLS_RE = /(?:\.m3u8(?:[?#]|$)|(?:^|[?&])format=m3u8|(?:^|[?&])type=hls)/i;
const DASH_RE = /(?:\.mpd(?:[?#]|$)|(?:^|[?&])type=dash)/i;
const BLOCKED_RE = /(?:\.key(?:[?#]|$)|license|widevine|fairplay|playready)/i;

function classify(url, contentType='') {
  if (!url || BLOCKED_RE.test(url)) return null;
  const ct = String(contentType).toLowerCase();
  if (HLS_RE.test(url) || ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) return 'hls';
  if (DASH_RE.test(url) || ct.includes('application/dash+xml')) return 'dash';
  if (MEDIA_RE.test(url) || ct.startsWith('video/')) return 'direct';
  return null;
}

function shortName(url) {
  try {
    const p = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video');
    return (p.replace(/[^a-z0-9._-]+/gi, '_').slice(-120) || 'video');
  } catch { return 'video'; }
}

function remember(tabId, item) {
  if (tabId == null || !item) return;
  if (!mediaByTab.has(tabId)) mediaByTab.set(tabId, []);
  const list = mediaByTab.get(tabId);
  if (list.some(x => x.url === item.url)) return;
  list.unshift(item);
  if (list.length > 50) list.length = 50;
  chrome.tabs.sendMessage(tabId, {type:'MEDIA_FOUND', item}).catch(()=>{});
}

chrome.webRequest.onHeadersReceived.addListener(details => {
  const kind = classify(details.url, details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '');
  if (!kind || details.tabId < 0) return;
  remember(details.tabId, {
    url: details.url,
    kind,
    label: kind === 'direct' ? 'Direct video' : kind.toUpperCase(),
    name: shortName(details.url),
    tabId: details.tabId
  });
}, {urls:['<all_urls>']}, ['responseHeaders']);

chrome.webRequest.onBeforeRequest.addListener(details => {
  const kind = classify(details.url);
  if (!kind || details.tabId < 0) return;
  remember(details.tabId, {
    url: details.url,
    kind,
    label: kind === 'direct' ? 'Video request' : kind.toUpperCase(),
    name: shortName(details.url),
    tabId: details.tabId
  });
}, {urls:['<all_urls>']});

function download(url, filename) {
  return new Promise(resolve => chrome.downloads.download({url, filename, saveAs:false, conflictAction:'uniquify'}, id => {
    if (chrome.runtime.lastError) return resolve({ok:false,error:chrome.runtime.lastError.message});
    activeDownloads.set(id,{url,filename});
    resolve({ok:true,downloadId:id});
  }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_MEDIA') {
    sendResponse({items: mediaByTab.get(sender.tab?.id) || []});
    return;
  }
  if (message?.type === 'DOWNLOAD_URL') {
    download(message.url, message.filename || shortName(message.url)).then(sendResponse);
    return true;
  }
  if (message?.type === 'CONVERT_URL') {
    fetch('http://127.0.0.1:8765/convert', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url:message.url, filename:message.filename || 'video.mp4', referer:sender.tab?.url || ''})
    }).then(async r => { const d=await r.json().catch(()=>({})); sendResponse(r.ok?d:{ok:false,error:d.error || `Helper returned ${r.status}`}); })
      .catch(()=>sendResponse({ok:false,error:'Local FFmpeg helper is not running on 127.0.0.1:8765'}));
    return true;
  }
  if (message?.type === 'CLEAR_MEDIA') { mediaByTab.delete(sender.tab?.id); sendResponse({ok:true}); }
});

chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state || !activeDownloads.has(delta.id)) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') activeDownloads.delete(delta.id);
});
chrome.tabs.onRemoved.addListener(tabId => mediaByTab.delete(tabId));
