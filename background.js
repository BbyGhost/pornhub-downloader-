const jobs = new Map();

function filenameFromUrl(url, fallback='video') {
  try { const u=new URL(url); const p=decodeURIComponent(u.pathname.split('/').pop()||''); if(p&&/\.[a-z0-9]{2,5}$/i.test(p)) return p.replace(/[\\/:*?"<>|]/g,'_'); } catch {}
  return `${fallback}.mp4`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'DOWNLOAD_URL') {
    const filename=message.filename||filenameFromUrl(message.url);
    chrome.downloads.download({url:message.url,filename,saveAs:false,conflictAction:'uniquify'},id=>{
      if(chrome.runtime.lastError){sendResponse({ok:false,error:chrome.runtime.lastError.message});return;}
      jobs.set(id,{sourceUrl:message.url,filename});sendResponse({ok:true,downloadId:id});
    });
    return true;
  }
  if (message?.type === 'CONVERT_URL') {
    fetch('http://127.0.0.1:8765/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:message.url,filename:message.filename||'video.mp4'})})
      .then(r=>r.json().then(data=>({status:r.status,data})))
      .then(({status,data})=>sendResponse(status>=200&&status<300?data:{ok:false,error:data.error||`Helper returned ${status}`}),sendResponse)
      .catch(()=>sendResponse({ok:false,error:'FFmpeg helper is not running on 127.0.0.1:8765'}));
    return true;
  }
});

chrome.downloads.onChanged.addListener(delta=>{if(!delta.state||!jobs.has(delta.id))return;if(delta.state.current==='complete'||delta.state.current==='interrupted')jobs.delete(delta.id)});
