[English](README.md) · [**中文 README**](README.zh-CN.md)

# dsh_update_check

> dsh_update_check 是一个 dsh 插件，能自动检查 dsharness 官方上游仓库比对差异并提示更新。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 功能特性

1. **打开即检（可开关）**：页面加载 3 秒后自动检查一次（`connection/reset` 时补触发）；DSH 更新检查与插件自身检查是**两个独立开关**。
2. **基于官方 GitHub**：按序尝试 `releases/latest` API → releases 列表 → `tags` API，10 秒超时，`dsh-v*` 前缀的 tag 也能正确解析（semver 风格比较，含 rc/beta 预发布）。
3. **上游改动结构化**：解析发布说明为分节条目——**新增功能 / 问题修复 / 体验优化 / 其他变更 / SDK**；优先中文块；每条保留**完整原文**；命中破坏性关键词的条目按强/弱信号高亮。
4. **插件自身更新检查**：本地 `package.json` 版本与仓库 `plugin/package.json` 比对（DSH 本身的更新始终由你手动执行，插件只做提示）。
5. **可持续热更新框架（针对本插件自身）**：host 半区拆成**稳定监督者** + **可热插拔实现**两层，检测/解析逻辑换版本**无需重启 DSH**；设置页提供**手动**「热更新插件」按钮（绝不静默、绝不自动）。详见[热更新](#热更新)。
6. **顶部横幅两态**：**简略**（一行「发现更新：DSH X → Y」+「详情 / 稍后」）或**详细**（直接展开详情），由开关控制；**无自动消失计时器**；点「稍后」后同版本不再弹出，直到出现更新版本。
7. **独立设置页**：设置区**独立的「↑ 检查更新」页**（与「通用设置 / 模型 / 插件」同级），三个卡片：
   - **DSH 更新**：当前/最新版本、发布时间、上次检查、状态、「立即检查」、发布说明链接、**完整破坏性命中描述**（关键词 + 完整条目原文）与改动分类列表；
   - **插件自身更新**：当前/最新插件版本、状态与**热更新按钮**；
   - **设置**：下列三个开关。
8. **三个持久化开关**：每次启动检查 DSH 更新 / 每次启动检查插件自身更新 / 顶部窗口显示描述细节（详细或简略），存于 `$DSH_HOME/update-check.json`。
9. **破坏性更新分级**：语义版本（major 变化，或 0.x 阶段 minor 变化）+ 发布说明关键词：
   - **强信号**（breaking change / 破坏性更新 / 破坏…兼容 等）→ 黄色预警「含破坏性变更」；
   - **弱信号**（不兼容 / incompatible / 迁移 / 移除 / deprecated 等）→ 黄色预警「可能破坏性」，并展示**完整命中条目**由你判断；
   - 纯信息展示：DSH 本身的更新始终由你手动执行，插件不提供 DSH 安装流程。
10. **网络不佳有提示**：连不上 GitHub 时，顶部横幅显示「无法连接 GitHub，检查失败」+ 「重试 / 关闭」。
11. **中英双语界面**：通过 DSH client `locale` 服务注册 zh / en 字典，界面跟随当前语言实时切换（横幅、设置页与导航标签）；locale 服务不可用时回退内置中文字典。

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

> 说明：Host 通过宿主 `webServer` 暴露 `GET /upd-check/api/check`（Host 以 `inject: ['webServer']` 声明硬依赖，等服务就绪后再注册路由）；浏览器端 client bundle（ModuleLoader 格式）经 `exports["./client"]` + `package.json dsh.client` 声明被 dsh 的 client-modules 自动扫描打包，挂载 `shell.overlay` 横幅，并在设置区注册**独立的「↑ 检查更新」页**（`settings.section`，与「通用设置 / 模型 / 插件」同级，排最后）。

## 工作原理

| 半区 | 职责 |
| --- | --- |
| Host 监督者（`plugin/lib/index.js`） | 进程级基础设施：本地 DSH 版本读取（`npm ls -g` → `npm root -g` + 读 package.json）、三级网络回退、设置持久化、HTTP 路由，以及**热换入 / 自更新引擎**。 |
| Host 实现（`plugin/lib/impl.js`） | 可热插拔的检测逻辑：发布说明分节解析、改动分类、破坏性分级、版本比对；以 `API_VERSION` / `IMPL_CONTRACT` 契约与监督者绑定。 |
| Client（`plugin/lib/client.js`） | `shell.overlay` 顶部横幅 + 设置区独立「↑ 检查更新」页（`settings.section`）；展示更新提醒、破坏性风险详情（含命中关键词片段）、网络错误与热更新按钮。 |
| 通信 | `webServer` HTTP 路由（`/upd-check/api/check`、`/upd-check/api/settings`、`/upd-check/api/self-update`）+ 同源 fetch |

**网络传输三级容错**：

1. `web.fetch`（若部署挂载了 fetch provider）；
2. `subprocess` 跑 `node -`（stdin 喂脚本）标准 `fetch`（自动跟随重定向）；
3. 前两者失败（典型场景：**hosts 被第三方工具劫持**，如 Steamcommunity302 把 `github.com` 指向 `127.0.0.1` 并返回自签证书）→ 脚本内用 `dns.resolve4` 取真实 IP，以 `servername`/`Host` 头直连，手动跟随重定向、逐个 IP 重试。

## 热更新

插件可以从自己的 GitHub Release **更新自身**，且大部分改动**无需重启 DSH**。

**分层与生效边界**

| 文件 | 角色 | 生效时机 |
| --- | --- | --- |
| `lib/impl.js` | 检测/解析实现（可热插拔） | 立即——用新的 `?v=<版本>` 重新导入并原子换入 |
| `lib/client.js` | 浏览器 UI bundle | 立即——`dsh-client-hmr` 推送新 rev，页面就地重载该 bundle |
| `lib/index.js` | 监督者：服务、设置、网络、路由 | 下次 DSH 启动（响应里以 `restartRequired` 标注） |
| `package.json` | 版本标记 | 立即（版本显示） |

监督者**刻意不在运行期自我改写**：它就是执行更新的那段代码，运行时替换自己等于把脚下地板抽掉。它的改动会落盘并在响应中标注 `restartRequired`。

**更新流程**（`POST /upd-check/api/self-update`，仅手动触发）

1. 从 `releases/latest` 取目标 tag（仓库还没有 Release 时回落 `contents/plugin/package.json`）；
2. 用 contents API 从该 tag 拉取四个文件（`lib/client.js`、`lib/impl.js`、`lib/index.js`、`package.json`）；
3. **判定变化**：把每个下载内容的 git blob SHA 与**本地**文件比对，同时用 API 给出的 SHA 做下载完整性校验；
4. **先校验，后落地**：候选文件写入 `lib/.stage/` —— `package.json` 形状、`client.js` 走 `node --check` 真解析、`impl.js` 真 `import()` 并校验契约、`index.js` 校验关键标记；
5. **备份**被替换文件到 `lib/.bak/<旧版本>_<时间戳>/`；
6. 同目录 `rename` **原子替换**每个文件；
7. **热换入新引擎**（失败则从备份还原 `impl.js`/`client.js`，继续用内存中的旧引擎）；
8. 把本次尝试追加进 `$DSH_HOME/update-check-history.json`（成功与失败都记，保留最近 20 条）。

第 6 步之前或之中的任何失败都不会动磁盘；第 7 步失败会回滚。响应返回 `from`/`to`、`hot`、`clientReloaded`、`restartRequired`、逐文件 `changed` 标记与备份路径。

**接口**

| 方法 | 路由 | 作用 |
| --- | --- | --- |
| `GET` | `/upd-check/api/self-update` | 已装版本、运行中引擎版本/契约、热更新文件集、需重启范围、最近历史 |
| `POST` | `/upd-check/api/self-update` | `{"action":"update"}` 执行更新；`{"action":"update","force":true}` 版本相同时也执行（仍按内容判定差异）；`{"action":"reload"}` 只从磁盘重新导入实现，不下载任何内容 |

**发布（热更新的内容来源）**

```powershell
pwsh -NoProfile -File scripts/release.ps1
```

以两套契约测试为门禁，抽取 CHANGELOG 中该版本段落作为 Release 说明，然后提交、推送、打 tag、建 GitHub Release（全部幂等）。发布出来的 Release 就是插件自更新消费的内容源。

> 本机 `github.com` 的 git 直连不可用（连接超时 / SSL 校验失败），推送走 Git Data API（`scripts/push-via-api.ps1`），因此本地与远端的 ref 会**内容一致、SHA 分叉**，这是预期行为。

## 兼容性与已知限制

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | shell 双回退（`cmd.exe` → `sh`），node 解析双回退（`node` → `node.exe`）；无硬编码路径 |
| npm 全局安装的 DSH | ✅ | 本地版本通过 `npm ls -g @deepseek-ai/dsh` / `npm root -g` 读取 |
| pnpm / bun / git clone 安装 | ⚠️ | 本地版本可能读不到，横幅显示「最新版本 X（无法读取本地版本）」；远端检查不受影响 |
| hosts 劫持（Steamcommunity302 等） | ✅ | 内置 DNS 直连绕过 |
| 未挂载 fetch provider 的部署 | ✅ | node 直连通道兜底 |
| GitHub 匿名 API 限流 | ⚠️ | 60 次/小时/IP；每次页面加载自动检查 1 次，手动检查按需触发，一般足够 |
| DSH 版本适配 | ⚠️ | 插槽名（`shell.overlay`、`settings.section`）以 0.1.0-rc.x 实测为准；未来版本若插槽树变化，UI 不挂载但不会崩溃，Host 检查功能不受影响 |
| 破坏性更新判定 | ✅ | semver 判定确定性可靠；发布说明关键词分级（强信号直接判破坏性；弱信号黄色预警并展示完整命中条目供核实） |
| 设置存储 | ✅ | `$DSH_HOME/update-check.json`（原子写；内容损坏回退默认）；三个开关重启后仍生效 |
| 插件热更新 | ✅ | `lib/impl.js` + `lib/client.js` 免重启生效；`lib/index.js` 需下次启动（`restartRequired`）；每次尝试都先校验、再备份、失败回滚 |
| 仓库尚无 Release 时的热更新 | ✅ | 回落读取默认分支的 `contents/plugin/package.json`；用 `scripts/release.ps1` 建立 Release 后即走 tag |
| 离线时的热更新 | ⚠️ | 需要能连上 GitHub（与检查共用三级回退）；下载失败时不写任何文件 |
| 静态插件 | ✅ | 随 DSH 启动自动加载，重启/更新 DSH 后无需重装；Host 无 `harness`，走 `webServer` HTTP 接口（同源，仅本机监听） |

## 疑难解答

- **一直显示「无法连接 GitHub」**：先检查 hosts（`C:\Windows\System32\drivers\etc\hosts`）是否有 `github.com` / `api.github.com` → `127.0.0.1` 的劫持行（常见于 Steamcommunity302 等加速工具）；有则删除这些行（需管理员），或直接依赖插件内置的 DNS 绕过。也可尝试点「重试」。
- **插件未生效**：确认 `node_modules/dsh-update-check` 存在、`cordis.patch.yml` 已插入行、**重启 DSH**；检查 `GET /upd-check/api/check` 是否返回 JSON。
- **热更新返回 `restartRequired`**：这次发布同时改了 `lib/index.js`（监督者）。新文件已经落盘，**下次 DSH 启动**生效；`GET /upd-check/api/self-update` 可查看运行中的引擎版本。
- **热更新失败**：不会留下改到一半的状态——响应给出原因（如 `impl-contract-mismatch`、`remote-client-syntax`、`http-404`），本次尝试记入 `$DSH_HOME/update-check-history.json`，旧版本备份在 `plugin/lib/.bak/` 下。
- **设置区没有「↑ 检查更新」页**：确认 client bundle 被扫描（重启后刷新页面）；「检查更新」位于设置区的**顶级页**（与通用设置/模型/插件同级，排最后）。
- **「无法读取本地版本」**：DSH 不是通过 npm 全局安装的；远端版本仍会正常显示。
- **点「稍后」后横幅又出现**：客户端记住了忽略的版本；同一版本在连接重置、页面刷新、设置页手动检查后都不会再弹，只有发布新版本（`latest` 变化）才会再次提醒。
- **设置页「立即检查」会弹顶部横幅**：手动检查只更新设置页状态，不再弹顶部横幅；顶部横幅保留给自动检查与横幅操作（重试）。
- **黄色预警误报/漏报**：破坏性判定以语义版本为主（确定性），发布说明关键词为辅；弱信号只提示「可能」并展示原文片段，由你核实；若官方发布说明措辞不含关键词，可能漏报 release-notes 信号，但版本信号仍会兜底。

## 开发与贡献

- 插件本体：`plugin/` 目录 = npm 包 `dsh-update-check`（`lib/index.js` 监督者 + `lib/impl.js` 可热插拔实现 + `lib/client.js` 浏览器 bundle）。
- 本地校验：
  - `node scripts/check-src.js` —— 语法与源码契约检查（86 条断言，CI 同样执行）；
  - `node scripts/check-runtime.mjs` —— 运行期契约检查：在临时沙箱里用桩 `ctx` 装载真实 host 半区并驱动其真实 HTTP handler，覆盖检测载荷、设置读写、引擎契约与热更新全链路（含**失败零损伤回滚**），47 条断言，CI 同样执行。
- 发布：`pwsh -NoProfile -File scripts/release.ps1`（先 bump `plugin/package.json`、写好 CHANGELOG 段落，再执行）。
- 改动「监督者 ↔ 实现」契约时，需同步 bump `lib/index.js` 的 `IMPL_CONTRACT` 与 `lib/impl.js` 的 `API_VERSION`；CI 会比对两者是否一致。
- 欢迎提交 Issue / PR。

## License

[MIT](LICENSE) © nmbzth
