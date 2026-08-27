(() => {
  "use strict";

  const emit = (url, mime = "") => {
    try {
      const u = new URL(url, location.href);
      const s = u.href.toLowerCase();
      if (s.includes(".m3u8") || s.includes(".mpd") || String(mime).includes("mpegurl") || String(mime).includes("dash")) {
        window.postMessage({source:"videoflow-fresh",type:"media",url:u.href,mime:mime||""},"*");
      }
    } catch {}
  };

  const scanResources = () => {
    try {
      for (const e of performance.getEntriesByType("resource")) {
        const u = e?.name || "";
        if (/\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)|master\.m3u8|\.urlset\//i.test(u)) emit(u);
      }
    } catch {}
  };

  const oldFetch = window.fetch;
  if (oldFetch) {
    window.fetch = function(input, init) {
      try { emit(typeof input === "string" ? input : input?.url, ""); } catch {}
      return oldFetch.apply(this, arguments);
    };
  }

  const oldOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try { emit(url, ""); } catch {}
    return oldOpen.apply(this, arguments);
  };

  scanResources();
  setTimeout(scanResources, 500);
  setTimeout(scanResources, 1500);
  setInterval(scanResources, 3000);
})();