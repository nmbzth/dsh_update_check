[**中文 README**](README.zh-CN.md) · [English](README.md)

# dsh_update_check

> dsh_update_check is a DSH plugin that automatically compares the official upstream DeepSeek Harness repository and prompts you when an update is available.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

1. **Check on startup** — checks the official repository 3 seconds after the page loads (and again on `connection/reset`).
2. **Based on the official GitHub repo** — tries `releases/latest` API → `tags` API → releases page HTML in order, with a 10 s timeout; tags with a `dsh-v*` prefix parse correctly (semver-style comparison, including rc/beta prereleases).
3. **Network failure notice** — when GitHub is unreachable, the top banner shows "Cannot reach GitHub, check failed" with **Retry / Close**.
4. **Persistent update reminder** — "New version: current X → latest Y" with **Later**, **no auto-dismiss timer** (only clicking closes it). After clicking **Later**, the same version never pops up again (not even from the settings page's manual "Check now"); it only reappears when a new version (`latest` changes) is published.
5. **Dedicated settings page** — a standalone **"↑ Check for updates"** page in Settings (same level as General / Models / Plugins, **listed last**), showing current version / latest version / last check / status, with a "Check now" button.
6. **Breaking-change warning (important)** — DSH has announced future breaking updates that may be incompatible with older plugins. The plugin detects breaking updates with two signals, **graded**:
   - **Semver** (deterministic): major change, or minor change during 0.x.
   - **Official release notes**: keyword matching, **graded**:
     - **Strong signals** (`breaking change`, `破坏性更新`, `破坏…兼容`, etc.) → yellow highlight + ⚠️ "Breaking update detected";
     - **Weak signals** (`incompatible`, `migration`, `removed`, `deprecated`, `不兼容`, `迁移`, `移除`, etc.) → yellow highlight + ⚠️ "Possibly breaking update", and the details page **lists the matched keywords and the original snippets** for you to verify.
7. **Check only, no install** — the plugin never installs anything: it only detects and reminds. Updates are applied manually (e.g. `npm install -g @deepseek-ai/dsh@latest`).

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

> Note: the Host exposes `GET /upd-check/api/check` (check only — no install routes) through the host `webServer` (the Host declares `inject: ['webServer']` as a hard dependency so routes register after the service is ready). The browser client bundle (ModuleLoader format) is auto-bundled by dsh's client-modules via `exports["./client"]` + the `dsh.client` field in `package.json`; it mounts the `shell.overlay` banner and registers the **dedicated "Check for updates" page** (`settings.section`, same level as General / Models / Plugins).

## How it works

| Side | Responsibility |
| --- | --- |
| Host (`plugin/lib/index.js`) | Fetches GitHub official APIs, reads the locally installed version (`npm ls -g` → `npm root -g` + read package.json), compares versions, and grades breaking-change signals. No install functionality. |
| Client (`plugin/lib/client.js`) | `shell.overlay` top banner + the dedicated Settings page (`settings.section`); shows update reminders, breaking-risk details with matched keyword snippets, and network errors. |
| Communication | `webServer` HTTP route (`/upd-check/api/check`) + same-origin fetch |

**Three-level network fallback**:

1. `web.fetch` (when a fetch provider is mounted);
2. `subprocess` running `node -` (script fed via stdin) with the standard `fetch` (auto-follows redirects);
3. When the first two fail (typical case: **hosts hijacked by third-party tools** such as Steamcommunity302 pointing `github.com` at `127.0.0.1` with a self-signed cert) → the script resolves real IPs via `dns.resolve4`, connects directly with `servername`/`Host` headers, manually follows redirects, and retries IP by IP.

## Compatibility and known limitations

| Item | Status | Notes |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | Shell fallback chain (`cmd.exe` → `sh`); node resolution tries `node` → `node.exe`; no hard-coded paths |
| DSH installed via npm globally | ✅ | Local version read via `npm ls -g @deepseek-ai/dsh` / `npm root -g` |
| pnpm / bun / git clone installs | ⚠️ | Local version may be unreadable; banner shows "Latest version X (cannot read local version)"; remote check is unaffected |
| hosts hijacking (Steamcommunity302 etc.) | ✅ | Built-in DNS direct-connect bypass |
| Deployments without a fetch provider | ✅ | Node direct-connect fallback |
| GitHub anonymous API rate limit | ⚠️ | 60 req/h/IP; one auto-check per page load plus on-demand manual checks are usually enough |
| Install update | ❌ | **Not provided by design** — the plugin only detects and reminds; apply updates manually (`npm install -g @deepseek-ai/dsh@latest`) |
| DSH version adaptation | ⚠️ | Slot names (`shell.overlay`, `settings.section`) verified against 0.1.0-rc.x; if the slot tree changes in future versions the UI simply won't mount (no crash), and Host checks keep working |
| Breaking-change detection | ✅ | Semver detection is deterministic; release-note keywords are graded (strong → breaking; weak → yellow warning with matched keywords and snippets) |
| Static plugin | ✅ | Auto-loads with DSH; no reinstall after DSH restart/update; Host has no `harness`, uses same-origin `webServer` HTTP (localhost only) |

## Troubleshooting

- **"Cannot reach GitHub" all the time**: check `C:\Windows\System32\drivers\etc\hosts` for hijack lines mapping `github.com` / `api.github.com` → `127.0.0.1` (common with Steamcommunity302 and similar tools); delete those lines (admin rights) or rely on the built-in DNS bypass, then click **Retry**.
- **Plugin not working**: confirm `node_modules/dsh-update-check` exists, the `cordis.patch.yml` line is present, and **restart DSH**; check `GET /upd-check/api/check` returns JSON.
- **No "Check for updates" page in Settings**: make sure the client bundle was scanned (restart + refresh); the page is a **top-level Settings page** (same level as General/Models/Plugins).
- **"Cannot read local version"**: DSH is not installed as a global npm package; the remote version still displays normally.
- **The banner reappears after "Later"**: the client remembers the ignored version; the same version won't pop up again after connection resets, page reloads, or even settings-page manual checks. The banner only reappears when a new version (`latest`) is published.
- **Settings "Check now" pops the top banner**: manual checks only update the Settings page state and no longer pop the top banner; the top banner is reserved for auto-checks and banner actions (Retry).
- **Yellow warning false positives/negatives**: breaking detection primarily relies on semver (deterministic); release-note keywords are a best-effort supplement. Weak signals only say "possibly" and show the original snippets for verification; if the official notes don't contain the keywords, a release-notes signal may be missed, but the version signal still covers it.

## Development & contribution

- Plugin source: `plugin/` directory = the npm package `dsh-update-check` (`lib/index.js` Host + `lib/client.js` browser bundle).
- Local validation: `node scripts/check-src.js` (syntax + contract checks; CI runs the same).
- Issues and PRs are welcome.

## License

[MIT](LICENSE) © nmbzth
