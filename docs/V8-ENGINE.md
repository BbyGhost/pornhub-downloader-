# VideoFlow 8 Pro Engineering Notes

## Engine invariants

1. A native response must include a request ID when a request ID was supplied.
2. A completed download must pass media validation before it is exposed as complete.
3. A failed range download must fall back cleanly without leaving a final output file.
4. The extension must never assume that a native process is permanently connected.
5. Update installation must preserve a rollback path.
6. Extension-only updates must not rebuild native binaries.

## Current V8 implementation

- background.js: persistent Native Messaging connection, request map and concurrent operations.
- Program.cs: asynchronous dispatch for probe/download operations and request correlation.
- install.ps1: source-hash-aware incremental builds.
- popup.html / popup.js: Pro engine dashboard.
- Existing content.js / page-hook.js: event-driven media discovery and direct-player UI.

## Next performance layer

The planned release pipeline should publish prebuilt self-contained win-x64 native binaries. The updater can then replace binaries directly instead of invoking dotnet publish on the user's PC.

That is the final step needed to make normal updates independent of local .NET build performance.
