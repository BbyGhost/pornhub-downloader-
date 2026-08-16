# Universal Video Downloader

Chrome MV3 extension for downloading browser-accessible media. It detects direct video resources on pages and offers a fast direct download. An optional local FFmpeg helper converts non-MP4 media to MP4.

## Install

1. Download/clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder.
5. Open a page containing an accessible video; the detector will show a download panel when it finds direct media URLs.

## MP4 conversion

Install FFmpeg and Python, then from `helper/` run `python server.py`. Use **Convert → MP4** in the page panel. Converted files are placed in `helper/converted/`.

## Important limitations

This extension works with media that the browser/page makes accessible as direct URLs. It does not bypass DRM, encrypted media, authentication, paywalls, CAPTCHAs, or other access controls. Some sites use signed URLs, session-bound headers, MSE, HLS/DASH, or other delivery methods that cannot be reliably downloaded by a generic extension.

Use it only for content you are authorized to download and convert, and respect the site's terms and copyright.
