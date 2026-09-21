# VideoFlow 8 Pro

VideoFlow 8 Pro is the next-generation Chrome MV3 downloader architecture for non-DRM media the user is authorized to download.

## What changed in V8

- Persistent Native Messaging connection with automatic reconnect.
- Request IDs so multiple native operations can safely run concurrently.
- Background engine can keep multiple probe/download requests in flight.
- Event-driven media discovery remains lightweight and avoids permanent polling loops.
- Direct progressive media uses the parallel HTTP range engine when supported.
- HLS/DASH and unsupported range servers continue through FFmpeg.
- Output validation remains mandatory before a download is reported complete.
- Incremental native installation: extension-only updates no longer republish the .NET native bridge.
- New Pro dashboard exposes native-engine state, active jobs, pending requests and update state.
- V8 work is isolated on the v8-pro branch until the engine is verified.

## V8 architecture

Chrome content scripts -> V8 Background Engine -> persistent Native Messaging port -> VideoFlow Native Engine -> Probe / Scheduler / Downloader -> Range Engine / FFmpeg -> Validator -> Downloads/VideoFlow.

### Request correlation

Every native request receives a unique request ID. Progress, recovery and completion messages carry that ID, preventing concurrent downloads from receiving each other's events.

### Incremental updates

The installer records SHA-256 hashes for Program.cs and Updater.cs. If only the Chrome extension changed, the native bridge and updater are not rebuilt. If native source changed, only the affected executable is republished.

## First-time V8 installation

1. Load extension/ from this branch using chrome://extensions.
2. Copy the extension ID.
3. Open PowerShell in native-host/.
4. Run:

powershell -ExecutionPolicy Bypass -File .\\install.ps1

5. Paste the extension ID when requested.
6. Reload the extension.

## Performance goals

- low UI latency
- connection reuse
- concurrent request handling
- range-based throughput
- minimal repeated process startup
- zero unnecessary native rebuilds
- safe atomic output validation

## Security boundary

VideoFlow does not bypass DRM, encrypted media, authentication, paywalls, CAPTCHAs or other access controls. It is intended for media that the user is authorized to download.

Respect site terms, copyright and applicable law.
