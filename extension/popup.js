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
  setTimeout(()=>chrome.runtime.reload(),7000);
}
btn.onclick=check; check();