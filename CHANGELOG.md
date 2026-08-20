# Changelog

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
