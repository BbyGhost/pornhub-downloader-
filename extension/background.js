
const UPDATE_URL = "https://raw.githubusercontent.com/BbyGhost/pornhub-downloader-/main/update.json";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEALTH_ALARM = "vf-health-check";
const MAX_DIAGNOSTICS = 50;

async function recordDiagnostic(type, error, extra = {}) {
  try {
    const data = await chrome.storage.local.get(["vfDiagnostics"]);
    const list = Array.isArray(data.vfDiagnostics) ? data.vfDiagnostics : [];
    list.unshift({type, message:String(error?.message || error || "Unknown error").slice(0,500), time:Date.now(), version:chrome.runtime.getManifest().version, ...extra});
    await chrome.storage.local.set({vfDiagnostics:list.slice(0,MAX_DIAGNOSTICS)});
  } catch {}
}

async function healthCheck() {
  try {
    for (const file of ["background.js","popup.html","popup.js"]) {
      const r = await fetch(chrome.runtime.getURL(file), {cache:"no-store"});
      if (!r.ok) throw new Error("Missing extension resource: " + file);
    }
    await chrome.storage.local.set({vfHealth:{ok:true,detail:"Core resources OK",time:Date.now(),version:chrome.runtime.getManifest().version}});
    return {ok:true};
  } catch(e) {
    await recordDiagnostic("health",e);
    await chrome.storage.local.set({vfHealth:{ok:false,detail:e.message,time:Date.now(),version:chrome.runtime.getManifest().version}});
    return {ok:false,error:e.message};
  }
}

function newerVersion(a,b) {
  const x=String(a).split(".").map(Number), y=String(b).split(".").map(Number);
  for(let i=0;i<4;i++){const aa=x[i]||0,bb=y[i]||0;if(aa!==bb)return aa>bb;}
  return false;
}



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
    await recordDiagnostic("update-check", e);
    return {ok:false,error:e.message};
  }
}

chrome.runtime.onInstalled.addListener(async () => { await checkForUpdates(false); await healthCheck(); });
chrome.alarms?.create?.("vf-update-check", {periodInMinutes:360});
chrome.alarms?.create?.(HEALTH_ALARM, {periodInMinutes:30});
chrome.alarms?.onAlarm?.addListener(async a => {
  if(a.name === "vf-update-check") await checkForUpdates(false);
  if(a.name === HEALTH_ALARM) await healthCheck();
});
chrome.runtime.onStartup?.addListener(healthCheck);

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
      } else if (msg?.event === "update_started") finish(true, msg);
      else if (msg?.event === "complete") finish(true, msg);
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

  if (msg?.type === "vf-get-update") {
    chrome.storage.local.get("vfUpdate").then(x => sendResponse({ok:true,info:x.vfUpdate||null}));
    return true;
  }

  if (msg?.type === "vf-update-status") {
    nativeRequest({action:"update-status"}, sender.tab?.id)
      .then(r => sendResponse({ok:true,result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }

  if (msg?.type === "vf-update-now") {
    nativeRequest({action:"update"}, sender.tab?.id)
      .then(r => sendResponse({ok:true,result:r}))
      .catch(e => sendResponse({ok:false,error:e.message}));
    return true;
  }

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


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "vf-health") {
    chrome.storage.local.get(["vfHealth","vfDiagnostics"]).then(x =>
      sendResponse({ok:true,health:x.vfHealth||null,diagnostics:x.vfDiagnostics||[]})
    );
    return true;
  }
});
