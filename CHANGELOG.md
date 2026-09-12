# Changelog

## v2.0.2 — 区分「GitHub 限流」与「网络不通」

- **修复（错误分类）**:上游返回 **403/429** 时此前一律归类 `network`，界面说「无法连接 GitHub，检查失败」——把**匿名 API 限流（60 次/小时）**误报成网络故障，用户重试也无用。现在单独归类 `rate-limit`：顶部横幅提示「GitHub 拒绝请求：匿名 API 限流（60 次/小时）已用尽，稍后重试即可」，设置页「DSH 更新」卡片给出同样的专用文案。中英双语。
- **修复（只影响上游）**:限流只作用于 DSH 上游检查，插件自身检测（不同仓库、独立请求）不受影响，界面照常显示。
- **工程（联网验证脚本）**:`scripts/verify-real-selfupdate.mjs` 增加**配额门禁**——先读 `/rate_limit`，剩余不足 15 次直接输出 `SKIPPED`（exit 0）；运行中途耗尽配额时，上游检测一项转为 `SKIP` 而不是误报 `FAIL`。避免把配额问题当成框架缺陷。
- CI/自测新增断言：impl 的 `classifyUpstreamError`（`403|429` → `rate-limit`）与在 `check` 中的复用；client 横幅/设置页两条限流文案与分支；运行期新增「上游 403 → `rate-limit`，且插件自身检测不受影响」。

## v2.0.1 — 本机 DSH 版本检测提速 150×、覆盖非 npm 布局,并自报来源

- **修复（检测渠道）**:本机 DSH 版本原先只靠 `npm ls -g @deepseek-ai/dsh` 起 shell 探测——实测 **881ms**,且依赖 shell/PATH/npm,对 **pnpm / bun / 本地克隆**安装读不到（README 里那条 ⚠️ 就是它，表现为「无法读取本地版本」或读到另一份安装）。现在**先走模块系统解析**（`createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')`）：命中的是「按 Node 解析规则真正会被加载的那份安装」，实测 **6ms**，无需 shell，并对上述布局同样有效；失败才回落到原 npm 全局探测。
- **新增（来源自证）**:`/check` 的 `dsh` 载荷新增 `source`（`module-resolution` / `npm-global` / null）与 `sourcePath`；设置页「DSH 更新」卡片新增一行淡色诊断文字（`本机版本来源：模块解析(<绝对路径>)`），版本读错时一眼看出读的是哪份安装。中英双语。
- 契约不变（`API_VERSION` 仍为 2）：本版只改 `lib/impl.js` 与界面文案，**属可热更新范围**，不重启 DSH 即可生效。
- CI/自测新增断言：impl 含模块解析渠道与回落顺序、来源字段回报；运行期测试新增两个场景——沙箱内植入 `node_modules/@deepseek-ai/dsh`（应命中 `module-resolution` 并优先于 npm 桩）、移除后应回落 `npm-global`。

## v2.0.0 — 插件自身可持续热更新框架

- **新增（分层架构）**:host 半区拆成两层——`lib/index.js` 为**监督者**（进程级基础设施：服务、设置、三级网络回退、HTTP 路由、热更新引擎），`lib/impl.js` 为**可热插拔实现**（release notes 解析、改动分类、破坏性分级、版本比对），两者以 `API_VERSION` / `IMPL_CONTRACT` 显式契约绑定。检测逻辑此后演进**无需重启 DSH**。
- **新增（热换入）**:监督者用 `import('...impl.js?v=<version>')` 装载实现（URL 变化即新模块实例），换入前先校验导出与契约，换入是**原子指针替换**；旧引擎留在内存，失败即回退到旧引擎。
- **新增（自更新引擎，手动触发）**:`POST /upd-check/api/self-update`（`{action:'update'|'reload', force}`）、`GET /upd-check/api/self-update`（状态）。流程：从 `releases/latest` 取目标 tag → contents API 拉取 `plugin/` 四个文件 → **按 git blob sha 判定是否变化**（与本地内容比对，兼作下载完整性校验）→ 候选文件先落 `lib/.stage` 并**全部校验通过**（`package.json` 形状、client 走 `node --check`、impl 走真实 `import` + 契约校验、index 走关键标记）→ 备份到 `lib/.bak/<旧版本>_<时间戳>` → 同目录 `rename` 原子替换 → **热换入新引擎**。任何一步失败都回滚，磁盘与运行中的引擎保持原状。
- **新增（热更新边界，诚实标注）**:`lib/impl.js`、`lib/client.js` 免重启生效（client 由 `dsh-client-hmr` 推送新 rev 自动重载）；`lib/index.js` 属进程级基础设施，落盘后**下次启动**生效，响应中用 `restartRequired` 单独标注。
- **新增（历史留痕）**:每次自更新尝试写入 `$DSH_HOME/update-check-history.json`（成功与失败都记，最多 20 条，原子写），状态路由回显最近 5 条。
- **新增（界面）**:设置页「插件自身更新」卡片新增**热更新按钮**（仅点击触发，绝不静默自动更新）+ 边界说明 + 结果提示（免重启 / 下次启动生效 / 失败已回滚），文案中英双语。
- **新增（发布流水线）**:`scripts/release.ps1` 一条命令发布——契约门（两个校验脚本）→ CHANGELOG 段落抽取为 Release 说明 → 提交 → API 推送 → 打 tag → 建 GitHub Release（均幂等）。发布即热更新的内容源。
- **新增（运行期自测）**:`scripts/check-runtime.mjs` 用桩 ctx 装载真实 host 半区并驱动真实 handler，**47 项断言**覆盖检测载荷、设置读写、引擎契约、热更新全链路（校验→替换→换入→备份→历史→幂等→force 零操作→reload）、**失败零损伤回滚**与网络降级。已接入 CI。
- **修复（变化判定口径）**:自更新原先把「远端 blob sha」与「下载内容 sha」自比，恒判为未变化；现在与**本地现有内容**比对，并用远端 sha 做下载完整性校验。
- **修复（接口作用域）**:`handleSelfUpdate` 补传 `res`；`reload` 分支用已安装版本作为引擎标签，避免版本显示被 `reload` 覆盖。
- **新增（真实端到端验证）**:`scripts/verify-real-selfupdate.mjs` —— 可选、需联网：把包复制到临时目录、降到 `0.0.1` 并制造内容漂移，然后**真的**从已发布的 GitHub Release 自我更新一次，再断言文件内容、运行中引擎版本与备份；全程不动源目录，GitHub 不可达时输出 `SKIPPED` 并以 0 退出。已实测:副本 `1.9.0` → `2.0.0`(4 文件 + 引擎热换入 + 备份 + 历史),耗时约 1 秒。
- **工程**:`.gitignore` 忽略热更新运行时产物 `plugin/lib/.stage/`、`plugin/lib/.bak/`；源码契约断言从 53 条扩充到 **86 条**（impl 层断言、契约一致性、先验证后替换、回滚路径、热更新边界、仅 POST 可触发）。

## v1.9.1 — 修复：已是最新时设置页残留改动描述

- **修复（设置页残留）**:「本次改动」与「破坏性相关描述（完整）」现在**仅在 `updateAvailable === true` 时渲染**。此前 Host 会无条件返回最新 release 的分节内容，导致"明明已是最新版，设置页却仍显示一大堆改动文本"；「查看发布说明」链接同样只在确有更新时出现。
- **修复（跨挂载残留）**:插件每次挂载（宿主重启 / 插件热重载）都会**清空 store 中上一次的检查结果**（dsh / plugin / checkedAt / 错误 / 展开态），避免新一轮检查完成前设置页显示陈旧数据。
- CI 新增两条回归断言：改动区块的 `updateAvailable` 门控、挂载时的 store 重置。

## v1.9.0 — 多语言支持(中文 / English)

- **新增**:插件界面接入 DSH client `locale` 服务——注册 `dsh-update-check` 命名空间的 **zh / en 双语字典**(65 键,一一对应),经 `locale.bind(NS)` 翻译,`locale.subscribe` 驱动语言切换即时重渲染(横幅与设置页同步)。
- **新增**:设置区入口标签改为惰性函数 `() => t("page.title")`,语言切换后导航文字同步刷新。
- **回退**:locale 服务缺失时使用内置中文字典 + 简单 `{name}` 插值,界面仍可用。
- **包声明**:`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-locale`。
- CI 断言扩展:字典存在性、双语注册、bind/subscribe、回退翻译,以及 **zh/en 键完全一致**校验(注释与字典外不得有硬编码中文)。

## v1.8.0 — 上游改动结构化 + 插件自身更新 + 三个开关 + 横幅/设置页重构

- **新增（上游改动比对）**:解析最新 release 的发布说明为**分节条目**——新增功能 / 问题修复 / 体验优化 / 其他变更 / SDK；中英双语说明优先取中文块；每条保留**完整原文**；命中破坏性关键词的条目标注强/弱信号并高亮。抓取失败时降级为纯版本比对（`notesError` 上报原因）。
- **新增（插件自身更新）**:本地读自身 `package.json` 版本（`import.meta.url`），远端读仓库 `plugin/package.json`（GitHub contents API）比对，设置页显示「插件自身更新」区块（仅提示，需手动替换 `plugin/` 目录）。
- **新增（三个开关，持久化）**:每次启动检查 DSH 更新 / 每次启动检查插件自身更新 / 顶部窗口显示描述细节（详细 or 简略）。写入 `$DSH_HOME/update-check.json`（`DSH_HOME` 非空优先，否则 `~/.dsh`；临时文件 + rename 原子写；损坏回退默认）。
- **新增（API）**:`GET /upd-check/api/settings`、`POST /upd-check/api/settings`；`GET /upd-check/api/check?dsh=0|1&plugin=0|1` 支持检查范围参数，返回体同时携带设置。
- **重构（顶部横幅）**:两态——**简略**（一行「发现更新：DSH X → Y；插件 …」+「详情 / 稍后」）与**详细**（直接展开破坏性完整描述 + 改动分类条目，功能/修复各前 3 条）；**彻底移除**「了解风险 → 我了解风险，确认更新」安装时代旧链路。
- **重构（设置页）**:三个卡片区块——DSH 更新（版本/发布时间/上次检查/状态 + 立即检查 + 发布说明链接 + **完整破坏性命中描述** + 改动分类列表）、插件自身更新、设置开关。
- 保留:hosts 劫持绕过（node 直连真实 IP）、三级网络回退、稍后忽略同版本、手动检查不弹横幅、网络错误重试。

## v1.7.0 — 移除安装更新功能，仅保留更新提示

- **移除**:Host 的 `/upd-check/api/install`、`/upd-check/api/install/status` 路由及全部安装逻辑（后台任务、进度轮询、npm 缓存重定向、PowerShell 执行、`lastCheck`/`npmVersionFromTag` 等）；Client 的「立即更新 / 安装更新」按钮、进度条、文件变动窗口、安装二次确认（`installArmed`）、绿色完成提示全部删除。
- **保留**:检测与提示——顶部横幅（发现新版本 / 破坏性强弱信号黄色预警 + 「了解风险」风险详情页，含命中关键词与原文片段）、设置区独立「↑ 检查更新」页（当前版本/最新版本/状态/立即检查）、稍后忽略、手动检查不弹横幅、hosts 绕过等。
- 更新由用户手动执行（如 `npm install -g @deepseek-ai/dsh@latest`）。

## v1.6.0 — 箭头图标 + PowerShell 安装 + 绿色完成提示 + README 国际化

- **调整(设置图标)**:设置区入口标签改为「↑ 检查更新」(DSH 设置外壳的导航图标由内置 `navIcon(id)` 映射决定,自定义 id 只能显示齿轮,因此把向上箭头放进入口标签与页面标题)。
- **调整(安装执行器)**:Windows 优先用 **PowerShell** 执行 `npm install -g @deepseek-ai/dsh@latest`(单引号包路径,避免引号转义),失败回退 `cmd.exe` / `sh`。
- **修复(设置界面无法真正更新)**:安装命令从 `@latest` 改为安装 **check 检测到的具体版本**(`lastCheck` + `npmVersionFromTag`)。原因:GitHub 检测到 `dsh-v0.1.0-rc.8` 时,npm 的 `latest` 标签可能仍是 `0.1.0-rc.7`(rc.8 挂在 `next` 标签),`@latest` 会「安装成功」但版本不变。现在设置页点「安装更新」会真正安装到检测到的 rc.8。
- **修复(设置页安装按钮无反应)**:二次确认状态 `armed` 从组件局部 state 提升到共享 store(`installArmed`),与横幅的两步确认一致——组件重挂载/重复渲染时不再丢失确认状态,黄色「安装更新」→ 红色「再次确认更新(危险)」→ 第二次点击必定触发安装;同时给禁用按钮加半透明/`not-allowed` 视觉反馈,便于区分「不能装」与「需要二次确认」。
- **新增(绿色完成提示)**:安装成功后顶部横幅改为**绿色弹窗**(✅ +「更新完成,等待手动重启」),设置页「状态」行与新增提示文字均为**绿色**。
- **文档(README 国际化)**:仓库主页 README 改为英文,新建 `README.zh-CN.md` 中文版,主页第一行放置中文 README 超链接。
- 说明:v1.6.0 之前未发布到仓库的 v1.5.0 变更(设置页排最后、安装失败修复、稍后不再重复弹窗、手动检查不弹横幅、安装进度可视化)全部包含在本版本。

## v1.5.0 — 设置页排最后 + 安装失败深度修复 + 稍后不再重复弹风险横幅(并入 v1.6.0 发布)

- **调整**:设置区「检查更新」页 `order` 从 16 提升为 9999,排在独立设置页(通用设置/模型/插件等)最后。
- **修复(更新失败)**:安装更新时:
  - 用 `subprocess.resolveExecutable` 解析 `npm.cmd`/`npm` 真实路径,不再裸调 `npm`(子进程 provider 清洗 PATH 时会导致「不是内部或外部命令」);
  - 把 npm 缓存重定向到沙箱可写的 workspace/profile 目录(`.dsh-update-cache`),避免默认缓存写在 `%LOCALAPPDATA%\npm-cache` 被 DSH 文件沙箱拒绝(EPERM)导致安装失败;
  - 附加 `--no-audit --no-fund --loglevel=info` 输出文件变动信息;权限类错误附手动安装提示。
- **修复(稍后不清除)**:client 的 store 与自动检查改为模块级单例(跨多次 apply 共享),并记录 `dismissedLatest`——点「稍后」后,同一版本的风险横幅**永久忽略**(设置页手动「立即检查」也不会重新弹出);只有出现新版本时才再次提醒。
- **修复(设置页检查弹横幅)**:设置页「立即检查」新增 `bannerVisible` 开关,手动检查只更新设置页状态,**不再弹顶部横幅**(不再闪现「正在检查更新…」或已忽略的风险信号);横幅仅用于自动检查与横幅内重试/安装。
- **新增(安装进度可视化)**:安装更新改为**后台任务 + 状态轮询**(`POST /upd-check/api/install` 立即返回,`GET /upd-check/api/install/status` 轮询进度);设置页与横幅显示**右侧带百分比的进度条**,进度条下方是**文件变动窗口**,实时展示 npm 的 add/remove/change/reify 等输出(失败时展示错误与手动修复提示)。
- CI 断言同步新增 24 项(host npm 解析、缓存重定向、install 状态路由、后台任务、loglevel=info、PowerShell 执行、lastCheck 具体版本;client order 9999、dismissedLatest、手动检查不重置忽略状态、bannerVisible、manual 来源、状态轮询、进度、文件变动窗口、绿色完成提示、箭头图标、installArmed)。

## v1.4.0 — 修复静态路由注册 + 检查更新提升为独立设置页

- **修复**:静态 host 通过 `inject: ['webServer']` 声明硬依赖——webServer 由 web-app 层提供,可能晚于插件激活;此前 `ctx.get('webServer')` 可能为 undefined 导致 `/upd-check/api/*` 路由未注册(检测不到更新/版本)。
- **调整**:设置入口从「设置 → 插件」内的页签提升为**顶级设置区**(`settings.section`,id `upd-check`,order 16),与「通用设置 / 模型 / 插件」同级,成为独立功能页。
- CI 断言同步更新(host inject、settings.section、不再挂插件页签)。

## v1.3.0 — 移除动态版,仅保留静态插件

- **移除**:`src/` 动态插件版(harness RPC)已删除,仓库只保留 `plugin/` 静态包 `dsh-update-check`。
- CI 精简为 31 项(仅静态包);`check-src.js` 新增 host 语法检查——顺带修复了 `fetchLatest` 中 releases try 块缺失闭合的潜在语法隐患(该隐患在旧断言下不会被发现)。
- README/CHANGELOG 同步清理动态版相关内容。

## v1.2.0 — 破坏性信号分级 + 判定依据透明化

- **新增**:关键词检测恢复宽泛(不兼容 / incompatible / migration / removed / deprecated / 迁移 / 移除 / 不再支持 等),并**分级**:
  - 强信号(breaking change / 破坏性更新 / 破坏…兼容 等)→ 黄色预警「检测到破坏性更新」;
  - 弱信号(宽泛词)→ 黄色预警「检测到**可能**破坏性更新」,二次确认页**列出命中关键词与原文片段**(如「…数据结构不兼容…」),由用户核实;
- 语义版本信号(major / 0.x minor)不变。
- 静态包与动态版同步更新;CI 断言更新(分级表、breakingSignals、release-notes-weak)。

## v1.1.0 — 静态插件化(持久加载)

- **新增**:`plugin/` 目录 = npm 包 `dsh-update-check`(静态形态,推荐分发):
  - Host(`plugin/lib/index.js`):宿主 composition 插件(ESM `export { apply }`),无动态插件 `harness`,改用宿主 `webServer` 暴露同源 HTTP 接口(`GET /upd-check/api/check`、`POST /upd-check/api/install`);
  - Client(`plugin/lib/client.js`):ModuleLoader 格式浏览器 bundle,`exports["./client"]` + `package.json dsh.client` 声明,由 client-modules 自动扫描打包;UI 与动态版一致(内联样式),RPC 走同源 fetch;
  - 安装:拷贝到 profile `node_modules` + `cordis.patch.yml` 插入 `upd-check` 行 + 重启 DSH → **重启/更新 DSH 后无需重装**。
- **保留**:`src/` 动态版(开发/调试形态)。
- CI 校验扩展至 45 项(含静态包语法、路由、bundle、注入声明)。

## v0.5.1(pkg-6)— 修复破坏性检测误报

- **修复**:官方 rc.8 发布说明含「数据结构不兼容 / storage format is incompatible」被误判为破坏性更新(实为 SQLite 存储格式内部变更)。关键词检测收紧为**高置信度措辞**:`breaking change`、`breaks compatibility`、`not backward compatible`、`backward-incompatible`、`BC break`、`破坏性更新/变更`、`破坏…兼容`、`不向后兼容`;**移除**宽泛的 `incompatible / migration / removed / deprecated / 不兼容 / 迁移 / 移除` 等正常变更描述词。语义版本判定(major / 0.x minor)不受影响。
- 误报场景验证:rc.7 → rc.8(同 major/minor/patch)→ 判定为非破坏性,显示普通「发现新版本」。

## v0.5.0(pkg-5)— 破坏性更新检测 + 二次确认

- **新增**:破坏性更新判定(双重信号,任一命中即判破坏性):
  - 语义版本:major 变化,或 0.x 阶段 minor 变化(semver 0.x 规则,`0.1 → 0.2` 视为破坏性);
  - 官方发布说明:抓取最新 release body,匹配 breaking / incompatible / migration / removed / deprecated / 破坏性 / 不兼容 / 迁移 / 移除 等关键词(尽力而为,失败不阻塞)。
- **新增**:检测到破坏性更新时,顶部横幅**黄色高亮 + ⚠️ 提示**,按钮为「了解风险 / 稍后」;点「了解风险」进入二次确认态,展示具体风险说明,必须点「我了解风险,确认更新」才会执行安装;设置页「安装更新」按钮同样两段式确认(第一次点击变黄「再次确认更新(危险)」)。

## v1.0.0(2025-xx-xx)

首个可发布版本,对应运行包 `pkg-4`,包含此前全部修复。

### v0.4.0(pkg-4)— hosts 绕过 + `dsh-` 前缀

- **修复**:hosts 被第三方工具(Steamcommunity302 等)劫持导致 GitHub 不可达的问题——node 传输通道改为「标准 `fetch` → 失败后 `dns.resolve4` 真实 IP + SNI/Host 头直连」双路径,手动跟随重定向、逐个 IP 重试。
- **修复**:官方仓库 tag 为 `dsh-v0.1.0-rc.7`(`dsh-` 前缀),版本解析正则支持该前缀。
- **修复**:官方 `releases/latest` 端点 404 时自动落入 `tags` 通道。

### v0.3.0(pkg-3)— 可执行文件解析加固

- node 回退通道改用 `subprocess.resolveExecutable` 解析(`node` → `node.exe`),避免子进程 provider 清洗 PATH 中找不到 node。

### v0.2.0(pkg-2)— node 直连回退通道

- **修复**:部署未挂载任何 fetch provider 时 `web.fetch` 必然失败的问题——新增 `subprocess` 跑 `node -`(stdin 喂脚本,免引号转义)直连官方 GitHub API 的第二传输通道。
- `http-*` 状态码归类 `no-release`(GitHub 可达但无发布),其余传输错误归类 `network`。

### v0.1.0(pkg-1)— 初始实现

- Host:GitHub `releases/latest` → `tags` → HTML 三级获取,本地版本 npm 检测,semver 风格比较;`check` / `install` 私有 RPC。
- Client:`shell.overlay` 顶部横幅(检查中 / 网络错误 / 发现更新常驻 / 已是最新)+ `settings.plugins.tab`「检查更新」页(手动检查、手动安装)。
- 打开页面 3s 自动检查,`connection/reset` 补触发。
