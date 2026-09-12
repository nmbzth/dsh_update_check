[**中文 README**](README.zh-CN.md) · [English](README.md)

# dsh_update_check

> dsh_update_check is a DSH plugin that automatically compares the official upstream DeepSeek Harness repository and prompts you when an update is available.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

1. **Check on startup (toggleable)** — checks 3 seconds after the page load (and again on `connection/reset`); the DSH check and the plugin's own check are **separate switches**.
2. **Based on the official GitHub repo** — tries `releases/latest` API → releases list → `tags` API in order, with a 10 s timeout; tags with a `dsh-v*` prefix parse correctly (semver-style comparison, including rc/beta prereleases).
3. **Structured upstream changes** — the release notes are parsed into sections (**new features / bug fixes / improvements / other / SDK**); the Chinese block is preferred; every item keeps its **full text**; items matching breaking keywords are flagged as strong/weak signals and highlighted.
4. **Plugin self-update check** — compares the local `package.json` version with the repo's `plugin/package.json` (informational: the DSH update itself is always manual).
5. **Sustainable hot-update framework (for this plugin)** — the host half is split into a **stable supervisor** and a **hot-swappable implementation**, so the detection/parsing logic can be replaced without restarting DSH; the settings page has a **manual** "Hot-update plugin" button (never silent, never automatic). See [Hot update](#hot-update).
6. **Two-state top banner** — **concise** (one line "Update available: DSH X → Y" + Details / Later) or **verbose** (details expanded immediately), controlled by a switch; **no auto-dismiss**; "Later" remembers the version so it does not pop up again until a newer version appears.
7. **Dedicated settings page** — a standalone **"↑ Check for updates"** page in Settings (same level as General / Models / Plugins), with three cards:
   - **DSH update**: current/latest version, publish time, last check, status, "Check now", release-notes link, **full breaking-change descriptions** (matched keyword + complete item text), the categorized change list, and a dim diagnostics line showing **how the local version was detected** (module resolution + path, or npm global probe);
   - **Plugin self-update**: current/latest plugin version, status and the **hot-update button**;
   - **Settings**: the three switches below.
8. **Three persisted switches** — check DSH on startup / check the plugin itself on startup / show details in the top banner (verbose or concise). Stored in `$DSH_HOME/update-check.json`.
9. **Breaking-change grading** — semver (deterministic: major change, or minor change during 0.x) plus release-note keywords:
   - **Strong signals** (`breaking change`, `破坏性更新`, `破坏…兼容`, etc.) → yellow warning "breaking update";
   - **Weak signals** (`incompatible`, `migration`, `removed`, `deprecated`, `不兼容`, `迁移`, `移除`, etc.) → yellow warning "possibly breaking update", with the complete matched item shown for you to judge.
   - Informational only — the DSH update itself is always performed by you; no DSH install flow.
10. **Network failure notice** — when GitHub is unreachable, the top banner shows "Cannot reach GitHub, check failed" with **Retry / Close**.
11. **Bilingual UI (Chinese / English)** — the plugin registers zh/en dictionaries through the DSH client `locale` service and follows the active language live (banner, settings page and nav label); it falls back to the built-in Chinese dictionary when the locale service is unavailable.

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
| Host — supervisor (`plugin/lib/index.js`) | Process-level infrastructure: three-level network fallback, settings persistence, HTTP routes, and the **hot-swap / self-update engine**. |
| Host — implementation (`plugin/lib/impl.js`) | Hot-swappable detection logic: local DSH version detection (module resolution → npm global fallback, reporting the channel it used), release-notes parsing, section classification, graded breaking-change signals, version comparison. Bound to the supervisor by the `API_VERSION` / `IMPL_CONTRACT` contract. |
| Client (`plugin/lib/client.js`) | `shell.overlay` top banner + the dedicated Settings page (`settings.section`); shows update reminders, breaking-risk details with matched keyword snippets, network errors, and the hot-update button. |
| Communication | `webServer` HTTP routes (`/upd-check/api/check`, `/upd-check/api/settings`, `/upd-check/api/self-update`) + same-origin fetch |

**Three-level network fallback**:

1. `web.fetch` (when a fetch provider is mounted);
2. `subprocess` running `node -` (script fed via stdin) with the standard `fetch` (auto-follows redirects);
3. When the first two fail (typical case: **hosts hijacked by third-party tools** such as Steamcommunity302 pointing `github.com` at `127.0.0.1` with a self-signed cert) → the script resolves real IPs via `dns.resolve4`, connects directly with `servername`/`Host` headers, manually follows redirects, and retries IP by IP.

## Hot update

The plugin can update **itself** from its own GitHub releases, without a DSH restart for most changes.

**Layering and boundaries**

| File | Role | Takes effect |
| --- | --- | --- |
| `lib/impl.js` | Detection/parsing implementation (hot-swappable) | immediately — re-imported with a new `?v=<version>` and swapped atomically |
| `lib/client.js` | Browser UI bundle | immediately — `dsh-client-hmr` serves the new rev and the page reloads the bundle in place |
| `lib/index.js` | Supervisor: services, settings, network, routes | on the next DSH start (`restartRequired` in the response) |
| `package.json` | Version marker | immediately (version display) |

The supervisor is deliberately *not* self-modifying at runtime: it is the code that performs the update, so replacing it live would mean pulling the rug out from under the running process. Changes to it are written to disk and reported as `restartRequired`.

**Update flow** (`POST /upd-check/api/self-update`, manual only)

1. Read the target tag from `releases/latest` (falls back to `contents/plugin/package.json` when no release exists);
2. Download the four files (`lib/client.js`, `lib/impl.js`, `lib/index.js`, `package.json`) from that tag through the contents API;
3. **Decide what changed** by comparing the git blob SHA of each download against the **local** file, and verify the download integrity against the SHA the API reports;
4. **Validate everything before touching live files**: candidates are written to `lib/.stage/` — `package.json` shape, `client.js` parsed with `node --check`, `impl.js` actually `import()`-ed and contract-checked, `index.js` checked for its key markers;
5. **Back up** the files being replaced to `lib/.bak/<old-version>_<timestamp>/`;
6. **Atomically replace** each file with a same-directory `rename`;
7. **Hot-swap the engine**; then swap in the new implementation. If it cannot load, restore `impl.js`/`client.js` from the backup and keep serving with the previous engine still in memory;
8. Append the attempt to `$DSH_HOME/update-check-history.json` (successes and failures; last 20).

Any failure before or during step 6 leaves the disk untouched; a failure at step 7 rolls back. The response reports `from`/`to`, `hot`, `clientReloaded`, `restartRequired`, the per-file `changed` flags, and the backup path.

**Endpoints**

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/upd-check/api/self-update` | Installed version, live engine version/contract, hot-file set, restart scope, recent history |
| `POST` | `/upd-check/api/self-update` | `{"action":"update"}` performs the update; `{"action":"update","force":true}` updates even when versions are equal (content is still diffed); `{"action":"reload"}` re-imports the implementation from disk without any download |

**Releasing (the content source)**

```powershell
pwsh -NoProfile -File scripts/release.ps1
```

Runs both contract suites as a gate, extracts the version's CHANGELOG section as the release notes, commits, pushes, creates the tag and the GitHub Release (all idempotent). A published release is what the plugin's self-update consumes.

> On this machine `github.com` git transport is unavailable (connect timeout / SSL verification failure), so the push goes through the Git Data API (`scripts/push-via-api.ps1`); local and remote refs therefore stay **content-identical but SHA-divergent**, which is expected.

## Compatibility and known limitations

| Item | Status | Notes |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | Shell fallback chain (`cmd.exe` → `sh`); node resolution tries `node` → `node.exe`; no hard-coded paths |
| DSH installed via npm globally | ✅ | Local version read via `npm ls -g @deepseek-ai/dsh` / `npm root -g` |
| pnpm / bun / git clone installs | ✅ | Local version is resolved through Node's module system (`require.resolve('@deepseek-ai/dsh/package.json')`, ~6 ms, no shell), so non-npm layouts are covered; `npm ls -g` remains the fallback and the settings page shows which channel answered |
| hosts hijacking (Steamcommunity302 etc.) | ✅ | Built-in DNS direct-connect bypass |
| Deployments without a fetch provider | ✅ | Node direct-connect fallback |
| GitHub anonymous API rate limit | ⚠️ | 60 req/h/IP; one auto-check per page load plus on-demand manual checks are usually enough |
| DSH version adaptation | ⚠️ | Slot names (`shell.overlay`, `settings.section`) verified against 0.1.0-rc.x; if the slot tree changes in future versions the UI simply won't mount (no crash), and Host checks keep working |
| Breaking-change detection | ✅ | Semver detection is deterministic; release-note keywords are graded (strong → breaking; weak → yellow warning with the complete matched item) |
| Settings storage | ✅ | `$DSH_HOME/update-check.json` (atomic write; invalid content falls back to defaults); the three switches survive restarts |
| Plugin hot update | ✅ | `lib/impl.js` + `lib/client.js` apply without a DSH restart; `lib/index.js` needs the next start (`restartRequired`); every attempt is validated first, backed up, and rolled back on failure |
| Plugin hot update, no releases yet | ✅ | Falls back to `contents/plugin/package.json` on the default branch when the repo has no releases; create releases with `scripts/release.ps1` |
| Plugin hot update, offline | ⚠️ | Needs GitHub reachability (same three-level fallback as the check); nothing is written when the download fails |
| Static plugin | ✅ | Auto-loads with DSH; no reinstall after DSH restart/update; Host has no `harness`, uses same-origin `webServer` HTTP (localhost only) |

## Troubleshooting

- **"Cannot reach GitHub" all the time**: check `C:\Windows\System32\drivers\etc\hosts` for hijack lines mapping `github.com` / `api.github.com` → `127.0.0.1` (common with Steamcommunity302 and similar tools); delete those lines (admin rights) or rely on the built-in DNS bypass, then click **Retry**.
- **Plugin not working**: confirm `node_modules/dsh-update-check` exists, the `cordis.patch.yml` line is present, and **restart DSH**; check `GET /upd-check/api/check` returns JSON.
- **Hot update reports `restartRequired`**: the release also changed `lib/index.js` (the supervisor). The new file is already on disk; it takes effect on the next DSH start. `GET /upd-check/api/self-update` shows the live engine version.
- **Hot update failed**: nothing was left half-written — the response carries the reason (e.g. `impl-contract-mismatch`, `remote-client-syntax`, `http-404`) and the attempt is recorded in `$DSH_HOME/update-check-history.json`; the backup of the previous version is under `plugin/lib/.bak/`.
- **No "Check for updates" page in Settings**: make sure the client bundle was scanned (restart + refresh); the page is a **top-level Settings page** (same level as General/Models/Plugins).
- **"Cannot read local version"**: DSH is not installed as a global npm package; the remote version still displays normally.
- **The banner reappears after "Later"**: the client remembers the ignored version; the same version won't pop up again after connection resets, page reloads, or even settings-page manual checks. The banner only reappears when a new version (`latest`) is published.
- **Settings "Check now" pops the top banner**: manual checks only update the Settings page state and no longer pop the top banner; the top banner is reserved for auto-checks and banner actions (Retry).
- **"the anonymous API limit is exhausted"**: GitHub's unauthenticated API limit is 60 requests/hour per IP. The plugin tells this apart from a real network failure (HTTP 403/429 → `rate-limit`) and shows a dedicated message instead of "cannot reach GitHub"; plugin self-update uses a different repository and keeps working. Retry after the window resets (`/rate_limit` reports the reset time).
- **Yellow warning false positives/negatives**: breaking detection primarily relies on semver (deterministic); release-note keywords are a best-effort supplement. Weak signals only say "possibly" and show the original snippets for verification; if the official notes don't contain the keywords, a release-notes signal may be missed, but the version signal still covers it.

## Development & contribution

- Plugin source: `plugin/` directory = the npm package `dsh-update-check` (`lib/index.js` supervisor + `lib/impl.js` hot-swappable implementation + `lib/client.js` browser bundle).
- Local validation:
  - `node scripts/check-src.js` — syntax and source-contract checks (95 assertions; also run by CI);
  - `node scripts/check-runtime.mjs` — runtime contract checks: loads the real host half with a stub `ctx` in a temp sandbox and drives its real HTTP handlers, covering detection payloads, settings, engine contract, and the whole hot-update path including **zero-damage rollback** and both version-detection channels (56 assertions; also run by CI).
  - `node scripts/verify-real-selfupdate.mjs [package-dir]` — **opt-in, needs network**: copies a package into a temp dir, downgrades it to `0.0.1` with content drift, and performs a **real** self-update from the published GitHub Release, then asserts the files, the live engine version and the backup. Never touches the source directory; prints `SKIPPED` and exits 0 when GitHub is unreachable.
- Release: `pwsh -NoProfile -File scripts/release.ps1` (bump `plugin/package.json`, write the CHANGELOG section, then run it).
- When you change the supervisor↔implementation contract, bump `IMPL_CONTRACT` in `lib/index.js` **and** `API_VERSION` in `lib/impl.js`; CI compares them.
- Issues and PRs are welcome.

## License

[MIT](LICENSE) © nmbzth
