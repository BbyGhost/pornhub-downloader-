# VideoFlow Fresh — Quality + Progress

A Chrome MV3 extension with a one-click download button placed directly on supported HTML5 video players. It uses a local FFmpeg native bridge for MP4 output and reports download progress.

## Features

- One-click **Download MP4** button on the video
- Quality selection when FFmpeg can probe multiple streams
- Download progress reporting
- Local FFmpeg bridge, published self-contained
- Downloads to `Downloads/VideoFlow`
- No popup downloader UI
- Restricted to the configured supported domains in `extension/manifest.json`

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension/` directory.
5. Copy the extension ID shown by Chrome.
6. Open PowerShell in `native-host/` and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

7. Paste the extension ID when prompted.
8. Restart Chrome completely.
9. Open a supported video page. The download button appears directly on the video when an accessible media source is detected.

## FFmpeg

The installer expects `ffmpeg.exe` to be available on Windows. It checks the normal command path and the WinGet links location. The native bridge is published self-contained, so the target machine does not need the .NET 8 runtime installed.

## Limitations

The extension is intended for non-DRM media that you are authorized to download. It does not bypass DRM, encrypted media, authentication, paywalls, CAPTCHAs, or other access controls. Some sites use signed URLs, session-bound headers, MSE, HLS/DASH, or other delivery methods that cannot be reliably downloaded by a generic extension.

Respect the site's terms, copyright, and applicable laws.
