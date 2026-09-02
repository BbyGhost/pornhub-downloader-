(() => {
  "use strict";
  // Only the top document owns the floating UI. Iframes can still host media,
  // but must not create duplicate buttons/popups.
  if (window.top !== window) return;
  if (window.__VIDEOFLOW_SINGLE_BUTTON__) return;
  window.__VIDEOFLOW_SINGLE_BUTTON__ = true;

  let widget = null;
  let activeVideo = null;
  let activeAnchor = null;
  let scanTimer = null;
  let menuOpen = false;
  let downloadQueue = [];
  let queueRunning = false;
  const MAX_QUEUE = 5;
  const manifests = new Map();
  const masterManifests = new Map();

  function normalizeUrl(value) {
    try {
      if (!value) return null;
      const str = String(value);
      if (str.startsWith("blob:") || str.startsWith("data:")) return null;
      return new URL(str, location.href).href;
    } catch { return null; }
  }

  function isDirectVideo(url) {
    return !!url && /\.(mp4|webm|mov|mkv)(?:[?#]|$)/i.test(url);
  }

  function rememberManifest(url, mime = "") {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    const type = String(mime).toLowerCase();
    if (!lower.includes(".m3u8") && !lower.includes(".mpd") && !type.includes("mpegurl") && !type.includes("dash")) return;
    const entry = { url: normalized, time: Date.now(), type: lower.includes(".mpd") ? "DASH" : "HLS" };
    manifests.set(normalized, entry);
    if (lower.includes("master.m3u8") || lower.includes(".urlset/") || /[\\/]master[._-]/i.test(lower)) masterManifests.set(normalized, entry);
    if (manifests.size > 20) {
      const entries = [...manifests.entries()].sort((a,b) => a[1].time - b[1].time);
      manifests.delete(entries[0][0]);
    }
  }

  function getDirectVideoSource(video) {
    const candidates = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll("source")).map(source => source.src)];
    for (const candidate of candidates) {
      const url = normalizeUrl(candidate);
      if (url && isDirectVideo(url)) return { url, type: "DIRECT" };
    }
    return null;
  }

  function getVideoSource(video) {
    const direct = getDirectVideoSource(video);
    if (direct) return direct;
    const recentMaster = [...masterManifests.values()].sort((a,b) => b.time - a.time)[0];
    if (recentMaster) return { url: recentMaster.url, type: recentMaster.type };
    const recent = [...manifests.values()].sort((a,b) => b.time - a.time)[0];
    return recent ? { url: recent.url, type: recent.type } : null;
  }

  function getVideoScore(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 70 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return -1;
    const area = rect.width * rect.height;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerX - window.innerWidth / 2) + Math.abs(centerY - window.innerHeight / 2);
    let score = area - distance * 250;
    if (!video.paused) score += area * 2;
    if (video.controls) score += 250000;
    if (video.readyState >= 2) score += 150000;
    if (video.currentSrc || video.src) score += 100000;
    if (video.videoWidth > 0 && video.videoHeight > 0) score += 500000;
    return score;
  }

  function collectVideos(root, out = []) {
    if (!root) return out;
    try {
      if (root.querySelectorAll) root.querySelectorAll("video").forEach(v => out.push(v));
      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of all) if (el.shadowRoot) collectVideos(el.shadowRoot, out);
    } catch {}
    return out;
  }

  function findPrimaryVideo() {
    const videos = collectVideos(document);
    let best = null;
    let bestScore = -1;
    for (const video of videos) {
      const score = getVideoScore(video);
      if (score > bestScore) { bestScore = score; best = video; }
    }
    return best;
  }

  function findPlayerAnchor(video) {
    if (video) {
      let el = video;
      for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect?.();
        if (r && r.width >= 300 && r.height >= 150) return el;
      }
    }
    const selectors = [".video-js", ".jwplayer", ".plyr", ".vjs-tech", "[class*=\"player\"]", "[id*=\"player\"]"];
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector), r = el?.getBoundingClientRect();
        if (el && r && r.width >= 300 && r.height >= 150) return el;
      } catch {}
    }
    return video || null;
  }

  function getSafeTitle(video) {
    let title = video.getAttribute("title") || document.title || "video";
    title = title.replace(/\s+/g, " ").trim().slice(0, 140);
    title = title.replace(/[\\/:*?"<>|]+/g, " ");
    return title.trim() || "video";
  }

  function createWidget() {
    if (widget) return widget;
    const container = document.createElement("div");
    container.id = "videoflow-single-download-widget";
    Object.assign(container.style, { position:"fixed", zIndex:"2147483647", display:"none", width:"190px", fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" });

    const button = document.createElement("button");
    Object.assign(button.style, { width:"190px", height:"42px", padding:"0 12px", border:"0", borderRadius:"11px", background:"linear-gradient(135deg,#7c5cff,#20aef5)", color:"#fff", fontSize:"12px", fontWeight:"800", cursor:"pointer", boxShadow:"0 8px 26px rgba(0,0,0,.45)", transition:"transform .15s ease, opacity .15s ease", whiteSpace:"nowrap" });
    button.textContent = "↓  Download MP4";
    button.addEventListener("mouseenter", () => { if (!button.disabled) button.style.transform = "translateY(-1px)"; });
    button.addEventListener("mouseleave", () => { button.style.transform = "translateY(0)"; });

    const menu = document.createElement("div");
    Object.assign(menu.style, { display:"none", marginTop:"6px", padding:"7px", borderRadius:"12px", background:"#11151b", border:"1px solid #2a303a", boxShadow:"0 14px 35px rgba(0,0,0,.55)", overflow:"hidden" });

    const progressOuter = document.createElement("div");
    Object.assign(progressOuter.style, { display:"none", width:"190px", height:"5px", marginTop:"6px", borderRadius:"5px", background:"#252b34", overflow:"hidden" });
    const progressInner = document.createElement("div");
    Object.assign(progressInner.style, { width:"0%", height:"100%", borderRadius:"5px", background:"linear-gradient(90deg,#7c5cff,#20aef5)", transition:"width .2s ease" });
    progressOuter.appendChild(progressInner);

    const status = document.createElement("div");
    Object.assign(status.style, { display:"none", width:"190px", marginTop:"5px", padding:"6px 8px", boxSizing:"border-box", borderRadius:"8px", background:"#11151b", color:"#b8c0cc", fontSize:"10px", fontWeight:"700", textAlign:"center", boxShadow:"0 8px 20px rgba(0,0,0,.3)" });

    container.append(button, menu, progressOuter, status);
    (document.documentElement || document.body).appendChild(container);
    widget = { container, button, menu, progressOuter, progressInner, status };
    button.addEventListener("click", handleDownloadClick);
    return widget;
  }

  function positionWidget() {
    if (!widget) return;
    const anchor = activeAnchor || activeVideo;
    if (!anchor) {
      widget.container.style.display = "block";
      widget.container.style.left = "auto";
      widget.container.style.right = "20px";
      widget.container.style.top = "auto";
      widget.container.style.bottom = "20px";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const visible = rect.width >= 120 && rect.height >= 70 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    if (!visible) { widget.container.style.display = "none"; return; }
    widget.container.style.display = "block";
    const width = 190, height = 42;
    let left = rect.right - width - 12;
    let top = rect.bottom - height - 12;
    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    widget.container.style.left = `${Math.round(left)}px`;
    widget.container.style.top = `${Math.round(top)}px`;
  }

  function clearQualityMenu() { widget.menu.innerHTML = ""; widget.menu.style.display = "none"; menuOpen = false; }
  function showStatus(text, visible) { if (!widget) return; widget.status.textContent = text; widget.status.style.display = visible ? "block" : "none"; }

  function showQualityMenu(qualities, fallbackSource) {
    clearQualityMenu();
    let list = Array.isArray(qualities) ? qualities.filter(q => q && Number(q.height) > 0) : [];
    const seen = new Set();
    list = list.filter(q => { const height = Number(q.height); if (seen.has(height)) return false; seen.add(height); return true; });
    list.sort((a,b) => Number(b.height) - Number(a.height));
    if (!list.length) list = [{ height:0, url:fallbackSource.url }];

    for (const quality of list) {
      const item = document.createElement("button");
      const height = Number(quality.height) || 0;
      item.textContent = height > 0 ? `${height}p${quality.fps ? ` • ${quality.fps}fps` : ""}${quality.codec ? ` • ${String(quality.codec).toUpperCase()}` : ""}` : "Best Available";
      Object.assign(item.style, { display:"block", width:"100%", padding:"9px 10px", margin:"2px 0", border:"0", borderRadius:"8px", background:"transparent", color:"#eef1f6", fontSize:"11px", fontWeight:"700", textAlign:"left", cursor:"pointer" });
      item.addEventListener("mouseenter", () => { item.style.background = "#202631"; });
      item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
      item.addEventListener("click", async event => { event.preventDefault(); event.stopPropagation(); menuOpen = false; widget.menu.style.display = "none"; enqueueDownload({url:quality.url || fallbackSource.url,height,videoStream:Number.isInteger(Number(quality.streamIndex)) ? Number(quality.streamIndex) : null}); });
      widget.menu.appendChild(item);
    }
    menuOpen = true;
    widget.menu.style.display = "block";
  }

  async function handleDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!activeVideo) {
      showStatus("Video is still loading…", true);
      setTimeout(() => showStatus("", false), 1800);
      scan();
      return;
    }
    const source = getVideoSource(activeVideo);
    if (!source) { showStatus("Video source not ready", true); setTimeout(() => showStatus("", false), 1800); return; }
    if (source.type === "DIRECT") {
      showQualityMenu([{ height: activeVideo.videoHeight || 0, width: activeVideo.videoWidth || 0, streamIndex: 0, url: source.url }], source);
      return;
    }
    widget.button.disabled = true;
    widget.button.style.opacity = "0.7";
    widget.button.textContent = "Finding quality…";
    try {
      const response = await chrome.runtime.sendMessage({ type:"vf-probe", url:source.url, referer:location.href, origin:location.origin, userAgent:navigator.userAgent });
      if (!response?.ok) throw new Error(response?.error || "Could not read available qualities");
      showQualityMenu(response.result?.qualities || [], source);
    } catch (error) {
      console.error("VideoFlow quality probe:", error);
      showQualityMenu([], source);
    } finally {
      widget.button.disabled = false;
      widget.button.style.opacity = "1";
      widget.button.textContent = "↓  Download MP4";
    }
  }

  function enqueueDownload(job) {
    if (!job?.url) return;
    if (downloadQueue.length >= MAX_QUEUE) {
      showStatus("Queue is full (5 downloads)", true);
      setTimeout(() => showStatus("", false), 2200);
      return;
    }
    downloadQueue.push({...job});
    updateQueueButton();
    runQueue();
  }

  function updateQueueButton() {
    if (!widget) return;
    if (queueRunning) {
      widget.button.textContent = downloadQueue.length ? `Downloading… • ${downloadQueue.length} queued` : "Downloading…";
    } else if (downloadQueue.length) {
      widget.button.textContent = `↓  Download queued (${downloadQueue.length})`;
    } else {
      widget.button.textContent = "↓  Download MP4";
    }
  }

  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (downloadQueue.length) {
      const job = downloadQueue.shift();
      updateQueueButton();
      await startDownload(job.url, job.height, job.videoStream);
    }
    queueRunning = false;
    updateQueueButton();
  }

  async function startDownload(url, height, videoStream = null) {
    if (!activeVideo || !widget) return;
    widget.button.disabled = true;
    widget.button.style.opacity = "0.7";
    widget.button.textContent = "Preparing…";
    widget.progressOuter.style.display = "block";
    widget.progressInner.style.width = "0%";
    showStatus("Preparing download…", true);
    const jobId = crypto.randomUUID();
    let filename = getSafeTitle(activeVideo);
    if (height > 0) filename += ` ${height}p`;
    filename += ".mp4";

    try {
      const response = await chrome.runtime.sendMessage({ type:"vf-download", job:{ jobId, url, filename, referer:location.href, origin:location.origin, userAgent:navigator.userAgent, videoStream } });
      if (!response?.ok) throw new Error(response?.error || "Download failed");
      widget.progressInner.style.width = "100%";
      widget.button.textContent = "✓  Downloaded";
      showStatus("Download completed", true);
      try {
        const saved = (await chrome.storage.local.get("vfHistory")).vfHistory || [];
        saved.unshift({title: filename.replace(/\.mp4$/i,""), quality: height || 0, url, time: Date.now()});
        await chrome.storage.local.set({vfHistory: saved.slice(0,30)});
      } catch {}
      setTimeout(() => { if (!widget) return; widget.button.disabled = false; widget.button.style.opacity = "1"; widget.button.textContent = "↓  Download MP4"; widget.progressOuter.style.display = "none"; widget.progressInner.style.width = "0%"; showStatus("", false); }, 2500);
    } catch (error) {
      console.error("VideoFlow download:", error);
      widget.button.disabled = false;
      widget.button.style.opacity = "1";
      widget.button.textContent = "Retry download";
      showStatus(error?.message || "Download failed", true);
    }
  }

  function scan() {
    const video = findPrimaryVideo();
    if (video !== activeVideo) {
      activeVideo = video;
      activeAnchor = findPlayerAnchor(video);
      if (widget) {
        clearQualityMenu();
        widget.button.textContent = "↓  Download MP4";
        widget.button.disabled = false;
        widget.button.style.opacity = "1";
      }
    }
    if (!activeVideo && !activeAnchor) {
      const fallback = findPlayerAnchor(null);
      if (fallback) activeAnchor = fallback;
    }
    createWidget();
    positionWidget();
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type !== "vf-progress" || !widget) return;
    const progress = Math.max(0, Math.min(100, Number(msg.progress) || 0));
    widget.progressOuter.style.display = "block";
    widget.progressInner.style.width = `${progress}%`;
    showStatus(`Downloading ${Math.round(progress)}%${msg.speed ? ` • ${msg.speed}` : ""}`, true);
  });

  window.addEventListener("message", event => {
    if (event.source !== window || !event.data || event.data.source !== "videoflow-fresh") return;
    if (event.data.type === "media") { rememberManifest(event.data.url, event.data.mime || ""); scan(); }
  });

  try {
    const hook = document.createElement("script");
    hook.src = chrome.runtime.getURL("page-hook.js");
    hook.onload = () => hook.remove();
    (document.documentElement || document.head || document.body).appendChild(hook);
  } catch (error) { console.warn("VideoFlow page hook failed:", error); }

  const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 100); });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  document.addEventListener("play", event => {
    if (event.target instanceof HTMLVideoElement) { activeVideo = event.target; scan(); }
  }, true);
  document.addEventListener("loadedmetadata", event => {
    if (event.target instanceof HTMLVideoElement) scan();
  }, true);
  document.addEventListener("canplay", event => {
    if (event.target instanceof HTMLVideoElement) scan();
  }, true);
  window.addEventListener("scroll", positionWidget, { passive:true });
  window.addEventListener("resize", positionWidget, { passive:true });
  // Initial scan plus event-driven rescans; avoid polling every 800 ms forever.\n  scan();
  createWidget();
  positionWidget();
  scan();
})();
