[**中文 README**](README.zh-CN.md) · [English](README.md)

# dsh_update_check

> dsh_update_check is a DSH plugin that automatically compares the official upstream DeepSeek Harness repository and prompts you when an update is available.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

1. **Check on startup** — checks the official repository 3 seconds after the page loads (and again on `connection/reset`).
2. **Based on the official GitHub repo** — tries `releases/latest` API → `tags` API → releases page HTML in order, with a 10 s timeout; tags with a `dsh-v*` prefix parse correctly (semver-style comparison, including rc/beta prereleases).
3. **Network failure notice** — when GitHub is unreachable, the top banner shows "Cannot reach GitHub, check failed" with **Retry / Close**.
4. **Persistent update reminder** — "New version: current X → latest Y" with **Update now / Later**, **no auto-dismiss timer** (only clicking closes it). After clicking **Later**, the same version never pops up again (not even from the settings page's manual "Check now"); it only reappears when a new version (`latest` changes) is published.
5. **Dedicated settings page** — a standalone **"↑ Check for updates"** page in Settings (same level as General / Models / Plugins, **listed last**), showing current version / latest version / last check / status, with "Check now" and "Install update" buttons.
6. **Install progress visualization** — after clicking "Install update", a **progress bar with percentage on the right** is shown, with a **file-change window** below it streaming npm's add / remove / change / reify output in real time. The install runs as a background job polled by the client; on failure the window shows the concrete error plus a manual fix hint.
7. **Breaking-change warning (important)** — DSH has announced future breaking updates that may be incompatible with older plugins. The plugin detects breaking updates with two signals, **graded**:
   - **Semver** (deterministic): major change, or minor change during 0.x.
   - **Official release notes**: keyword matching, **graded**:
     - **Strong signals** (`breaking change`, `破坏性更新`, `破坏…兼容`, etc.) → yellow highlight + ⚠️ "Breaking update detected";
     - **Weak signals** (`incompatible`, `migration`, `removed`, `deprecated`, `不兼容`, `迁移`, `移除`, etc.) → yellow highlight + ⚠️ "Possibly breaking update", and the confirmation page **lists the matched keywords and the original snippets** for you to verify.
   - Both signal levels require a **double confirmation** ("Learn the risk" → "I understand the risk, confirm update") before installation runs.

## Installation

### Static plugin

The plugin is distributed as the npm package `dsh-update-check` (`plugin/` directory) and is mounted into the host composition, loading automatically when DSH starts:

1. **Install the package**: copy the `plugin/` directory into your profile's `node_modules` (Windows default: `C:\Users\<you>\.dsh\profiles\<profile>\node_modules\dsh-update-check\`, containing `package.json` + `lib/`);
2. **Mount it**: edit that profile's `cordis.patch.yml` and append:

   ```yaml
   - insert:
       - id: upd-check
         name: 'dsh-update-check'
   ```

3. **Restart DSH**: it takes effect without any manual loading and stays resident (no reinstall needed after DSH updates).

> Note: the Host exposes `GET /upd-check/api/check` and `POST /upd-check/api/install` (plus `GET /upd-check/api/install/status` for polling) through the host `webServer` (the Host declares `inject: ['webServer']` as a hard dependency so routes register after the service is ready). The browser client bundle (ModuleLoader format) is auto-bundled by dsh's client-modules via `exports["./client"]` + the `dsh.client` field in `package.json`; it mounts the `shell.overlay` banner and registers the **dedicated "Check for updates" page** (`settings.section`, same level as General / Models / Plugins).

## How it works

| Side | Responsibility |
| --- | --- |
| Host (`plugin/lib/index.js`) | Fetches GitHub official APIs, reads the locally installed version (`npm ls -g` → `npm root -g` + read package.json), compares versions, detects breaking changes, and installs **the exact version detected by the check** (`npm install -g @deepseek-ai/dsh@<version>`, falling back to `@latest` when no check result exists; resolves the real `npm.cmd`/`npm` path and redirects the npm cache to a sandbox-writable directory to avoid permission/sandbox install failures). The install is a **background job**: `POST /upd-check/api/install` starts it, `GET /upd-check/api/install/status` polls progress/stage/file changes. On Windows it prefers running through **PowerShell** (falling back to `cmd.exe`/`sh`). |
| Client (`plugin/lib/client.js`) | `shell.overlay` top banner + the dedicated Settings page (`settings.section`); during install it shows a **progress bar with percentage on the right** + a **file-change window**; after success it shows a **green popup asking to restart** and green status text. |
| Communication | `webServer` HTTP routes + same-origin fetch |

**Three-level network fallback**:

1. `web.fetch` (when a fetch provider is mounted);
2. `subprocess` running `node -` (script fed via stdin) with the standard `fetch` (auto-follows redirects);
3. When the first two fail (typical case: **hosts hijacked by third-party tools** such as Steamcommunity302 pointing `github.com` at `127.0.0.1` with a self-signed cert) → the script resolves real IPs via `dns.resolve4`, connects directly with `servername`/`Host` headers, manually follows redirects, and retries IP by IP.

## Compatibility and known limitations

| Item | Status | Notes |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | Shell fallback chain: Windows uses **PowerShell → cmd.exe** (and `sh` on POSIX); node resolution tries `node` → `node.exe`; no hard-coded paths |
| DSH installed via npm globally | ✅ | Local version read via `npm ls -g @deepseek-ai/dsh` / `npm root -g` |
| pnpm / bun / git clone installs | ⚠️ | Local version may be unreadable; banner shows "Latest version X (cannot read local version)"; remote check is unaffected |
| hosts hijacking (Steamcommunity302 etc.) | ✅ | Built-in DNS direct-connect bypass |
| Deployments without a fetch provider | ✅ | Node direct-connect fallback |
| GitHub anonymous API rate limit | ⚠️ | 60 req/h/IP; one auto-check per page load plus on-demand manual checks are usually enough |
| Install update | ⚠️ | Installs the exact version detected by the check (`@deepseek-ai/dsh@<version>`, fallback `@latest`; npm path resolved + cache redirected to a sandbox-writable directory); only works for npm-managed installs; if the global directory itself is not writable, a manual-run hint is shown |
| DSH version adaptation | ⚠️ | Slot names (`shell.overlay`, `settings.section`) verified against 0.1.0-rc.x; if the slot tree changes in future versions the UI simply won't mount (no crash), and Host checks keep working |
| Breaking-change detection | ✅ | Semver detection is deterministic; release-note keywords are graded (strong → breaking; weak → yellow warning with matched keywords and snippets); any hit triggers yellow warning + double confirmation |
| Static plugin | ✅ | Auto-loads with DSH; no reinstall after DSH restart/update; Host has no `harness`, uses same-origin `webServer` HTTP (localhost only) |

## Troubleshooting

- **"Cannot reach GitHub" all the time**: check `C:\Windows\System32\drivers\etc\hosts` for hijack lines mapping `github.com` / `api.github.com` → `127.0.0.1` (common with Steamcommunity302 and similar tools); delete those lines (admin rights) or rely on the built-in DNS bypass, then click **Retry**.
- **Plugin not working**: confirm `node_modules/dsh-update-check` exists, the `cordis.patch.yml` line is present, and **restart DSH**; check `GET /upd-check/api/check` returns JSON.
- **No "Check for updates" page in Settings**: make sure the client bundle was scanned (restart + refresh); the page is now a **top-level Settings page** (same level as General/Models/Plugins), not inside the Plugins tab.
- **"Cannot read local version"**: DSH is not installed as a global npm package; the remote version still displays normally.
- **Install fails after clicking "Update"**: the plugin resolves the real npm path and redirects the npm cache to a sandbox-writable directory; if it still fails, the failure window shows the concrete reason. On EPERM/EACCES/permission errors, the DSH file sandbox likely cannot write the npm global directory (`%APPDATA%\npm`); close DSH and run the install command manually in a terminal (use the detected version, e.g. `npm install -g @deepseek-ai/dsh@0.1.0-rc.8`, or `@next` when the version is only published there).
- **Install says "success" but the version never changes**: the GitHub check may detect a newer tag (e.g. `dsh-v0.1.0-rc.8`) while npm's `latest` dist-tag still points to the old version (rc.8 is published under `next`). Since v1.6.0 the plugin installs the exact version detected by the check, so this no longer happens. If you still see it, restart DSH and manually run `npm install -g @deepseek-ai/dsh@<detected-version>`.
- **The banner reappears after "Later"**: since v1.5.0 the client remembers the ignored version; the same version won't pop up again after connection resets, page reloads, or even settings-page manual checks. To act on the update later, click "Install update" on the Settings page; the banner only reappears when a new version (`latest`) is published.
- **Settings "Check now" pops the top banner**: since v1.5.0 manual checks only update the Settings page state and no longer pop the top banner (neither "Checking for updates…" nor the ignored risk signal); the top banner is reserved for auto-checks and banner actions (Retry / Update now).
- **Yellow warning false positives/negatives**: breaking detection primarily relies on semver (deterministic); release-note keywords are a best-effort supplement. Weak signals only say "possibly" and show the original snippets for verification; if the official notes don't contain the keywords, a release-notes signal may be missed, but the version signal still covers it.

## Development & contribution

- Plugin source: `plugin/` directory = the npm package `dsh-update-check` (`lib/index.js` Host + `lib/client.js` browser bundle).
- Local validation: `node scripts/check-src.js` (52 syntax + contract checks; CI runs the same).
- Issues and PRs are welcome.

## License

[MIT](LICENSE) © nmbzth
