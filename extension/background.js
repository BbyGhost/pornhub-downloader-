const UPDATE_URL="https://raw.githubusercontent.com/BbyGhost/pornhub-downloader-/main/update.json";
const UPDATE_INTERVAL_MIN=360;
const HEALTH_ALARM="vf-health-check";
const UPDATE_ALARM="vf-update-check";
const HOST="com.videoflow.fresh";
const MAX_DIAGNOSTICS=100;

let nativePort=null;
let nativePortPromise=null;
const pending=new Map();
let updateRunning=false;

function uid(prefix="vf"){return prefix+"-"+crypto.randomUUID();}
function recordDiagnostic(type,error,extra={}){
  return chrome.storage.local.get("vfDiagnostics").then(x=>{
    const list=Array.isArray(x.vfDiagnostics)?x.vfDiagnostics:[];
    list.unshift({type,message:String(error?.message||error||"Unknown error").slice(0,800),time:Date.now(),version:chrome.runtime.getManifest().version,...extra});
    return chrome.storage.local.set({vfDiagnostics:list.slice(0,MAX_DIAGNOSTICS)});
  }).catch(()=>{});
}
async function getCookieHeader(url){
  try{
    const cookies=await chrome.cookies.getAll({url});
    return cookies?.length?cookies.map(c=>`${c.name}=${c.value}`).join("; "):"";
  }catch(e){await recordDiagnostic("cookies",e);return "";}
}
function newerVersion(a,b){
  const x=String(a||"").replace(/^v/i,"").split(".").map(n=>parseInt(n,10)||0);
  const y=String(b||"").replace(/^v/i,"").split(".").map(n=>parseInt(n,10)||0);
  for(let i=0;i<4;i++)if(x[i]!==y[i])return x[i]>y[i];
  return false;
}
function disconnectNative(reason=""){
  const p=nativePort;
  nativePort=null;
  nativePortPromise=null;
  if(p){try{p.disconnect();}catch{}}
  if(reason) for(const [id,item] of pending){item.reject(new Error(reason));pending.delete(id);}
}
function connectNative(){
  if(nativePort) return Promise.resolve(nativePort);
  if(nativePortPromise) return nativePortPromise;
  nativePortPromise=new Promise((resolve,reject)=>{
    let port;
    try{port=chrome.runtime.connectNative(HOST);}catch(e){nativePortPromise=null;reject(new Error(e.message||"Native bridge unavailable"));return;}
    nativePort=port;
    port.onMessage.addListener(msg=>{
      const id=msg?.requestId;
      if(msg?.event==="progress" && id){
        const item=pending.get(id);
        if(item?.tabId!=null){
          chrome.tabs.sendMessage(item.tabId,{type:"vf-progress",jobId:item.jobId,progress:Number(msg.progress||0),speed:msg.speed||"",mode:msg.mode||""}).catch(()=>{});
        }
        return;
      }
      if(msg?.event==="recovery" && id){
        const item=pending.get(id);
        if(item?.tabId!=null) chrome.tabs.sendMessage(item.tabId,{type:"vf-progress",jobId:item.jobId,progress:Number(msg.progress||0),speed:msg.message||"recovery"}).catch(()=>{});
        return;
      }
      if(!id)return;
      const item=pending.get(id);
      if(!item)return;
      pending.delete(id);
      if(msg.event==="error") item.reject(new Error(msg.error||"Native bridge error"));
      else item.resolve(msg);
    });
    port.onDisconnect.addListener(()=>{
      const err=chrome.runtime.lastError;
      nativePort=null;nativePortPromise=null;
      for(const [id,item] of pending){item.reject(new Error(err?.message||"Native bridge disconnected"));pending.delete(id);}
    });
    resolve(port);
  });
  return nativePortPromise;
}
async function nativeRequest(message,tabId=null){
  const requestId=uid("req");
  const port=await connectNative();
  return new Promise(async(resolve,reject)=>{
    pending.set(requestId,{resolve,reject,tabId,jobId:message.jobId||""});
    try{
      port.postMessage({...message,requestId});
    }catch(e){pending.delete(requestId);reject(e);}
  });
}
async function healthCheck(){
  try{
    for(const file of ["background.js","popup.html","popup.js"]){
      const r=await fetch(chrome.runtime.getURL(file),{cache:"no-store"});
      if(!r.ok)throw new Error("Missing extension resource: "+file);
    }
    let native=false;
    try{await connectNative();native=true;}catch{}
    await chrome.storage.local.set({vfHealth:{ok:true,native,detail:native?"Extension and native engine ready":"Extension ready; native engine unavailable",time:Date.now(),version:chrome.runtime.getManifest().version}});
    return {ok:true,native};
  }catch(e){
    await recordDiagnostic("health",e);
    await chrome.storage.local.set({vfHealth:{ok:false,detail:e.message,time:Date.now(),version:chrome.runtime.getManifest().version}});
    return {ok:false,error:e.message};
  }
}
async function checkForUpdates(){
  try{
    const r=await fetch(UPDATE_URL,{cache:"no-store"});
    if(!r.ok)throw new Error("Update server returned "+r.status);
    const info=await r.json();
    const current=chrome.runtime.getManifest().version;
    const update=!!info.version&&newerVersion(info.version,current);
    if(update)await chrome.storage.local.set({vfUpdate:info});
    return {ok:true,update,info,version:current};
  }catch(e){await recordDiagnostic("update-check",e);return {ok:false,error:e.message};}
}
async function waitForUpdateCompletion(target=""){
  for(let i=0;i<600;i++){
    await new Promise(r=>setTimeout(r,500));
    try{
      const r=await nativeRequest({action:"update-status"});
      const st=r?.status;
      if(st?.ok===false)return false;
      if(st?.message==="Updated successfully. Old files cleaned." || st?.message==="Already up to date."){
        if(!target||!st.toVersion||st.toVersion===target){
          await chrome.storage.local.set({vfUpdateApplied:{version:st.toVersion||target,time:Date.now()}});
          return true;
        }
      }
    }catch{}
  }
  await recordDiagnostic("update-timeout",new Error("Update did not report completion within 5 minutes."));
  return false;
}
async function startUpdate(){
  if(updateRunning)return {ok:false,error:"An update is already running."};
  updateRunning=true;
  try{
    const r=await nativeRequest({action:"update"});
    return {ok:true,result:r};
  }catch(e){updateRunning=false;return {ok:false,error:e.message};}
}
async function forwardFrameMedia(msg,sender){
  if(!sender?.tab?.id||!msg?.url)return;
  try{await chrome.tabs.sendMessage(sender.tab.id,{type:"vf-frame-media",url:msg.url,mime:msg.mime||""},{frameId:0});}catch{}
}
chrome.runtime.onInstalled.addListener(()=>{healthCheck();checkForUpdates();});
chrome.runtime.onStartup.addListener(()=>{healthCheck();checkForUpdates();});
chrome.alarms.create(UPDATE_ALARM,{periodInMinutes:UPDATE_INTERVAL_MIN});
chrome.alarms.create(HEALTH_ALARM,{periodInMinutes:30});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===UPDATE_ALARM)checkForUpdates();if(a.name===HEALTH_ALARM)healthCheck();});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type==="vf-frame-media"){forwardFrameMedia(msg,sender);return false;}
  if(msg?.type==="vf-check-update"){checkForUpdates().then(sendResponse);return true;}
  if(msg?.type==="vf-get-update"){chrome.storage.local.get("vfUpdate").then(x=>sendResponse({ok:true,info:x.vfUpdate||null}));return true;}
  if(msg?.type==="vf-update-now"){
    startUpdate().then(async r=>{
      if(!r.ok){sendResponse(r);return;}
      sendResponse({ok:true,started:true});
      // Background monitoring continues independently of the popup.
      const done=await waitForUpdateCompletion();
      updateRunning=false;
      if(done)setTimeout(()=>{try{chrome.runtime.reload();}catch{}},350);
    });
    return true;
  }
  if(msg?.type==="vf-update-status"){
    nativeRequest({action:"update-status"}).then(r=>{
      const st=r?.status;
      if(st?.ok===false||st?.message==="Updated successfully. Old files cleaned."||st?.message==="Already up to date.")updateRunning=false;
      sendResponse({ok:true,result:r});
      if(st?.message==="Updated successfully. Old files cleaned.")setTimeout(()=>{try{chrome.runtime.reload();}catch{}},350);
    }).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==="vf-probe"){
    (async()=>{
      const cookie=await getCookieHeader(msg.url);
      return nativeRequest({action:"probe",url:msg.url,referer:msg.referer||"",origin:msg.origin||"",userAgent:msg.userAgent||"",cookie},sender.tab?.id);
    })().then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==="vf-download"){
    (async()=>{
      const job={...msg.job};
      job.cookie=await getCookieHeader(job.url);
      return nativeRequest({...job,action:"download"},sender.tab?.id);
    })().then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==="vf-health"){
    chrome.storage.local.get(["vfHealth","vfDiagnostics"]).then(x=>sendResponse({ok:true,health:x.vfHealth||null,diagnostics:x.vfDiagnostics||[]}));return true;
  }
  if(msg?.type==="vf-engine-stats"){
    sendResponse({ok:true,stats:{connected:!!nativePort,pending:pending.size,concurrentJobs:[...pending.values()].filter(x=>x.jobId).length,version:chrome.runtime.getManifest().version}});
    return false;
  }
});