# VideoFlow Downloader

VideoFlow is a Chrome MV3 downloader for supported sites with a direct on-page MP4 button, quality selection, FFmpeg progress, and a built-in updater.

## Features

- One-click **Download MP4** button directly on supported video players
- Quality selection when the media source exposes multiple video streams
- FFmpeg progress and download speed
- Self-contained .NET native bridge
- Built-in **Check for updates / Update now** popup
- Automatic updater downloads the GitHub package and rebuilds the FFmpeg bridge
- Creates a timestamped backup before replacing the extension
- Downloads to `Downloads/VideoFlow`
- Restricted to the supported domains in `extension/manifest.json`

## First-time installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's `extension/` folder.
4. Copy the extension ID shown by Chrome.
5. Open PowerShell in `native-host/`.
6. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

7. Paste the extension ID.
8. Restart Chrome.

The installer creates:

- `VideoFlowNative.exe`
- `VideoFlowUpdater.exe`
- Native Messaging registration
- `install-config.json` containing the local installation path and extension ID

## Updating

After the first-time installation, click the **VideoFlow** toolbar icon.

The popup checks GitHub and shows **Update now** when a newer version is available.

The updater:

1. Downloads the latest GitHub package.
2. Backs up the current `extension` directory.
3. Installs the new extension files.
4. Rebuilds the self-contained FFmpeg native bridge.
5. Re-registers Native Messaging.
6. Reloads VideoFlow.

You should not need to manually download ZIP files for subsequent updates.

If an update fails, look for:

```
.videoflow-update.json
```

in the VideoFlow installation directory. A timestamped `.backup-YYYYMMDD-HHMMSS` directory is also created before an extension replacement.

## FFmpeg

The installer expects `ffmpeg.exe` and `ffprobe.exe` to be available. It checks the normal Windows command path and the WinGet links location.

## Limitations

VideoFlow is intended for non-DRM media that you are authorized to download. It does not bypass DRM, encrypted media, authentication, paywalls, CAPTCHAs, or other access controls. Some sites use signed URLs, session-bound headers, MSE, HLS/DASH, or other delivery methods that a generic downloader cannot reliably access.

Respect each site's terms, copyright, and applicable laws.
