(() => {
  if (window.__uvdLoaded) return;
  window.__uvdLoaded = true;
  const style=document.createElement('style');
  style.textContent='#uvd-panel{position:fixed;right:18px;bottom:18px;width:360px;max-height:60vh;overflow:auto;background:#111;color:#fff;border:1px solid #333;border-radius:14px;z-index:2147483647;font:13px Arial;padding:14px;box-shadow:0 12px 40px #0008}#uvd-panel h3{margin:0 0 10px}.uvd-item{padding:10px 0;border-top:1px solid #2a2a2a}.uvd-meta{opacity:.75;margin:4px 0 8px;word-break:break-all}.uvd-btn{border:0;border-radius:8px;padding:7px 10px;margin-right:6px;cursor:pointer}.uvd-dl{background:#fff;color:#111}.uvd-mp4{background:#5b8cff;color:#fff}.uvd-close{float:right;background:#333;color:#fff}';document.documentElement.appendChild(style);
  const items=new Map();
  const ext=u=>{try{return new URL(u).pathname.split('.').pop().toLowerCase()}catch{return ''}};
  const media=u=>/^(https?:)/i.test(u)&&/\.(mp4|webm|mkv|mov|m4v|avi|flv|ts|m3u8|mpd)(?:$|[?#])/i.test(u);
  const name=()=>((document.title||'video').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,120))||'video';
  const add=(u,label='Video')=>{if(!u||!media(u))return;const k=u.split('#')[0];if(items.has(k))return;items.set(k,{url:k,label,format:ext(k)||'bin'});render()};
  const scan=()=>{document.querySelectorAll('video,source').forEach(e=>{const u=e.currentSrc||e.src||e.getAttribute('src');if(u)add(u,e.tagName.toLowerCase())});document.querySelectorAll('a[href]').forEach(a=>{if(media(a.href))add(a.href,'Link')})};
  const download=(u,f)=>chrome.runtime.sendMessage({type:'DOWNLOAD_URL',url:u,filename:f},r=>{if(!r?.ok)alert(r?.error||'Download failed')});
  function render(){let p=document.getElementById('uvd-panel');if(!p){p=document.createElement('div');p.id='uvd-panel';document.body.appendChild(p)}p.innerHTML='<button class="uvd-btn uvd-close" id="uvd-close">×</button><h3>Universal Video Downloader</h3><div style="opacity:.7;margin-bottom:8px">Browser-accessible media only</div>';for(const x of items.values()){const row=document.createElement('div');row.className='uvd-item';const m=document.createElement('div');m.className='uvd-meta';m.textContent=`${x.label} · ${x.format.toUpperCase()} · ${x.url}`;const b=document.createElement('button');b.className='uvd-btn uvd-dl';b.textContent='Download';b.onclick=()=>download(x.url,`${name()}.${x.format}`);const c=document.createElement('button');c.className='uvd-btn uvd-mp4';c.textContent='Convert → MP4';c.onclick=()=>chrome.runtime.sendMessage({type:'CONVERT_URL',url:x.url,filename:`${name()}.mp4`},r=>{if(!r?.ok)alert(r?.error||'Start the local FFmpeg helper first.')});row.append(m,b,c);p.appendChild(row)}document.getElementById('uvd-close').onclick=()=>p.remove()}
  scan();new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});setInterval(scan,3000);
})();
