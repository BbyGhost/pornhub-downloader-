(function () {
    'use strict';

    // 1. Visual Status Bar
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed; top:0; left:0; width:100%; background:#28a745; color:white; text-align:center; z-index:999999; font-weight:bold; padding:8px; font-size: 14px;';
    bar.innerText = 'PH Downloader: Scanning for video data...';
    document.body.appendChild(bar);
    
    // 2. Add cleaner, modern styles
    function addStyle(cssText) {
        const style = document.createElement('style');
        style.textContent = cssText;
        document.head.appendChild(style);
    }

    addStyle(`
        .ph-download-urls { margin-top: 20px; padding: 15px; background: #1a1a1a; border: 2px solid #f7971d; border-radius: 8px; font-family: sans-serif; }
        .ph-download-urls h3 { color: #f7971d; margin-top: 0; margin-bottom: 15px; font-size: 16px; }
        .ph-download-urls ul { list-style: none; padding: 0; margin: 0; }
        .ph-download-urls li { display: flex; align-items: center; margin-bottom: 10px; }
        .download-url-label { color: #fff; min-width: 80px; font-weight: bold; font-size: 14px; }
        .download-url-input { flex: 1; margin: 0 15px; padding: 8px; color: #000; font-size: 12px; border-radius: 4px; border: none; background: #eee; }
        .download-url-btn { color: #fff; text-decoration: none; font-weight: bold; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; text-align: center; border: none; }
        .btn-copy { background: #444; margin-right: 10px; }
        .btn-copy:hover { background: #555; }
        .btn-dl { background: #f7971d; color: #000; min-width: 100px;}
        .btn-dl:hover { background: #e0891a; }
    `);

    // --- DOWNLOADER LOGIC ---
    function getHumanReadableSize(sizeb) {
        if (!sizeb) return "0 B";
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = parseInt(Math.floor(Math.log(sizeb) / Math.log(1024)));
        return (sizeb / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }

    function sanitizeTitle() {
        var title = document.title || "video";
        title = title.replace(/- Pornhub\.com/i, '').replace(/- Pornhub\.org/i, '');
        return title.replace(/[/:*?"<>|]/g, '_').trim();
    }

    async function downloadMp4(videoUrl, targetElement) {
        const originalText = targetElement.innerText;
        targetElement.style.background = '#007bff'; // Turn blue while working
        targetElement.style.color = '#fff';
        targetElement.innerText = "Connecting...";

        try {
            // Fetching internally keeps the security tokens intact to bypass the 404 error
            const response = await fetch(videoUrl);
            if (!response.ok) {
                targetElement.innerText = "Error: Server Blocked";
                targetElement.style.background = '#dc3545';
                return;
            }

            const contentLength = response.headers.get('Content-Length');
            const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
            let downloadedSize = 0;
            const chunks = [];
            const reader = response.body.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                downloadedSize += value.length;
                chunks.push(value);
                
                if (totalSize) {
                    const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
                    targetElement.innerText = `Downloading ${progress}% (${getHumanReadableSize(downloadedSize)} / ${getHumanReadableSize(totalSize)})`;
                } else {
                    targetElement.innerText = `Downloading... ${getHumanReadableSize(downloadedSize)}`;
                }
            }

            targetElement.innerText = "Saving file...";
            
            // Compile chunks into an MP4 and force the browser to save it
            const blob = new Blob(chunks, { type: 'video/mp4' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = sanitizeTitle() + '.mp4';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            targetElement.innerText = "Downloaded!";
            targetElement.style.background = '#28a745'; // Turn green on success
            
            setTimeout(() => {
                targetElement.innerText = originalText;
                targetElement.style.background = '#f7971d'; // Reset back to normal
                targetElement.style.color = '#000';
            }, 3000);

        } catch (error) {
            console.error("PH Downloader Error:", error);
            targetElement.innerText = "Download Failed";
            targetElement.style.background = '#dc3545';
        }
    }

    // --- CORE EXTENSION LOGIC ---
    class VideoParsing {
        static getObjectValueByStartsWithChar(obj, char) {
            const vars = [];
            Object.keys(obj).forEach(key => {
                if (key.startsWith(char)) vars.push({ key: key, value: obj[key] });
            });
            return vars;
        }

        static async getUrlInfo() {
            const flashvars = this.getObjectValueByStartsWithChar(window, 'flashvars_');
            if (!flashvars.length) return [];
            
            let videosInfo = [];
            try {
                videosInfo = flashvars[0]['value']['mediaDefinitions'];
            } catch (e) { return []; }

            let remoteAddress = undefined;
            let urlInfo = [];
            for (let i = 0; i < videosInfo.length; i++) {
                if (videosInfo[i]['remote']) {
                    remoteAddress = videosInfo[i]['videoUrl'];
                    break;
                }
            }

            if (remoteAddress) {
                try {
                    const response = await fetch(remoteAddress);
                    const data = await response.json();
                    if (data && data.length) {
                        urlInfo = urlInfo.concat(data.map(item => {
                            let q = item.quality || item.height || 'Video';
                            let f = item.format || 'mp4';
                            return {
                                quality: q + '.' + f,
                                url: item.videoUrl
                            };
                        }));
                    }
                } catch (e) { console.error("PH Downloader: Fetch error"); }
            }
            return urlInfo;
        }

        static injectUrls2Dom(urlInfo) {
            if (!urlInfo || urlInfo.length === 0) return;
            if (document.querySelector('.ph-download-urls')) return; 

            const li = urlInfo.map(item => `
                <li>
                    <span class="download-url-label">[ ${item.quality} ]</span>
                    <input class="download-url-input" value="${item.url}" readonly />
                    <button class="download-url-btn btn-copy" data-href="${item.url}">Copy URL</button>
                    <button class="download-url-btn btn-dl" data-href="${item.url}">Download</button>
                </li>
            `).join('');

            const html = `<div class="ph-download-urls">
                <h3>📥 Video Download Links</h3>
                <ul>${li}</ul>
            </div>`;
            
            const playerWrapper = document.querySelector('.playerWrapper') || document.querySelector('#player');
            if (playerWrapper) {
                playerWrapper.insertAdjacentHTML('afterend', html);
            }
        }

        static initEvents() {
            document.addEventListener('click', function (e) {
                if (e.target.classList.contains('btn-copy')) {
                    e.preventDefault();
                    navigator.clipboard.writeText(e.target.getAttribute('data-href'));
                    const originalText = e.target.innerText;
                    e.target.innerText = 'Copied!';
                    e.target.style.background = '#28a745';
                    setTimeout(() => {
                        e.target.innerText = originalText;
                        e.target.style.background = '#444';
                    }, 2000);
                } else if (e.target.classList.contains('btn-dl')) {
                    e.preventDefault();
                    downloadMp4(e.target.getAttribute('data-href'), e.target);
                }
            });
        }

        static async init() {
            const urlInfo = await this.getUrlInfo();
            if (urlInfo.length > 0) {
                this.injectUrls2Dom(urlInfo);
                this.initEvents();
                return true;
            }
            return false;
        }
    }

    let attempts = 0;
    const checkInterval = setInterval(async () => {
        attempts++;
        if (window.location.href.includes('view_video.php')) {
            const success = await VideoParsing.init();
            if (success) {
                bar.innerText = 'PH Downloader: Links ready!';
                setTimeout(() => bar.remove(), 2500);
                clearInterval(checkInterval);
            }
        } else {
            clearInterval(checkInterval);
            bar.remove();
        }

        if (attempts > 30) {
            clearInterval(checkInterval);
            bar.innerText = 'PH Downloader: Could not find video data.';
            bar.style.background = '#dc3545';
            setTimeout(() => bar.remove(), 3000);
        }
    }, 1000);

})();