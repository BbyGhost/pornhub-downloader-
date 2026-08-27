const UPDATE_URL = "https://raw.githubusercontent.com/BbyGhost/pornhub-downloader-/main/update.json";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function checkForUpdates(manual = false) {
  try {
    const r = await fetch(UPDATE_URL, {cache:"no-store"});
    if (!r.ok) throw new Error("Update server returned " + r.status);
    const info = await r.json();
    const current = chrome.runtime.getManifest().version;
    const newer = info.version && info.version !== current;
    if (newer) {
      await chrome.storage.local.set({vfUpdate: info});
      if (manual) return {ok:true, update:true, info};
      return {ok:true, update:true, info};
    }
    return {ok:true, update:false, version:current};
  } catch(e) {
    return {ok:false,error:e.message};
  }
}

chrome.runtime.onInstalled.addListener(() => checkForUpdates(false));
chrome.alarms?.create?.("vf-update-check", {periodInMinutes:360});
chrome.alarms?.onAlarm?.addListener(a => { if(a.name === "vf-update-check") checkForUpdates(false); });

const HOST = "com.videoflow.fresh";

async function getCookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies?.length) return "";
    return cookies.map(c => `${c.name}=${c.value}`).join("; ");
  } catch (e) {
    console.warn("VideoFlow cookies:", e);
    return "";
  }
}

async function nativeRequest(message, tabId) {
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
  if (msg?.type === "vf-check-update") { checkForUpdates(true).then(sendResponse); return true; }

  if (msg?.type === "vf-get-update") { chrome.storage.local.get("vfUpdate").then(x => sendResponse({ok:true,info:x.vfUpdate||null})); return true; }

  if (msg?.type === "vf-probe") {
    (async () => {
      const cookie = await getCookieHeader(msg.url);
      return nativeRequest({
        action: "probe", url: msg.url, referer: msg.referer || "",
        origin: msg.origin || "", userAgent: msg.userAgent || "", cookie
      }, sender.tab?.id);
    })().then(r => sendResponse({ok:true,result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }

  if (msg?.type === "vf-download") {
    (async () => {
      const job = {...msg.job};
      job.cookie = await getCookieHeader(job.url);
      return nativeRequest({...job, action:"download"}, sender.tab?.id);
    })().then(r => sendResponse({ok:true,result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }
});
