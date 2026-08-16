# Local FFmpeg helper

This helper is optional. It converts a browser-accessible media URL to MP4 and writes the result into `helper/converted/`.

## Windows

1. Install Python 3.
2. Install FFmpeg and make sure `ffmpeg.exe` is on PATH.
3. From the `helper` directory run:

```powershell
python server.py
```

Leave the terminal running while using **Convert → MP4**.

## Notes

- The helper is intentionally bound to `127.0.0.1` and is not exposed to your LAN.
- It does not decrypt DRM or bypass authentication, paywalls, CAPTCHAs, or other access controls.
- Some sites require session cookies or signed request headers; those resources may download in Chrome but fail when passed to the standalone helper. In that case, use the direct download option or a site-supported export.
