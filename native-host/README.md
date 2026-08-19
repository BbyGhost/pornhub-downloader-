# VideoFlow Native FFmpeg Bridge

The bridge is a Windows native-messaging host for the VideoFlow Chrome extension.

## Requirements

- Windows x64
- FFmpeg available as `ffmpeg.exe`
- .NET SDK 8+ to build the bridge (the installed .NET 10 SDK is fine)

The installer publishes the executable self-contained, so the target machine does not need the .NET 8 runtime installed.

## Install

1. Load `extension/` in `chrome://extensions`.
2. Copy the extension ID.
3. Run `install.ps1` from this directory.
4. Paste the extension ID when prompted.
5. Restart Chrome.

The bridge registers itself as `com.videoflow.fresh` under the current user's Chrome Native Messaging registry key.
