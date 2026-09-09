[**中文 README**](README.zh-CN.md) · [English](README.md)

# dsh_update_check

> dsh_update_check is a DSH plugin that automatically compares the official upstream DeepSeek Harness repository and prompts you when an update is available.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

1. **Check on startup (toggleable)** — checks 3 seconds after the page load (and again on `connection/reset`); the DSH check and the plugin's own check are **separate switches**.
2. **Based on the official GitHub repo** — tries `releases/latest` API → releases list → `tags` API in order, with a 10 s timeout; tags with a `dsh-v*` prefix parse correctly (semver-style comparison, including rc/beta prereleases).
3. **Structured upstream changes** — the release notes are parsed into sections (**new features / bug fixes / improvements / other / SDK**); the Chinese block is preferred; every item keeps its **full text**; items matching breaking keywords are flagged as strong/weak signals and highlighted.
4. **Plugin self-update check** — compares the local `package.json` version with the repo's `plugin/package.json` (informational only; replace the `plugin/` directory manually).
5. **Two-state top banner** — **concise** (one line "Update available: DSH X → Y" + Details / Later) or **verbose** (details expanded immediately), controlled by a switch; **no auto-dismiss**; "Later" remembers the version so it does not pop up again until a newer version appears.
6. **Dedicated settings page** — a standalone **"↑ Check for updates"** page in Settings (same level as General / Models / Plugins), with three cards:
   - **DSH update**: current/latest version, publish time, last check, status, "Check now", release-notes link, **full breaking-change descriptions** (matched keyword + complete item text) and the categorized change list;
   - **Plugin self-update**: current/latest plugin version and status;
   - **Settings**: the three switches below.
7. **Three persisted switches** — check DSH on startup / check the plugin itself on startup / show details in the top banner (verbose or concise). Stored in `$DSH_HOME/update-check.json`.
8. **Breaking-change grading** — semver (deterministic: major change, or minor change during 0.x) plus release-note keywords:
   - **Strong signals** (`breaking change`, `破坏性更新`, `破坏…兼容`, etc.) → yellow warning "breaking update";
   - **Weak signals** (`incompatible`, `migration`, `removed`, `deprecated`, `不兼容`, `迁移`, `移除`, etc.) → yellow warning "possibly breaking update", with the complete matched item shown for you to judge.
   - Informational only — no install, no confirmation flow.
9. **Network failure notice** — when GitHub is unreachable, the top banner shows "Cannot reach GitHub, check failed" with **Retry / Close**.
10. **Bilingual UI (Chinese / English)** — the plugin registers zh/en dictionaries through the DSH client `locale` service and follows the active language live (banner, settings page and nav label); it falls back to the built-in Chinese dictionary when the locale service is unavailable.

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

> Note: the Host exposes `GET /upd-check/api/check` through the host `webServer` (the Host declares `inject: ['webServer']` as a hard dependency so routes register after the service is ready). The browser client bundle (ModuleLoader format) is auto-bundled by dsh's client-modules via `exports["./client"]` + the `dsh.client` field in `package.json`; it mounts the `shell.overlay` banner and registers the **dedicated "Check for updates" page** (`settings.section`, same level as General / Models / Plugins).

## How it works

| Side | Responsibility |
| --- | --- |
| Host (`plugin/lib/index.js`) | Fetches GitHub official APIs, reads the locally installed version (`npm ls -g` → `npm root -g` + read package.json), compares versions, and grades breaking-change signals. |
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
| DSH version adaptation | ⚠️ | Slot names (`shell.overlay`, `settings.section`) verified against 0.1.0-rc.x; if the slot tree changes in future versions the UI simply won't mount (no crash), and Host checks keep working |
| Breaking-change detection | ✅ | Semver detection is deterministic; release-note keywords are graded (strong → breaking; weak → yellow warning with the complete matched item) |
| Settings storage | ✅ | `$DSH_HOME/update-check.json` (atomic write; invalid content falls back to defaults); the three switches survive restarts |
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
