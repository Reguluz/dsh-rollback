# DSH version rollback

A settings page for rolling DeepSeek Harness back to an older release after an
accidental upgrade broke plugin compatibility.

## What it does

- A **Version rollback** (版本回退) section appears in the Settings window.
- Every time the page opens (or you press Refresh), the release list is fetched
  live from `https://api.github.com/repos/deepseek-ai/deepseek-harness/releases`.
- The running DSH version is detected and marked **Running** in the list.
- Press **Download** on any older release to download its source archive
  (GitHub zipball) into the dedicated rollback folder shown on the page
  (default `<home>/dsh-rollback-versions`), outside every session workspace.
  Download progress is shown per row; failed downloads can be retried.

## Limitations

- The release list and archives come from GitHub; a network connection is
  required, and unauthenticated GitHub API rate limits apply.
- Releases of this repository ship no installer assets, so the download is the
  release's source archive. See "Build a rollback version from source" below.
- Downloads are host-side and write only into the configured download folder.

## Build a rollback version from source

The Desktop app is not published on GitHub Releases (updates ship through the
app's own update server), so a rollback build must be produced from the source
archive. Prerequisites: Node.js >= 24.9, pnpm 11, Windows.

```powershell
Expand-Archive dsh-v0.2.1-rc.5.zip -DestinationPath .\dsh-old
cd dsh-old\deepseek-harness-dsh-v0.2.1-rc.5
pnpm install
pnpm run build                              # Makefile: make build
pnpm --dir apps/desktop run package:win:x64:dir   # unpacked app, no signing needed
```

The output lands in `apps/desktop` (electron-builder `win-unpacked`). To roll
back: quit DSH, then replace the contents of the install folder (shown by the
page's "Open install folder" button) with `win-unpacked`, or run the NSIS
installer built by `package:win:x64` instead.

Before any upgrade, the page's "Back up current install" button archives the
running install folder into the download folder — restoring that archive is
the fastest rollback path and needs no build.
