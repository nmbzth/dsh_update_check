# Changelog

## v1.6.0 — 箭头图标 + PowerShell 安装 + 绿色完成提示 + README 国际化

- **调整(设置图标)**:设置区入口标签改为「↑ 检查更新」(DSH 设置外壳的导航图标由内置 `navIcon(id)` 映射决定,自定义 id 只能显示齿轮,因此把向上箭头放进入口标签与页面标题)。
- **调整(安装执行器)**:Windows 优先用 **PowerShell** 执行 `npm install -g @deepseek-ai/dsh@latest`(单引号包路径,避免引号转义),失败回退 `cmd.exe` / `sh`。
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
- CI 断言同步新增 21 项(host npm 解析、缓存重定向、install 状态路由、后台任务、loglevel=info、PowerShell 执行;client order 9999、dismissedLatest、手动检查不重置忽略状态、bannerVisible、manual 来源、状态轮询、进度、文件变动窗口、绿色完成提示、箭头图标)。

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
