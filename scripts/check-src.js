// dsh_update_check — 源码校验脚本(CI 与本地共用)
// 用法:node scripts/check-src.js
// 校验静态插件包 plugin/(npm 包 dsh-update-check):语法可解析 + 关键契约标记存在。
'use strict'
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let failed = false
const check = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label)
  if (!cond) failed = true
}

const sHost = read('plugin/lib/index.js')
const sImpl = read('plugin/lib/impl.js')
const sClient = read('plugin/lib/client.js')
const sPkg = JSON.parse(read('plugin/package.json'))
// 监督者:自更新安装段(校验「先验证后替换」与回滚路径的先后关系)
const sInstall = sHost.slice(sHost.indexOf('async function performSelfUpdate'), sHost.indexOf('// ---------- HTTP ----------'))

// 1) 包结构
check(sPkg.name === 'dsh-update-check', '包名 = dsh-update-check')
check(sPkg.type === 'module' && sPkg.main === 'lib/index.js', 'ESM 入口')
check(sPkg.exports && sPkg.exports['./client'] === './lib/client.js', 'exports["./client"]')
check(sPkg.dsh && sPkg.dsh.client && sPkg.dsh.client.platform === 'web', 'dsh.client platform=web')
check(sPkg.dsh.client.inject && sPkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'), '注入 slots 运行时')
check(sPkg.dsh.client.inject && sPkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), '注入 locale 运行时(i18n)')

// 2) Host 半区:监督者(lib/index.js)
try {
  // import.meta 仅 ESM 合法;此处仅做语法检查,替换为占位符
  new Function(sHost.replace(/^import\s.*$/gm, '').replace(/^export\s+/gm, '').replace(/import\.meta\.url/g, '"x"'))
  check(true, 'host 语法有效')
} catch (e) {
  check(false, 'host 语法无效: ' + e.message)
}
check(/export \{ apply/.test(sHost), 'host 导出 apply')
check(sHost.includes("inject = ['webServer']"), 'host 注入 webServer 硬依赖')
check(sHost.includes("from 'node:fs/promises'") && sHost.includes("from 'node:path'"), 'host 用 node:fs/path')
check(sHost.includes('deepseek-ai/deepseek-harness'), 'host 指向官方仓库')
check(sHost.includes('nmbzth/dsh_update_check'), 'host 指向插件自身仓库')
check(sHost.includes('webServer.register'), 'host 注册 webServer 路由')
check(sHost.includes('/upd-check/api/check'), 'host check 路由')
check(sHost.includes('/upd-check/api/settings'), 'host settings 路由')
check(!sHost.includes('/upd-check/api/install'), 'host 不提供 DSH 安装路由')
check(sHost.includes('update-check.json'), 'host 设置文件 $DSH_HOME/update-check.json')
check(sHost.includes('resolveDshHome') && sHost.includes('DSH_HOME'), 'host 解析 DSH_HOME')
check(sHost.includes('sanitizeSettings') && sHost.includes('checkOnStartup') && sHost.includes('checkPluginOnStartup') && sHost.includes('verboseBanner'), 'host 三个开关键')
check(sHost.includes('fetchRemotePluginVersion') && sHost.includes('contents/plugin/package.json'), 'host 检测插件自身远端版本')
check(sHost.includes('readLocalPluginVersion') && sHost.includes('import.meta.url'), 'host 读自身 package.json')
check(sHost.includes('dns.resolve4') && sHost.includes('UPD_URL'), 'host 含 node 直连 + hosts 绕过通道')
check(sHost.includes('npm ls -g @deepseek-ai/dsh'), 'host 检测本地 DSH 版本')
check(!sHost.includes('installJob') && !sHost.includes('npmVersionFromTag'), 'host 无 DSH 安装逻辑')
check(!sHost.includes('harness.'), 'host 不依赖动态插件 harness')

// 2b) 可热插拔实现(lib/impl.js):检测/解析逻辑与监督者分离
try {
  new Function(sImpl.replace(/^import\s.*$/gm, '').replace(/^export\s+/gm, '').replace(/import\.meta\.url/g, '"x"'))
  check(true, 'impl 语法有效')
} catch (e) {
  check(false, 'impl 语法无效: ' + e.message)
}
check(/export const API_VERSION = \d+/.test(sImpl), 'impl 声明 API_VERSION 契约版本')
check(sImpl.includes('export function createEngine'), 'impl 导出 createEngine(deps)')
check(sImpl.includes('return { check'), 'impl 引擎暴露 check(options)')
check(sImpl.includes('parseReleaseNotes'), 'impl 解析 release notes 分节')
check(sImpl.includes('classifySectionKind') && sImpl.includes("'features'") && sImpl.includes("'fixes'"), 'impl 改动分类归一化')
check(sImpl.includes('matchSignals'), 'impl 逐条破坏性信号检测')
check(sImpl.includes('STRONG_PATTERNS') && sImpl.includes('WEAK_PATTERNS'), 'impl 分级关键词表')
check(sImpl.includes('isBreakingChange'), 'impl 含语义版本破坏性判定')
// 本机 DSH 版本检测:模块解析优先 + npm 全局回落,并自报来源
check(sImpl.includes("createRequire") && sImpl.includes("'@deepseek-ai/dsh/package.json'"), 'impl 走模块系统解析本机 DSH')
check(sImpl.indexOf("require_.resolve('@deepseek-ai/dsh/package.json')") < sImpl.indexOf('await detectLocalDshVersion()'), 'impl 模块解析优先于 npm 全局探测')
check(sImpl.includes("source: 'module-resolution'") && sImpl.includes("source: 'npm-global'"), 'impl 回报版本检测来源')
check(sImpl.includes('sourcePath'), 'impl 回报命中的安装路径')
// 限流与网络不通必须区分(两者重试时机不同)
check(sImpl.includes('classifyUpstreamError') && sImpl.includes('/^http-(403|429)$/') && sImpl.includes("'rate-limit'"), 'impl 区分 API 限流与网络不可达')
check(sImpl.indexOf('classifyUpstreamError(e)') > sImpl.indexOf('function classifyUpstreamError'), 'impl 在 check 中复用该分类')
check(!/\bctx\b/.test(sImpl.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) && !sImpl.includes('harness.'), 'impl 不触碰 ctx(纯逻辑,可热插拔)')
{
  const contractHost = /IMPL_CONTRACT = (\d+)/.exec(sHost)
  const contractImpl = /API_VERSION = (\d+)/.exec(sImpl)
  check(
    !!contractHost && !!contractImpl && contractHost[1] === contractImpl[1],
    '监督者 IMPL_CONTRACT 与 impl API_VERSION 一致(' + (contractHost ? contractHost[1] : '?') + ')'
  )
}

// 2c) 热更新框架:装载/换入/校验/回滚/自更新
check(sHost.includes("pathToFileURL(join(LIB_DIR, 'impl.js')).href") && sHost.includes('await import(moduleUrl)'), 'host 运行时动态导入 impl')
check(!/^import\s.*impl\.js/m.test(sHost), 'host 不静态依赖 impl(需可换版本)')
check(sHost.includes("'?v=' + encodeURIComponent"), 'host 按版本 cache-bust 导入(?v=)')
check(sHost.includes('swapEngine') && sHost.includes('enginePromise = Promise.resolve(next)'), 'host 原子换入新引擎')
check(sHost.includes('stageAndValidate') && sHost.includes("join(STAGE_DIR"), 'host 先落 .stage 校验')
check(sHost.includes('node --check'), 'host 用 node --check 校验候选 client 语法')
check(sInstall.includes('stageAndValidate') && sInstall.indexOf('stageAndValidate') < sInstall.indexOf('await rename('), 'host 校验通过后才替换线上文件')
check(sInstall.includes('copyFile(item.backup, item.live)'), 'host 安装失败即回滚(备份还原)')
check(sInstall.includes('engine-swap-failed'), 'host 换引擎失败即回滚并保留旧引擎')
check(sHost.includes('gitBlobSha') && sHost.includes("createHash('sha1')"), 'host 按 git blob sha 精确判定文件变化')
check(sHost.includes("join(BAK_DIR") && sHost.includes("'.bak'"), 'host 备份目录 lib/.bak')
check(sHost.includes('update-check-history.json') && sHost.includes('pushHistory'), 'host 热更新历史落盘')
check(sHost.includes("'/upd-check/api/self-update'"), 'host self-update 路由')
check(sHost.includes('hotFiles') && sHost.includes('restartScope'), 'host 声明热更新边界(哪些文件免重启)')
check(sHost.includes('restartRequired') && sHost.includes('HOT_FILES'), 'host 区分热更新与需重启的 supervisor 变更')
check(sHost.includes("action === 'reload'"), 'host 支持仅重载实现(reload)')
check(/if \(req\.method !== 'POST'\) \{ sendJson\(res, 405/.test(sHost), 'host 自更新仅 POST 可触发(不静默自动更新)')
{
  const start = sHost.indexOf("path: '/upd-check/api/self-update'")
  const get = sHost.slice(start, start + 2400)
  check(get.indexOf("req.method === 'GET'") >= 0 && get.indexOf('await handleSelfUpdate(req, res)') > 0, 'host GET 只读状态、POST 才执行')
}

// 3) Client 半区
try {
  new Function(sClient.replace(/window\.__ModuleLoader__\.load\(/, 'void function(){};(').replace(/\);?\s*$/, ');'))
  check(true, 'client bundle 语法有效')
} catch (e) {
  check(false, 'client bundle 语法无效: ' + e.message)
}
check(/window\.__ModuleLoader__\.load/.test(sClient), 'client 为 ModuleLoader bundle')
check(sClient.includes('exports.inject = ["slots"]') || sClient.includes("exports.inject = ['slots']"), 'client 注入 slots')
check(sClient.includes('/upd-check/api/check') && sClient.includes('/upd-check/api/settings'), 'client 调用 check/settings 接口')
check(sClient.includes('shell.overlay'), 'client 挂载 shell.overlay 横幅')
check(sClient.includes('settings.section') && sClient.includes('id: "upd-check"'), 'client 挂载独立设置页')
check(!sClient.includes('settings.plugins.tab'), 'client 不再挂载插件页签')
check(sClient.includes('verboseBanner'), 'client 支持详细/简略两态')
check(sClient.includes('checkOnStartup') && sClient.includes('checkPluginOnStartup'), 'client 两个启动检查开关')
check(sClient.includes('saveSettings') && sClient.includes('API_SETTINGS'), 'client 可写入设置')
// 插件热更新 UI:仅点击触发,不静默自动更新
check(sClient.includes('API_SELF_UPDATE') && sClient.includes('/upd-check/api/self-update'), 'client 调用 self-update 接口')
check(sClient.includes('doSelfUpdate') && sClient.includes('action: "update"'), 'client 提供手动热更新入口')
check(/onClick: \(\) => \{ doSelfUpdate\(\)\.catch/.test(sClient), 'client 热更新由点击触发')
check(sClient.includes('restartRequired') && sClient.includes('plugin.updatedRestart'), 'client 区分热更新与需重启变更')
{
  const auto = sClient.slice(sClient.indexOf('function scheduleAutoCheck'), sClient.indexOf('function renderSections'))
  check(auto.indexOf('doSelfUpdate') < 0, 'client 启动自动检查不触发自更新(仅提示)')
}
check(sClient.includes('renderSections') && sClient.includes('"section.features"') && sClient.includes('"section.fixes"'), 'client 展示改动分类(字典化标题)')
check(sClient.includes('renderSignals'), 'client 展示完整命中描述')
check(sClient.includes('"banner.rateLimit"') && sClient.includes('state.errorKind === "rate-limit"'), 'client 限流与网络错误分别提示')
check(sClient.includes('"error.upstreamRateLimit"'), 'client 设置页有限流专用文案')
check(sClient.includes('sourceKey') && sClient.includes('source.line') && sClient.includes('"source.module"') && sClient.includes('"source.npm"'), 'client 展示本机版本来源(诊断)')
check(sClient.includes('"section.breakingFull": "破坏性相关描述（完整）："'), '设置页完整命中描述文案在字典中')
check(sClient.includes('const DICT = {') && sClient.includes('zh: {') && sClient.includes('en: {'), 'client 内置 zh/en 字典')
check(sClient.includes('locale.register(NS, "zh"') && sClient.includes('locale.register(NS, "en"'), 'client 注册两种语言字典')
check(sClient.includes('locale.bind(NS)'), 'client 绑定 locale 翻译')
check(sClient.includes('locale.subscribe'), 'client 响应语言切换重渲染')
check(sClient.includes('fallbackTranslate'), 'locale 服务缺失时回退内置字典')
// 回归防线:已是最新时不得残留改动/破坏性描述;插件挂载时必须清空上一次检查结果
check(
  sClient.includes('dsh && dsh.updateAvailable && dsh.signals') && sClient.includes('dsh && dsh.updateAvailable && dsh.sections'),
  '设置页改动/破坏性描述受 updateAvailable 门控(已是最新不显示)'
)
check(
  /store\.set\(\{\s*\n\s*phase: "idle",\s*\n\s*dsh: null,/.test(sClient),
  '插件挂载时清空上一次检查结果(store 重置)'
)
{
  const zhBlock = sClient.slice(sClient.indexOf('zh: {'), sClient.indexOf('en: {'))
  const enBlock = sClient.slice(sClient.indexOf('en: {'), sClient.indexOf('// 回退翻译'))
  const keysOf = (block) => new Set([...block.matchAll(/"([A-Za-z.]+)":/g)].map((m) => m[1]))
  const zhKeys = keysOf(zhBlock)
  const enKeys = keysOf(enBlock)
  const missingEn = [...zhKeys].filter((k) => !enKeys.has(k))
  const missingZh = [...enKeys].filter((k) => !zhKeys.has(k))
  check(
    zhKeys.size > 0 && missingEn.length === 0 && missingZh.length === 0,
    'zh/en 字典键完全一致(' + zhKeys.size + ' 键' + (missingEn.length ? ', 缺 en: ' + missingEn.join(',') : '') + (missingZh.length ? ', 缺 zh: ' + missingZh.join(',') : '') + ')'
  )
}
check(
  !/[\u4e00-\u9fff]/.test(
    sClient
      .replace(/const DICT = \{[\s\S]*?\n\t\t\};/, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
  ),
  'client 界面文案全部走字典(字典与注释外无硬编码中文)'
)
check(sClient.includes('已是最新版本') && sClient.includes('无法连接 GitHub'), 'client 保留最新/网络错误提示')
check(!sClient.includes('confirm-breaking'), 'client 已移除「了解风险/确认更新」旧链路')
check(!sClient.includes('我了解风险'), 'client 已移除旧确认按钮文案')
check(!sClient.includes('再次确认更新'), 'client 已移除两段式确认')
check(!sClient.includes('doInstall') && !sClient.includes('安装更新'), 'client 无安装入口')

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
