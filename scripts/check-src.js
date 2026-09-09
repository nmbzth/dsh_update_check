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
const sClient = read('plugin/lib/client.js')
const sPkg = JSON.parse(read('plugin/package.json'))

// 1) 包结构
check(sPkg.name === 'dsh-update-check', '包名 = dsh-update-check')
check(sPkg.type === 'module' && sPkg.main === 'lib/index.js', 'ESM 入口')
check(sPkg.exports && sPkg.exports['./client'] === './lib/client.js', 'exports["./client"]')
check(sPkg.dsh && sPkg.dsh.client && sPkg.dsh.client.platform === 'web', 'dsh.client platform=web')
check(sPkg.dsh.client.inject && sPkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'), '注入 slots 运行时')

// 2) Host 半区
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
check(!sHost.includes('/upd-check/api/install'), 'host 不提供安装路由')
check(sHost.includes('parseReleaseNotes'), 'host 解析 release notes 分节')
check(sHost.includes('classifySectionKind') && sHost.includes("'features'") && sHost.includes("'fixes'"), 'host 改动分类归一化')
check(sHost.includes('matchSignals'), 'host 逐条破坏性信号检测')
check(sHost.includes('STRONG_PATTERNS') && sHost.includes('WEAK_PATTERNS'), 'host 分级关键词表')
check(sHost.includes('update-check.json'), 'host 设置文件 $DSH_HOME/update-check.json')
check(sHost.includes('resolveDshHome') && sHost.includes('DSH_HOME'), 'host 解析 DSH_HOME')
check(sHost.includes('sanitizeSettings') && sHost.includes('checkOnStartup') && sHost.includes('checkPluginOnStartup') && sHost.includes('verboseBanner'), 'host 三个开关键')
check(sHost.includes('fetchRemotePluginVersion') && sHost.includes('contents/plugin/package.json'), 'host 检测插件自身远端版本')
check(sHost.includes('readLocalPluginVersion') && sHost.includes('import.meta.url'), 'host 读自身 package.json')
check(sHost.includes('dns.resolve4') && sHost.includes('UPD_URL'), 'host 含 node 直连 + hosts 绕过通道')
check(sHost.includes('npm ls -g @deepseek-ai/dsh'), 'host 检测本地 DSH 版本')
check(sHost.includes('isBreakingChange'), 'host 含语义版本破坏性判定')
check(!sHost.includes('installJob') && !sHost.includes('npmVersionFromTag'), 'host 无安装逻辑')
check(!sHost.includes('harness.'), 'host 不依赖动态插件 harness')

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
check(sClient.includes('renderSections') && sClient.includes('SECTION_TITLES'), 'client 展示改动分类')
check(sClient.includes('renderSignals'), 'client 展示完整命中描述')
check(sClient.includes('破坏性相关描述（完整）'), '设置页显示完整命中描述')
check(sClient.includes('已是最新版本') && sClient.includes('无法连接 GitHub'), 'client 保留最新/网络错误提示')
check(!sClient.includes('confirm-breaking'), 'client 已移除「了解风险/确认更新」旧链路')
check(!sClient.includes('我了解风险'), 'client 已移除旧确认按钮文案')
check(!sClient.includes('再次确认更新'), 'client 已移除两段式确认')
check(!sClient.includes('doInstall') && !sClient.includes('安装更新'), 'client 无安装入口')

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
