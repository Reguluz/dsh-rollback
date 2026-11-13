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
  release's source archive. Installing the rollback build (replacing the
  Desktop application or npm package) remains a manual step outside DSH.
- Downloads are host-side and write only into the dedicated rollback folder.
