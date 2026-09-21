const $=id=>document.getElementById(id);
const current=chrome.runtime.getManifest().version;
$("version").textContent="v"+current;
const btn=$("update"),status=$("status");
const sites=[["XVideos","xvideos.com"],["Pornhub","pornhub.com"],["xHamster","xhamster.com"],["XNXX","xnxx.com"],["YouPorn","youporn.com"],["Eporner","eporner.com"],["RedTube","redtube.net"],["Sxyprn","sxyprn.com"],["SpankBang","spankbang.com"]];
for(const [name,domain] of sites){const a=document.createElement("a");a.className="site";a.href="https://"+domain+"/";a.target="_blank";a.rel="noopener";const img=document.createElement("img");img.alt="";img.src="https://icons.duckduckgo.com/ip3/"+domain+".ico";const fb=document.createElement("div");fb.className="fallback";fb.textContent=name[0];fb.style.display="none";img.onerror=()=>{img.style.display="none";fb.style.display="grid"};const s=document.createElement("span");s.textContent=name;a.append(img,fb,s);$("sites").appendChild(a)}
function newer(a,b){const x=String(a||"").replace(/^v/i,"").split(".").map(Number),y=String(b||"").replace(/^v/i,"").split(".").map(Number);for(let i=0;i<4;i++)if((x[i]||0)!==(y[i]||0))return(x[i]||0)>(y[i]||0);return false}
function setStatus(t,c=""){status.textContent=t;status.className="status "+c}
async function engine(){
  try{
    const r=await chrome.runtime.sendMessage({type:"vf-engine-stats"});
    const h=await chrome.runtime.sendMessage({type:"vf-health"});
    const native=!!h?.health?.native;
    $("dot").className="dot "+(native?"on":"off");
    $("engineText").textContent=native?"Connected":"Unavailable";
    $("engineDetail").textContent=native?"Persistent native bridge ready":"Run native-host/install.ps1 to connect";
    $("jobs").textContent=r?.stats?.concurrentJobs??0;
    $("pending").textContent=r?.stats?.pending??0;
  }catch(e){$("engineText").textContent="Unavailable";$("engineDetail").textContent=e.message||"Engine status unavailable";$("dot").className="dot off"}
}
async function check(){
  btn.disabled=true;btn.textContent="Checking…";setStatus("Checking latest release…");
  try{
    const r=await chrome.runtime.sendMessage({type:"vf-check-update"});
    if(!r?.ok)throw new Error(r?.error||"Update check failed");
    $("updateVersion").textContent="v"+(r.info?.version||current);
    if(r.update&&newer(r.info.version,current)){setStatus("A new Pro engine is available.","new");btn.disabled=false;btn.textContent="Update now";btn.onclick=update}
    else{setStatus("This build is up to date.","ok");btn.disabled=false;btn.textContent="Check again";btn.onclick=check}
  }catch(e){setStatus(e.message||"Update check failed","err");btn.disabled=false;btn.textContent="Try again";btn.onclick=check}
}
async function update(){
  btn.disabled=true;btn.textContent="Updating…";setStatus("Starting the Pro updater…","ok");
  const r=await chrome.runtime.sendMessage({type:"vf-update-now"});
  if(!r?.ok){setStatus(r.error||"Could not start updater","err");btn.disabled=false;btn.textContent="Try again";btn.onclick=check;return}
  let n=0;
  const poll=async()=>{
    n++;
    try{
      const s=await chrome.runtime.sendMessage({type:"vf-update-status"});
      const st=s?.result?.status;
      if(st?.message)setStatus(st.message,st.ok===false?"err":"ok");
      if(st?.message==="Updated successfully. Old files cleaned."||st?.message==="Already up to date."){setStatus("Update complete. Reloading…","ok");return}
      if(st?.ok===false){btn.disabled=false;btn.textContent="Try again";btn.onclick=check;return}
    }catch{}
    if(n<600)setTimeout(poll,500);else{setStatus("Updater is still working. Check again shortly.","err");btn.disabled=false;btn.textContent="Check status";btn.onclick=check}
  };
  poll();
}
btn.onclick=check;
check();engine();setInterval(engine,1500);