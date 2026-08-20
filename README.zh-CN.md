[English](README.md) · [**中文 README**](README.zh-CN.md)

# dsh_update_check

> dsh_update_check 是一个 dsh 插件，能自动检查 dsharness 官方上游仓库比对差异并提示更新。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 功能特性

1. **打开即检**：页面加载 3 秒后自动向官方仓库检查一次（`connection/reset` 时补触发）。
2. **基于官方 GitHub**：按序尝试 `releases/latest` API → `tags` API → releases 页面 HTML，10 秒超时，`dsh-v*` 前缀的 tag 也能正确解析（semver 风格比较，含 rc/beta 预发布）。
3. **网络不佳有提示**：连不上 GitHub 时，顶部横幅显示「无法连接 GitHub，检查失败」+ 「重试 / 关闭」。
4. **发现更新常驻提醒**：「发现新版本：当前 X → 最新 Y」+ 「立即更新 / 稍后」，**无自动消失计时器**，只有点击才关闭；点「稍后」后同一版本不再弹出（设置页手动「立即检查」也不会重新弹出，出现新版本时才再次提醒）。
5. **独立设置页手动操作**：设置区新增**独立的「↑ 检查更新」页**（与「通用设置 / 模型 / 插件」同级，**排在设置区最后**），展示 当前版本 / 最新版本 / 上次检查 / 状态，可「立即检查」「安装更新」。
6. **安装进度可视化**：点「安装更新」后显示**右侧带百分比的进度条**，进度条下方是**文件变动窗口**，实时展示 npm 的 add / remove / change / reify 等输出；安装为后台任务 + 状态轮询，失败时窗口里会给出具体错误与手动修复提示。
7. **更新完成绿色提示**：安装成功后顶部**绿色弹窗**提示重启；设置页状态行变为**绿色文字「更新完成，等待手动重启」**。
8. **破坏性更新预警（重要）**：DSH 官方公告未来将有破坏性更新，可能与旧插件不兼容。插件双重信号检测破坏性更新——① 语义版本（major 变化，或 0.x 阶段 minor 变化）；② 官方发布说明关键词，**分级判定**：
   - **强信号**（breaking change / 破坏性更新 / 破坏…兼容 等）→ 黄色高亮 + ⚠️「检测到破坏性更新」；
   - **弱信号**（不兼容 / incompatible / 迁移 / 移除 / deprecated 等）→ 同样黄色高亮 + ⚠️「检测到**可能**破坏性更新」，二次确认页会**列出命中的关键词与原文片段**（如「…数据结构不兼容…」），由你核实是否真的影响插件；
   - 两种信号都必须经过「了解风险 → 我了解风险，确认更新」**二次确认**才会执行安装。

## 安装方式

### 静态插件

插件以 npm 包 `dsh-update-check` 提供（`plugin/` 目录），挂进宿主 composition，随 DSH 启动自动加载：

1. **安装包**：把 `plugin/` 目录放入 profile 的 `node_modules`（Windows 默认 `C:\Users\<你>\.dsh\profiles\<profile>\node_modules\dsh-update-check\`，含 `package.json` + `lib/`）；
2. **挂载**：编辑该 profile 的 `cordis.patch.yml`，追加：

   ```yaml
   - insert:
       - id: upd-check
         name: 'dsh-update-check'
   ```

3. **重启 DSH**：生效后无需任何手动加载，插件常驻（更新 DSH 后也不用重装）。

> 说明：Host 插件通过宿主 `webServer` 暴露 `GET /upd-check/api/check`、`POST /upd-check/api/install`、`GET /upd-check/api/install/status` 三个同源 HTTP 接口（Host 以 `inject: ['webServer']` 声明硬依赖，等服务就绪后再注册路由）；浏览器端 client bundle（ModuleLoader 格式）经 `exports["./client"]` + `package.json dsh.client` 声明被 dsh 的 client-modules 自动扫描打包，挂载 `shell.overlay` 横幅，并在设置区注册**独立的「检查更新」页**（`settings.section`，与「通用设置 / 模型 / 插件」同级）。

## 工作原理

| 半区 | 职责 |
| --- | --- |
| Host（`plugin/lib/index.js`） | 拉取 GitHub 官方 API、读取本地已装版本（`npm ls -g` → `npm root -g` + 读 package.json）、版本比较、破坏性更新判定、安装 **check 检测到的具体版本**（`npm install -g @deepseek-ai/dsh@<版本>`，无检测记录时回退 `@latest`；自动解析 `npm.cmd`/`npm` 真实路径，并把 npm 缓存重定向到沙箱可写目录，避免权限/沙箱导致的安装失败；Windows 优先用 **PowerShell** 执行，回退 `cmd.exe`/`sh`）；安装为**后台任务**，`POST /upd-check/api/install` 启动、`GET /upd-check/api/install/status` 轮询进度/阶段/文件变动 |
| Client（`plugin/lib/client.js`） | `shell.overlay` 顶部横幅 + 设置区独立「↑ 检查更新」页（`settings.section`）；安装时显示**右侧带百分比的进度条** + **文件变动窗口**；完成后**绿色弹窗**提示重启、设置页绿色状态文字 |
| 通信 | `webServer` HTTP 路由 + 同源 fetch |

**网络传输三级容错**：

1. `web.fetch`（若部署挂载了 fetch provider）；
2. `subprocess` 跑 `node -`（stdin 喂脚本）标准 `fetch`（自动跟随重定向）；
3. 前两者失败（典型场景：**hosts 被第三方工具劫持**，如 Steamcommunity302 把 `github.com` 指向 `127.0.0.1` 并返回自签证书）→ 脚本内用 `dns.resolve4` 取真实 IP，以 `servername`/`Host` 头直连，手动跟随重定向、逐个 IP 重试。

## 兼容性与已知限制

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | shell 回退链：Windows 优先 **PowerShell → cmd.exe**（POSIX 用 `sh`），node 解析双回退（`node` → `node.exe`）；无硬编码路径 |
| npm 全局安装的 DSH | ✅ | 本地版本通过 `npm ls -g @deepseek-ai/dsh` / `npm root -g` 读取 |
| pnpm / bun / git clone 安装 | ⚠️ | 本地版本可能读不到，横幅显示「最新版本 X（无法读取本地版本）」；远端检查不受影响 |
| hosts 劫持（Steamcommunity302 等） | ✅ | 内置 DNS 直连绕过 |
| 未挂载 fetch provider 的部署 | ✅ | node 直连通道兜底 |
| GitHub 匿名 API 限流 | ⚠️ | 60 次/小时/IP；每次页面加载自动检查 1 次，手动检查按需触发，一般足够 |
| 安装更新 | ⚠️ | 安装 **check 检测到的具体版本**（`@deepseek-ai/dsh@<版本>`，无检测记录时回退 `@latest`；已自动解析 npm 路径 + 重定向缓存到沙箱可写目录）；仅对 npm 管理安装生效；若全局目录本身无写权限，会给出手动执行提示 |
| DSH 版本适配 | ⚠️ | 插槽名（`shell.overlay`、`settings.section`）以 0.1.0-rc.x 实测为准；未来版本若插槽树变化，UI 不挂载但不会崩溃，Host 检查功能不受影响 |
| 破坏性更新判定 | ✅ | semver 判定确定性可靠；发布说明关键词分级（强信号直接判破坏性；弱信号黄色预警并展示命中关键词与原文片段供核实）；任一命中即黄色预警 + 二次确认 |
| 静态插件 | ✅ | 随 DSH 启动自动加载，重启/更新 DSH 后无需重装；Host 无 `harness`，走 `webServer` HTTP 接口（同源，仅本机监听） |

## 疑难解答

- **一直显示「无法连接 GitHub」**：先检查 hosts（`C:\Windows\System32\drivers\etc\hosts`）是否有 `github.com` / `api.github.com` → `127.0.0.1` 的劫持行（常见于 Steamcommunity302 等加速工具）；有则删除这些行（需管理员），或直接依赖插件内置的 DNS 绕过。也可尝试点「重试」。
- **插件未生效**：确认 `node_modules/dsh-update-check` 存在、`cordis.patch.yml` 已插入行、**重启 DSH**；检查 `GET /upd-check/api/check` 是否返回 JSON。
- **设置区没有「检查更新」页**：确认 client bundle 被扫描（重启后刷新页面）；「检查更新」现在位于设置区的**顶级页**（与通用设置/模型/插件同级），不再在「插件」页内。
- **「无法读取本地版本」**：DSH 不是通过 npm 全局安装的；远端版本仍会正常显示。
- **点「更新」后安装失败**：插件已自动解析 npm 真实路径并把 npm 缓存重定向到沙箱可写目录；若仍失败，失败信息会给出具体原因。若提示 EPERM/EACCES/权限拒绝，多半是 DSH 文件沙箱不允许写 npm 全局目录（`%APPDATA%\npm`），请关闭 DSH 后在终端手动执行安装命令（用检测到的版本，如 `npm install -g @deepseek-ai/dsh@0.1.0-rc.8`，或该版本只发布在 `next` 标签时用 `@next`）。
- **显示「安装成功」但版本没变**：GitHub 检测到新 tag（如 `dsh-v0.1.0-rc.8`）时，npm 的 `latest` 标签可能仍指向旧版（rc.8 挂在 `next` 标签）。v1.6.0 起插件改为安装 check 检测到的**具体版本**，不再出现此问题；若仍遇到，重启 DSH 后手动执行 `npm install -g @deepseek-ai/dsh@<检测到的版本>`。
- **点「稍后」后横幅又出现**：v1.5.0 起 client 会记住忽略的版本号；同一版本在连接重置、重复加载甚至设置页手动「立即检查」后都不再弹窗。需要再次处理该更新时，直接在设置 → 检查更新页点「安装更新」；只有官方发布新版本（`latest` 变化）时横幅才会再次出现。
- **设置页点「立即检查」时顶部弹横幅**：v1.5.0 起设置页手动检查只更新设置页自身状态（状态行/按钮），不再弹顶部横幅（包括「正在检查更新…」和已忽略的风险信号）；顶部横幅只负责自动检查提醒与横幅内操作（重试/立即更新）。
- **黄色预警误报/漏报**：破坏性判定以语义版本为主（确定性），发布说明关键词为辅；弱信号只提示"可能"并展示原文片段，由你核实；若官方发布说明措辞不含关键词，可能漏报 release-notes 信号，但版本信号仍会兜底。
- **为什么这次更新没看到破坏性预警**：破坏性检查仍然存在。`0.1.0-rc.7 → 0.1.0-rc.8` 的 major/minor/patch 相同，按语义版本规则**不属于版本信号破坏性更新**；但若官方发布说明命中弱信号关键词（如「数据结构不兼容 / incompatible」），仍会黄色提示「检测到**可能**破坏性更新」并列出命中片段。发布说明关键词信号依赖 GitHub releases API，属尽力而为，若接口不可用或措辞不含关键词则只按普通更新提示。真正的大版本/破坏性更新（major 或 0.x minor 变化）必定黄色预警 + 二次确认。

## 开发与贡献

- 插件本体：`plugin/` 目录 = npm 包 `dsh-update-check`（`lib/index.js` Host + `lib/client.js` 浏览器 bundle）。
- 本地校验：`node scripts/check-src.js`（语法 + 契约检查，CI 同样执行）。
- 欢迎提交 Issue / PR。

## License

[MIT](LICENSE) © nmbzth
