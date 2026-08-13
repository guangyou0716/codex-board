# Codex Board Local Bridge

Phase 2 adds a local-only bridge for the Codex Board UI. It owns one long-lived
`codex app-server --stdio` child process and exposes structured localhost
actions for diagnostics, model/account discovery, persistent thread listing and
turns, approvals, repository discovery, and read-only Git status/diff.

## Start

Use Node.js 22.13+ and the installed Codex CLI:

```powershell
$env:CODEX_APPROVED_ROOTS = "C:\Users\me\Development;C:\Users\me\Work"
npm run bridge:start
```

The bridge binds to `127.0.0.1:4321` by default. `CODEX_BRIDGE_HOST` rejects
non-loopback values. `CODEX_ALLOWED_ORIGINS` can replace the small default
development/production allowlist when the private Site URL changes.

The bridge refuses filesystem roots, a blanket home directory, credential or
system directories, path traversal, symlink escapes, and repositories outside
the approved roots. Repository and thread-list operations are read-only. There
is no generic shell endpoint.

## Protocol upgrades

The checked-in TypeScript files under `generated/codex-app-server/` are produced
from the installed Codex CLI and must not be edited by hand. After upgrading
Codex, regenerate them and review the adapter mapping:

```powershell
npm run codex:schema
```

The bridge keeps raw App Server messages behind `AppServerProcess` and
`CodexAppServerClient`; React receives normalized domain events through
`LocalCodexAdapter`.

## Diagnostics

Open Codex Board → Settings → Codex provider → Local Codex bridge. The page
shows localhost connection status, bridge/Codex versions, authentication,
approved roots, and repository discovery. Missing authentication remains an
explicit unavailable state; credentials never enter Site storage or bridge
logs.

Phase 2 intentionally defers public transport, remote pairing, GitHub writes,
commit/push/merge/PR/deploy actions, and desktop repository automation.
