(() => {
  if (window.__VIDEOFLOW_QUALITY__) return;
  window.__VIDEOFLOW_QUALITY__ = true;

  const widgets = new WeakMap();
  const manifests = new Map();
  const normalize = v => { try { if (!v || String(v).startsWith("blob:") || String(v).startsWith("data:")) return null; return new URL(String(v), location.href).href; } catch { return null; } };
  const rememberManifest = (url, mime="") => { const u=normalize(url), s=(u||"").toLowerCase(), m=String(mime).toLowerCase(); if(!u || (!s.includes(".m3u8") && !s.includes(".mpd") && !m.includes("mpegurl") && !m.includes("dash"))) return; manifests.set(u,Date.now()); };
  const directSource = video => { const list=[video.currentSrc,video.src,...[...video.querySelectorAll("source")].map(x=>x.src)]; for(const x of list){const u=normalize(x);if(u&&/\.(mp4|webm|mov|mkv)(?:[?#]|$)/i.test(u))return {url:u,type:"DIRECT"};} return null; };
  const sourceFor = video => { const d=directSource(video); if(d)return d; const m=[...manifests.entries()].sort((a,b)=>b[1]-a[1])[0]; return m?{url:m[0],type:m[0].toLowerCase().includes(".mpd")?"DASH":"HLS"}:null; };
  const safeTitle = video => { const t=(video.getAttribute("title")||document.title||"video").replace(/\s+/g," ").trim().slice(0,120); return (t||"video").replace(/[\\/:*?"<>|]+/g," ").trim(); };

  function create(video){
    if(widgets.has(video))return widgets.get(video);
    const wrap=document.createElement("div"), button=document.createElement("button"), menu=document.createElement("div"), barWrap=document.createElement("div"), bar=document.createElement("div"), status=document.createElement("div");
    Object.assign(wrap.style,{position:"fixed",zIndex:"2147483647",display:"none",width:"190px",fontFamily:"system-ui,-apple-system,Segoe UI,sans-serif"});
    Object.assign(button.style,{width:"190px",height:"42px",border:"0",borderRadius:"11px",background:"linear-gradient(135deg,#7c5cff,#20aef5)",color:"#fff",font:"800 12px system-ui",cursor:"pointer",boxShadow:"0 8px 24px rgba(0,0,0,.4)"});
    Object.assign(menu.style,{display:"none",marginTop:"6px",padding:"7px",borderRadius:"12px",background:"#11151b",border:"1px solid #2a303a",boxShadow:"0 12px 30px rgba(0,0,0,.5)"});
    Object.assign(barWrap.style,{display:"none",height:"4px",marginTop:"6px",background:"#252b34",borderRadius:"4px",overflow:"hidden"});
    Object.assign(bar.style,{height:"100%",width:"0%",background:"linear-gradient(90deg,#7c5cff,#20aef5)",transition:"width .2s"});
    Object.assign(status.style,{display:"none",marginTop:"5px",padding:"5px 7px",borderRadius:"8px",background:"#11151b",color:"#b8c0cc",font:"700 10px system-ui",textAlign:"center"});
    button.textContent="↓  Download MP4"; wrap.append(button,menu,barWrap,status); (document.documentElement||document.body).appendChild(wrap);
    const position=()=>{const r=video.getBoundingClientRect(),visible=r.width>=180&&r.height>=110&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;wrap.style.display=visible?"block":"none";if(visible){const w=190,h=42;wrap.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w-12))+"px";wrap.style.top=Math.max(8,Math.min(innerHeight-h-8,r.bottom-h-12))+"px";}};
    const setStatus=(text,show=true)=>{status.textContent=text;status.style.display=show?"block":"none";};
    const renderQualities=(result,source)=>{menu.innerHTML="";let qs=(result?.qualities||[]).filter(x=>x.height>0);const seen=new Set();qs=qs.filter(x=>{if(seen.has(x.height))return false;seen.add(x.height);return true;}).sort((a,b)=>b.height-a.height);if(!qs.length)qs=[{height:0,label:"Source / Best",url:source.url}];qs.forEach(q=>{const b=document.createElement("button");b.textContent=q.height?`${q.height}p${q.fps?` • ${q.fps}fps`:""}`:"Source / Best";Object.assign(b.style,{display:"block",width:"100%",padding:"9px 10px",margin:"2px 0",border:"0",borderRadius:"8px",background:"transparent",color:"#eef1f6",font:"700 11px system-ui",textAlign:"left",cursor:"pointer"});b.onclick=async()=>{menu.style.display="none";barWrap.style.display="block";bar.style.width="0%";setStatus("Preparing…");button.disabled=true;button.style.opacity=".7";try{const response=await chrome.runtime.sendMessage({type:"vf-download",job:{jobId:crypto.randomUUID(),url:q.url||source.url,filename:`${safeTitle(video)}${q.height?` ${q.height}p`:""}.mp4`,referer:location.href,origin:location.origin,userAgent:navigator.userAgent}});if(!response?.ok)throw new Error(response?.error||"Download failed");bar.style.width="100%";setStatus("✓ Downloaded");setTimeout(()=>{barWrap.style.display="none";setStatus("",false);button.disabled=false;button.style.opacity="1";},2500);}catch(e){setStatus("Retry download");button.disabled=false;button.style.opacity="1";console.error("VideoFlow:",e);}};menu.appendChild(b);});menu.style.display="block";};
    button.onclick=async()=>{if(button.disabled)return;const source=sourceFor(video);if(!source){setStatus("Video source not ready");return;}if(source.type==="DIRECT"){renderQualities({qualities:[{height:video.videoHeight||0,url:source.url}]},source);return;}button.disabled=true;button.textContent="Finding quality…";try{const response=await chrome.runtime.sendMessage({type:"vf-probe",url:source.url,referer:location.href,origin:location.origin,userAgent:navigator.userAgent});if(!response?.ok)throw new Error(response?.error||"Could not read qualities");renderQualities(response.result,source);}catch(e){console.error("VideoFlow probe:",e);renderQualities({qualities:[{height:0,url:source.url}]},source);}finally{button.disabled=false;button.textContent="↓  Download MP4";}};
    widgets.set(video,{wrap,button,menu,bar,status,position});position();return widgets.get(video);
  }
  chrome.runtime.onMessage.addListener(msg=>{if(msg?.type!=="vf-progress")return;for(const video of document.querySelectorAll("video")){const w=widgets.get(video);if(w){w.bar.style.width=Math.max(0,Math.min(100,msg.progress))+"%";w.status.textContent=`Downloading ${Math.round(msg.progress)}%${msg.speed?" • "+msg.speed:""}`;}}});
  window.addEventListener("message",e=>{if(e.source===window&&e.data?.source==="videoflow-fresh"&&e.data.type==="media"){rememberManifest(e.data.url,e.data.mime||"");scan();}});
  function scan(){document.querySelectorAll("video").forEach(v=>create(v));document.querySelectorAll("video").forEach(v=>widgets.get(v)?.position());}
  const hook=document.createElement("script");hook.src=chrome.runtime.getURL("page-hook.js");hook.onload=()=>hook.remove();(document.documentElement||document.head||document.body).appendChild(hook);
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener("scroll",scan,{passive:true});window.addEventListener("resize",scan,{passive:true});setInterval(scan,1200);scan();
})();
