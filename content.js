(() => {
  if (window.__uvdLoaded) return;
  window.__uvdLoaded = true;
  const items = new Map();
  const title = () => ((document.title || 'video').replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,120) || 'video');
  const ext = u => { try { const p = new URL(u).pathname; return (p.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase(); } catch { return ''; } };
  const add = item => { if (!item?.url || items.has(item.url)) return; items.set(item.url,item); render(); };

  const style = document.createElement('style');
  style.textContent = `#uvd-panel{position:fixed;right:18px;bottom:18px;width:410px;max-height:65vh;overflow:auto;background:#101114;color:#fff;border:1px solid #333;border-radius:14px;z-index:2147483647;font:13px Arial;padding:14px;box-shadow:0 12px 40px #0009}#uvd-panel h3{margin:0 0 4px}.uvd-sub{opacity:.65;margin-bottom:10px}.uvd-item{padding:10px 0;border-top:1px solid #292b31}.uvd-meta{opacity:.75;margin:4px 0 8px;word-break:break-all;font-size:11px}.uvd-btn{border:0;border-radius:8px;padding:7px 10px;margin:3px 5px 3px 0;cursor:pointer}.uvd-dl{background:#fff;color:#111}.uvd-mp4{background:#5b8cff;color:#fff}.uvd-close,.uvd-scan{background:#30323a;color:#fff}.uvd-top{display:flex;justify-content:space-between;align-items:center}`;
  document.documentElement.appendChild(style);

  function send(type, payload, done) { chrome.runtime.sendMessage({type,...payload}, done || (()=>{})); }
  function download(x) { send('DOWNLOAD_URL',{url:x.url,filename:`${title()}.${x.kind==='direct'?(ext(x.url)||'mp4'):'bin'}`},r=>{if(!r?.ok)alert(r?.error||'Download failed')}); }
  function convert(x) { send('CONVERT_URL',{url:x.url,filename:`${title()}.mp4`},r=>{if(!r?.ok)alert(r?.error||'Start the FFmpeg helper first.');else alert('MP4 conversion started.')}); }

  function render() {
    let p=document.getElementById('uvd-panel'); if(!p){p=document.createElement('div');p.id='uvd-panel';document.body.appendChild(p)}
    p.innerHTML='<div class="uvd-top"><h3>Universal Video Downloader</h3><button class="uvd-btn uvd-close">×</button></div><div class="uvd-sub">Network-detected browser-accessible media</div>';
    if(!items.size){const e=document.createElement('div');e.textContent='Play the video to detect its media request.';e.style.opacity='.65';p.appendChild(e)}
    for(const x of items.values()){
      const row=document.createElement('div');row.className='uvd-item';
      const m=document.createElement('div');m.className='uvd-meta';m.textContent=`${x.label} · ${x.kind.toUpperCase()} · ${x.url}`;row.appendChild(m);
      const d=document.createElement('button');d.className='uvd-btn uvd-dl';d.textContent='Download';d.onclick=()=>download(x);row.appendChild(d);
      if(x.kind==='hls'||x.kind==='dash'||x.kind==='direct'){const c=document.createElement('button');c.className='uvd-btn uvd-mp4';c.textContent='Convert → MP4';c.onclick=()=>convert(x);row.appendChild(c)}
      p.appendChild(row);
    }
    const scan=document.createElement('button');scan.className='uvd-btn uvd-scan';scan.textContent='Refresh';scan.onclick=()=>{send('GET_MEDIA',{},r=>{(r?.items||[]).forEach(add)})};p.appendChild(scan);
    p.querySelector('.uvd-close').onclick=()=>p.remove();
  }

  send('GET_MEDIA',{},r=>{(r?.items||[]).forEach(add);render()});
  chrome.runtime.onMessage.addListener(m=>{if(m?.type==='MEDIA_FOUND')add(m.item)});
  render();
})();
