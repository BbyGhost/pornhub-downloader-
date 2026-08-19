const HOST = "com.videoflow.fresh";

function nativeRequest(message, tabId) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); }
    catch (e) { reject(new Error(e.message || "Native bridge unavailable")); return; }

    let finished = false;
    const finish = (ok, value) => {
      if (finished) return;
      finished = true;
      try { port.disconnect(); } catch {}
      ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value)));
    };

    port.onMessage.addListener(msg => {
      if (msg?.event === "progress" && tabId != null) {
        chrome.tabs.sendMessage(tabId, {
          type: "vf-progress", jobId: message.jobId,
          progress: Number(msg.progress || 0), speed: msg.speed || ""
        }).catch(() => {});
      } else if (msg?.event === "complete") finish(true, msg);
      else if (msg?.event === "probe") finish(true, msg);
      else if (msg?.event === "error") finish(false, new Error(msg.error || "Native bridge error"));
    });

    port.onDisconnect.addListener(() => {
      if (finished) return;
      const e = chrome.runtime.lastError;
      finish(false, new Error(e?.message || "Error communicating with native bridge"));
    });

    port.postMessage(message);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "vf-probe") {
    nativeRequest({action:"probe", url:msg.url, referer:msg.referer||"", origin:msg.origin||"", userAgent:msg.userAgent||""}, sender.tab?.id)
      .then(r => sendResponse({ok:true, result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }
  if (msg?.type === "vf-download") {
    nativeRequest({...msg.job, action:"download"}, sender.tab?.id)
      .then(r => sendResponse({ok:true,result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }
});
