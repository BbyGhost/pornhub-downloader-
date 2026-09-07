const UPDATE_URL = "https://raw.githubusercontent.com/BbyGhost/pornhub-downloader-/main/update.json";
const UPDATE_INTERVAL_MIN = 360;
const HEALTH_ALARM = "vf-health-check";
const UPDATE_ALARM = "vf-update-check";
const MAX_DIAGNOSTICS = 50;
const HOST = "com.videoflow.fresh";
let updateRunning = false;

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
  const x=String(a||"").replace(/^v/i,"").split(".").map(n=>parseInt(n,10)||0);
  const y=String(b||"").replace(/^v/i,"").split(".").map(n=>parseInt(n,10)||0);
  for(let i=0;i<4;i++){if((x[i]||0)!==(y[i]||0)) return (x[i]||0)>(y[i]||0);}
  return false;
}

async function getCookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({url});
    return cookies?.length ? cookies.map(c => `${c.name}=${c.value}`).join("; ") : "";
  } catch (e) {
    await recordDiagnostic("cookies", e);
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
        chrome.tabs.sendMessage(tabId, {type:"vf-progress",jobId:message.jobId,progress:Number(msg.progress||0),speed:msg.speed||""}).catch(()=>{});
      } else if (msg?.event === "update_started") finish(true,msg);
      else if (msg?.event === "complete") finish(true,msg);
      else if (msg?.event === "probe") finish(true,msg);
      else if (msg?.event === "update_status") finish(true,msg);
      else if (msg?.event === "error") finish(false,new Error(msg.error||"Native bridge error"));
    });
    port.onDisconnect.addListener(() => {
      if (finished) return;
      const e=chrome.runtime.lastError;
      finish(false,new Error(e?.message||"Error communicating with native bridge"));
    });
    port.postMessage(message);
  });
}

async function checkForUpdates(manual=false,autoInstall=false) {
  try {
    const r=await fetch(UPDATE_URL,{cache:"no-store"});
    if(!r.ok) throw new Error("Update server returned "+r.status);
    const info=await r.json();
    const current=chrome.runtime.getManifest().version;
    const hasNewer=!!info.version&&newerVersion(info.version,current);
    if(hasNewer) {
      await chrome.storage.local.set({vfUpdate:info});
      if(autoInstall&&!updateRunning) {
        updateRunning=true;
        try { await nativeRequest({action:"update"}); await waitForUpdateCompletion(info.version); }
        finally { updateRunning=false; }
      }
      return {ok:true,update:true,info,installing:autoInstall};
    }
    return {ok:true,update:false,version:current};
  } catch(e) {
    await recordDiagnostic("update-check",e);
    return {ok:false,error:e.message};
  }
}

async function waitForUpdateCompletion(targetVersion="") {
  for(let i=0;i<20;i++) {
    await new Promise(r=>setTimeout(r,3000));
    try {
      const result=await nativeRequest({action:"update-status"});
      const status=result?.status;
      const completed=status?.ok===true && status?.message==="Updated successfully. Old files cleaned.";
      if(completed && (!targetVersion || status?.toVersion===targetVersion)) {
        await chrome.storage.local.set({vfUpdateApplied:{version:status?.toVersion||targetVersion,time:Date.now()}});
        chrome.runtime.reload();
        return true;
      }
      if(status?.ok===false) return false;
    } catch {}
  }
  await recordDiagnostic("update-timeout",new Error("Automatic update did not report completion within 60 seconds."));
  return false;
}

async function runAutomaticUpdate() {
  try { await checkForUpdates(false,true); }
  catch(e) { await recordDiagnostic("auto-update",e); }
}

chrome.runtime.onInstalled.addListener(async()=>{await healthCheck();await checkForUpdates(false,true);});
chrome.alarms.create(UPDATE_ALARM,{periodInMinutes:UPDATE_INTERVAL_MIN});
chrome.alarms.create(HEALTH_ALARM,{periodInMinutes:30});
chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name===UPDATE_ALARM) await runAutomaticUpdate();
  if(a.name===HEALTH_ALARM) await healthCheck();
});
chrome.runtime.onStartup.addListener(async()=>{await healthCheck();await runAutomaticUpdate();});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type==="vf-check-update"){checkForUpdates(true,false).then(sendResponse);return true;}
  if(msg?.type==="vf-get-update"){chrome.storage.local.get("vfUpdate").then(x=>sendResponse({ok:true,info:x.vfUpdate||null}));return true;}
  if(msg?.type==="vf-update-status"){nativeRequest({action:"update-status"},sender.tab?.id).then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:e.message}));return true;}
  if(msg?.type==="vf-update-now"){
    if(updateRunning){sendResponse({ok:false,error:"An update is already running."});return true;}
    updateRunning=true;
    nativeRequest({action:"update"},sender.tab?.id).then(async r=>{await waitForUpdateCompletion();return {ok:true,result:r};}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message})).finally(()=>{updateRunning=false;});
    return true;
  }
  if(msg?.type==="vf-probe"){
    (async()=>{const cookie=await getCookieHeader(msg.url);return nativeRequest({action:"probe",url:msg.url,referer:msg.referer||"",origin:msg.origin||"",userAgent:msg.userAgent||"",cookie},sender.tab?.id);})().then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==="vf-download"){
    (async()=>{const job={...msg.job};job.cookie=await getCookieHeader(job.url);return nativeRequest({...job,action:"download"},sender.tab?.id);})().then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==="vf-health"){
    chrome.storage.local.get(["vfHealth","vfDiagnostics"]).then(x=>sendResponse({ok:true,health:x.vfHealth||null,diagnostics:x.vfDiagnostics||[]}));return true;
  }
});
