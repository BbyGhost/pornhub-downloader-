const $=id=>document.getElementById(id);
const current=chrome.runtime.getManifest().version;
$("version").textContent="v"+current;
const btn=$("update"), status=$("status");
function setStatus(t,c=""){status.textContent=t;status.className="status "+c;}
function newer(a,b){const x=a.split(".").map(Number),y=b.split(".").map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0);}return false;}
async function check(){
  btn.disabled=true; btn.textContent="Checking…"; setStatus("Checking the latest GitHub release…");
  const r=await chrome.runtime.sendMessage({type:"vf-check-update"});
  if(!r?.ok){setStatus(r?.error||"Could not check for updates.","err");btn.disabled=false;btn.textContent="Try again";return;}
  if(r.update && newer(r.info.version,current)){
    setStatus("Version "+r.info.version+" is available.","new");btn.disabled=false;btn.textContent="Update now";
    btn.onclick=update; return;
  }
  setStatus("You are up to date.","ok");btn.disabled=false;btn.textContent="Check again";btn.onclick=check;
}
async function update(){
  btn.disabled=true;btn.textContent="Updating…";setStatus("Downloading and installing the update…");
  const r=await chrome.runtime.sendMessage({type:"vf-update-now"});
  if(!r?.ok){setStatus(r?.error||"Update could not be started.","err");btn.disabled=false;btn.textContent="Try again";btn.onclick=check;return;}
  setStatus("Update started. Chrome will reload VideoFlow shortly.","ok");
  setTimeout(()=>chrome.runtime.reload(),15000);
}
btn.onclick=check; check();

const sites = [
  ["XVideos","xvideos.com"],
  ["Pornhub","pornhub.com"],
  ["xHamster","xhamster.com"],
  ["XNXX","xnxx.com"],
  ["YouPorn","youporn.com"],
  ["Eporner","eporner.com"],
  ["RedTube","redtube.com"],
  ["Sxyprn","sxyprn.com"],
  ["SpankBang","spankbang.com"]
];
const sitesEl = document.getElementById("sites");
if (sitesEl) {
  for (const [name, domain] of sites) {
    const a = document.createElement("a");
    a.className = "site";
    a.href = "https://" + domain + "/";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const img = document.createElement("img");
    img.alt = "";
    img.width = 28;
    img.height = 28;
    img.loading = "eager";
    img.src = "https://icons.duckduckgo.com/ip3/" + domain + ".ico";
    const fallback = document.createElement("span");
    fallback.className = "site-fallback";
    fallback.textContent = name.slice(0,1).toUpperCase();
    fallback.style.display = "none";
    img.addEventListener("error", () => {
      img.style.display = "none";
      fallback.style.display = "grid";
    });
    const span = document.createElement("span");
    span.textContent = name;
    a.append(img, fallback, span);
    sitesEl.appendChild(a);
  }
}

(async()=>{
 const el=document.getElementById("health"); if(!el)return;
 try{const r=await chrome.runtime.sendMessage({type:"vf-health"});
 if(r?.health?.ok){el.textContent="● System healthy";el.className="health ok";}
 else if(r?.health){el.textContent="● Problem detected — diagnostics saved";el.className="health bad";}
 else el.textContent="● Health check pending";
 }catch{el.textContent="● Health status unavailable";}
})();