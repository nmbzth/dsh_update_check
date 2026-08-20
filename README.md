# dsh_update_check

> dsh_update_check 是一个 dsh 插件,能自动检查 dsharness 官方上游仓库比对差异并提示更新。
>
> A dynamic Cordis plugin for DeepSeek Harness: auto-checks the official GitHub repo for new releases on startup with a top banner, plus a manual check/install page under Settings → Plugins.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 功能特性

1. **打开即检**:页面加载 3 秒后自动向官方仓库检查一次(`connection/reset` 时补触发)。
2. **基于官方 GitHub**:按序尝试 `releases/latest` API → `tags` API → releases 页面 HTML,10 秒超时,`dsh-v*` 前缀的 tag 也能正确解析(semver 风格比较,含 rc/beta 预发布)。
3. **网络不佳有提示**:连不上 GitHub 时,顶部横幅显示「无法连接 GitHub,检查失败」+ 「重试 / 关闭」。
4. **发现更新常驻提醒**:「发现新版本:当前 X → 最新 Y」+ 「立即更新 / 稍后」,**无自动消失计时器**,只有点击才关闭。
5. **设置页手动操作**:设置 → 插件 →「检查更新」页,展示 当前版本 / 最新版本 / 上次检查 / 状态,可「立即检查」「安装更新」。
6. **破坏性更新预警(重要)**:DSH 官方公告未来将有破坏性更新,可能与旧插件不兼容。插件双重信号检测破坏性更新——① 语义版本(major 变化,或 0.x 阶段 minor 变化);② 官方发布说明关键词(breaking / incompatible / migration / 破坏性 / 不兼容 等)。命中时横幅**黄色高亮 + ⚠️**,必须经过「了解风险 → 我了解风险,确认更新」**二次确认**才会执行安装;设置页按钮同样两段式确认。

## 工作原理

| 半区 | 职责 |
| --- | --- |
| Host | 拉取 GitHub 官方 API、读取本地已装版本(`npm ls -g` → `npm root -g` + 读 package.json)、版本比较、破坏性更新判定、执行 `npm install -g @deepseek-ai/dsh@latest` |
| Client | `shell.overlay` 顶部横幅 + `settings.plugins.tab`「检查更新」页;两半通过 Package-private RPC(`harness.handle` / `host.call`)通信 |

**网络传输三级容错**:

1. `web.fetch`(若部署挂载了 fetch provider);
2. `subprocess` 跑 `node -`(stdin 喂脚本)标准 `fetch`(自动跟随重定向);
3. 前两者失败(典型场景:**hosts 被第三方工具劫持**,如 Steamcommunity302 把 `github.com` 指向 `127.0.0.1` 并返回自签证书)→ 脚本内用 `dns.resolve4` 取真实 IP,以 `servername`/`Host` 头直连,手动跟随重定向、逐个 IP 重试。

## 安装(在任意一台机器)

### 前置要求

- 已安装 DSH(`npm install -g @deepseek-ai/dsh`),并通过 web GUI 使用(cordis 会话);
- Node.js ≥ 18(需要内置 `fetch`;建议 20+);
- 插件为**动态插件**,由 DSH 智能体创建,随当前进程存活(重启 DSH 后需重新加载)。

### 方式 A:让智能体安装(推荐)

1. 把本仓库(至少 `src/host.js` 与 `src/client.js`)放进 DSH 的工作区;
2. 在 DSH 对话中输入:

   > 读取本仓库 `src/host.js` 和 `src/client.js`,用 cordis_define 创建一个名为「更新检查」的插件:`code.host` 使用 host.js 的完整内容,`code.client` 使用 client.js 的完整内容;然后 cordis_run 激活,并在需要时处理审批。

3. 刷新页面:3 秒后顶部出现检查结果横幅;设置 → 插件 → 出现「检查更新」页签。

### 方式 B:手动(开发者)

按照 [AGENT.md](AGENT.md) 中的步骤,或在 cordis 会话中直接使用 `cordis_define` / `cordis_run` 工具加载 `src/` 下的两个文件。

## 兼容性与已知限制

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Windows / macOS / Linux | ✅ | shell 双回退(`cmd.exe` → `sh`),node 解析双回退(`node` → `node.exe`);无硬编码路径 |
| npm 全局安装的 DSH | ✅ | 本地版本通过 `npm ls -g @deepseek-ai/dsh` / `npm root -g` 读取 |
| pnpm / bun / git clone 安装 | ⚠️ | 本地版本可能读不到,横幅显示「最新版本 X(无法读取本地版本)」;远端检查不受影响 |
| hosts 劫持(Steamcommunity302 等) | ✅ | 内置 DNS 直连绕过 |
| 未挂载 fetch provider 的部署 | ✅ | node 直连通道兜底 |
| GitHub 匿名 API 限流 | ⚠️ | 60 次/小时/IP;每次页面加载自动检查 1 次,手动检查按需触发,一般足够 |
| 安装更新 | ⚠️ | 执行 `npm install -g @deepseek-ai/dsh@latest`,仅对 npm 管理安装生效;非 npm 安装请手动升级 |
| DSH 版本适配 | ⚠️ | 插槽名(`shell.overlay`、`settings.plugins.tab`)以 0.1.0-rc.x 实测为准;未来版本若插槽树变化,UI 不挂载但不会崩溃,Host 检查功能不受影响 |
| 破坏性更新判定 | ✅ | semver 判定确定性可靠;发布说明关键词为**高置信度措辞**(`breaking change` / `breaks compatibility` / `not backward compatible` / 破坏性更新 / 破坏…兼容 等),已修复「存储格式不兼容」类描述误报;两者任一命中即黄色预警 + 二次确认 |

## 疑难解答

- **一直显示「无法连接 GitHub」**:先检查 hosts(`C:\Windows\System32\drivers\etc\hosts`)是否有 `github.com` / `api.github.com` → `127.0.0.1` 的劫持行(常见于 Steamcommunity302 等加速工具);有则删除这些行(需管理员),或直接依赖插件内置的 DNS 绕过。也可尝试点「重试」。
- **设置页没有「检查更新」页签**:确认插件 Client 半区已运行(查看运行卡片);动态插件重启 DSH 后需要重新加载。
- **「无法读取本地版本」**:DSH 不是通过 npm 全局安装的;远端版本仍会正常显示。
- **黄色预警误报/漏报**:破坏性判定以语义版本为主(确定性),发布说明关键词为辅;若官方发布说明措辞不含关键词,可能漏报 release-notes 信号,但版本信号仍会兜底。

## 开发与贡献

- `src/host.js` / `src/client.js` 即插件源码(与 `cordis_define` 的 `code.host` / `code.client` 一一对应),修改后重新定义即可(动态插件支持 immutable 包版本演进)。
- 本地校验:`node scripts/check-src.js`(语法 + 契约检查,CI 同样执行)。
- 欢迎提交 Issue / PR。

## License

[MIT](LICENSE) © nmbzth
