# dsh_update_check

> dsh_update_check 是一个 dsh 插件，能自动检查 dsharness 官方上游仓库比对差异并提示更新。
>
> A dynamic Cordis plugin for DeepSeek Harness: auto-checks the official GitHub repo for new releases on startup with a top banner, plus a manual check/install page under Settings → Plugins.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 功能特性

1. **打开即检**：页面加载 3 秒后自动向官方仓库检查一次（`connection/reset` 时补触发）。
2. **基于官方 GitHub**：按序尝试 `releases/latest` API → `tags` API → releases 页面 HTML，10 秒超时，`dsh-v*` 前缀的 tag 也能正确解析（semver 风格比较，含 rc/beta 预发布）。
3. **网络不佳有提示**：连不上 GitHub 时，顶部横幅显示「无法连接 GitHub，检查失败」+ 「重试 / 关闭」。
4. **发现更新常驻提醒**：「发现新版本：当前 X → 最新 Y」+ 「立即更新 / 稍后」，**无自动消失计时器**，只有点击才关闭。
5. **设置页手动操作**：设置 → 插件 →「检查更新」页，展示 当前版本 / 最新版本 / 上次检查 / 状态，可「立即检查」「安装更新」。
6. **破坏性更新预警（重要）**：DSH 官方公告未来将有破坏性更新，可能与旧插件不兼容。插件双重信号检测破坏性更新——① 语义版本（major 变化，或 0.x 阶段 minor 变化）；② 官方发布说明关键词，**分级判定**：
   - **强信号**（breaking change / 破坏性更新 / 破坏…兼容 等）→ 黄色高亮 + ⚠️「检测到破坏性更新」；
   - **弱信号**（不兼容 / incompatible / 迁移 / 移除 / deprecated 等）→ 同样黄色高亮 + ⚠️「检测到**可能**破坏性更新」，二次确认页会**列出命中的关键词与原文片段**（如「…数据结构不兼容…」），由你核实是否真的影响插件；
   - 两种信号都必须经过「了解风险 → 我了解风险，确认更新」**二次确认**才会执行安装。

## 安装方式

### 方式 A：静态插件（推荐，重启不丢）

插件以 npm 包 `dsh-update-check` 提供（`plugin/` 目录），挂进宿主 composition，随 DSH 启动自动加载：

1. **安装包**：把 `plugin/` 目录放入 profile 的 `node_modules`（Windows 默认 `C:\Users\<你>\.dsh\profiles\<profile>\node_modules\dsh-update-check\`，含 `package.json` + `lib/`）；
2. **挂载**：编辑该 profile 的 `cordis.patch.yml`，追加：

   ```yaml
   - insert:
       - id: upd-check
         name: 'dsh-update-check'
   ```

3. **重启 DSH**：生效后无需任何手动加载，插件常驻（更新 DSH 后也不用重装）。

> 说明：静态 Host 插件通过宿主 `webServer` 暴露 `GET /upd-check/api/check`、`POST /upd-check/api/install` 两个同源 HTTP 接口；浏览器端 client bundle（ModuleLoader 格式）经 `exports["./client"]` + `package.json dsh.client` 声明被 dsh 的 client-modules 自动扫描打包，挂载 `shell.overlay` 横幅与 `settings.plugins.tab`「检查更新」页。

### 方式 B：动态插件（可选）

动态插件由 DSH 智能体创建，随当前进程存活（重启 DSH 后需重新加载）：

1. 把本仓库（至少 `src/host.js` 与 `src/client.js`）放进 DSH 的工作区；
2. 在 DSH 对话中输入：

   > 读取本仓库 `src/host.js` 和 `src/client.js`，用 cordis_define 创建一个名为「更新检查」的插件：`code.host` 使用 host.js 的完整内容，`code.client` 使用 client.js 的完整内容；然后 cordis_run 激活，并在需要时处理审批。

3. 刷新页面：3 秒后顶部出现检查结果横幅；设置 → 插件 → 出现「检查更新」页签。

## 工作原理

| 半区 | 职责 |
| --- | --- |
| Host（`plugin/lib/index.js` 或 `src/host.js`） | 拉取 GitHub 官方 API、读取本地已装版本（`npm ls -g` → `npm root -g` + 读 package.json）、版本比较、破坏性更新判定、执行 `npm install -g @deepseek-ai/dsh@latest` |
| Client（`plugin/lib/client.js` 或 `src/client.js`） | `shell.overlay` 顶部横幅 + `settings.plugins.tab`「检查更新」页 |
| 通信 | 静态：`webServer` HTTP 路由 + 同源 fetch；动态：`harness.handle` / `host.call` |

**网络传输三级容错**：

1. `web.fetch`（若部署挂载了 fetch provider）；
2. `subprocess` 跑 `node -`（stdin 喂脚本）标准 `fetch`（自动跟随重定向）；
3. 前两者失败（典型场景：**hosts 被第三方工具劫持**，如 Steamcommunity302 把 `github.com` 指向 `127.0.0.1` 并返回自签证书）→ 脚本内用 `dns.resolve4` 取真实 IP，以 `servername`/`Host` 头直连，手动跟随重定向、逐个 IP 重试。

## 兼容性与已知限制

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | shell 双回退（`cmd.exe` → `sh`），node 解析双回退（`node` → `node.exe`）；无硬编码路径 |
| npm 全局安装的 DSH | ✅ | 本地版本通过 `npm ls -g @deepseek-ai/dsh` / `npm root -g` 读取 |
| pnpm / bun / git clone 安装 | ⚠️ | 本地版本可能读不到，横幅显示「最新版本 X（无法读取本地版本）」；远端检查不受影响 |
| hosts 劫持（Steamcommunity302 等） | ✅ | 内置 DNS 直连绕过 |
| 未挂载 fetch provider 的部署 | ✅ | node 直连通道兜底 |
| GitHub 匿名 API 限流 | ⚠️ | 60 次/小时/IP；每次页面加载自动检查 1 次，手动检查按需触发，一般足够 |
| 安装更新 | ⚠️ | 执行 `npm install -g @deepseek-ai/dsh@latest`，仅对 npm 管理安装生效；非 npm 安装请手动升级 |
| DSH 版本适配 | ⚠️ | 插槽名（`shell.overlay`、`settings.plugins.tab`）以 0.1.0-rc.x 实测为准；未来版本若插槽树变化，UI 不挂载但不会崩溃，Host 检查功能不受影响 |
| 破坏性更新判定 | ✅ | semver 判定确定性可靠；发布说明关键词为**高置信度措辞**，已修复「存储格式不兼容」类描述误报；两者任一命中即黄色预警 + 二次确认 |
| 静态插件（方式 A） | ✅ | 随 DSH 启动自动加载，重启/更新 DSH 后无需重装；Host 无 `harness`，走 `webServer` HTTP 接口（同源，仅本机监听） |

## 疑难解答

- **一直显示「无法连接 GitHub」**：先检查 hosts（`C:\Windows\System32\drivers\etc\hosts`）是否有 `github.com` / `api.github.com` → `127.0.0.1` 的劫持行（常见于 Steamcommunity302 等加速工具）；有则删除这些行（需管理员），或直接依赖插件内置的 DNS 绕过。也可尝试点「重试」。
- **静态插件未生效**：确认 `node_modules/dsh-update-check` 存在、`cordis.patch.yml` 已插入行、**重启 DSH**；检查 `GET /upd-check/api/check` 是否返回 JSON。
- **设置页没有「检查更新」页签**：动态方式下确认 Client 半区已运行（查看运行卡片）；静态方式下确认 client bundle 被扫描（重启后刷新页面）。
- **「无法读取本地版本」**：DSH 不是通过 npm 全局安装的；远端版本仍会正常显示。
- **黄色预警误报/漏报**：破坏性判定以语义版本为主（确定性），发布说明关键词为辅；若官方发布说明措辞不含关键词，可能漏报 release-notes 信号，但版本信号仍会兜底。

## 开发与贡献

- **静态包**（推荐分发形态）：`plugin/` 目录 = npm 包 `dsh-update-check`（`lib/index.js` Host + `lib/client.js` 浏览器 bundle）。
- **动态版**（开发/调试形态）：`src/host.js` / `src/client.js` 与 `cordis_define` 的 `code.host` / `code.client` 一一对应。
- 本地校验：`node scripts/check-src.js`（45 项语法 + 契约检查，CI 同样执行）。
- 欢迎提交 Issue / PR。

## License

[MIT](LICENSE) © nmbzth
