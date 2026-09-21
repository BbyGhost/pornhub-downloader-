(() => {
  "use strict";
  const seen = new Map();
  const emit = (url, mime = "") => {
    try {
      if (!url) return;
      const u = new URL(String(url), location.href);
      const s = u.href.toLowerCase(), mt = String(mime||"").toLowerCase();
      if (!(s.includes(".m3u8") || s.includes(".mpd") || s.includes(".mp4") || s.includes(".webm") ||
            mt.includes("mpegurl") || mt.includes("dash") || mt.includes("video/"))) return;
      const now=Date.now(), key=u.href;
      if(seen.has(key)&&now-seen.get(key)<2500)return;
      seen.set(key,now);
      if(seen.size>300){const k=seen.keys().next().value;if(k)seen.delete(k);}
      window.postMessage({source:"videoflow-fresh",type:"media",url:u.href,mime:mt},"*");
    } catch {}
  };
  const scan=()=>{try{
    performance.getEntriesByType("resource").forEach(e=>emit(e?.name||"",""));
    document.querySelectorAll("video,source,link").forEach(el=>emit(el.currentSrc||el.src||el.getAttribute("src")||el.href||"",el.type||""));
  }catch{}};
  const oldFetch=window.fetch;
  if(oldFetch)window.fetch=function(input,init){try{emit(typeof input==="string"?input:input?.url,"")}catch{}return oldFetch.apply(this,arguments)};
  const oldOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){try{emit(url,"")}catch{}return oldOpen.apply(this,arguments)};
  const oldSetAttribute=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){try{if(["src","href"].includes(String(name).toLowerCase()))emit(value,this.type||"")}catch{}return oldSetAttribute.apply(this,arguments)};
  scan();setTimeout(scan,700);setTimeout(scan,1800);
})();