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
check(sPkg.name === 'dsh-update-check', '静态包名 = dsh-update-check')
check(sPkg.type === 'module' && sPkg.main === 'lib/index.js', '静态包 ESM 入口')
check(sPkg.exports && sPkg.exports['./client'] === './lib/client.js', '静态包 exports["./client"]')
check(sPkg.dsh && sPkg.dsh.client && sPkg.dsh.client.platform === 'web', '静态包 dsh.client platform=web')
check(sPkg.dsh.client.inject && sPkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'), '静态包注入 slots 运行时')

// 2) Host 半区
try {
  new Function(sHost.replace(/^export\s+/gm, ''))
  check(true, '静态 host 语法有效')
} catch (e) {
  check(false, '静态 host 语法无效: ' + e.message)
}
check(/export \{ apply \}/.test(sHost), '静态 host 导出 apply')
check(sHost.includes("inject = ['webServer']"), '静态 host 注入 webServer 硬依赖')
check(sHost.includes('deepseek-ai/deepseek-harness'), 'host 指向官方仓库')
check(sHost.includes('releases/latest') && sHost.includes('/tags'), 'host 含 releases/tags 通道')
check(sHost.includes('webServer.register'), 'host 注册 webServer 路由')
check(sHost.includes('/upd-check/api/check'), 'host check 路由')
check(!sHost.includes('/upd-check/api/install'), 'host 不提供安装路由')
check(!sHost.includes('installJob') && !sHost.includes('npmVersionFromTag'), 'host 无安装后台任务/版本逻辑')
check(!sHost.includes('resolveNpmPath'), 'host 无 npm 路径解析(安装专用)')
check(sHost.includes('UPD_URL') && sHost.includes('dns.resolve4'), 'host 含 node 直连 + hosts 绕过通道')
check(sHost.includes('resolveExecutable'), 'host 用 resolveExecutable 解析 node')
check(sHost.includes('npm ls -g @deepseek-ai/dsh'), 'host 检测 npm 全局安装版本')
check(sHost.includes('isBreakingChange'), 'host 含语义版本破坏性判定')
check(sHost.includes('STRONG_PATTERNS') && sHost.includes('WEAK_PATTERNS'), 'host 含分级关键词表')
check(sHost.includes('breakingSignals'), 'host 返回判定依据(breakingSignals)')
check(!sHost.includes('harness.'), 'host 不依赖动态插件 harness')

// 3) Client 半区
try {
  new Function(sClient.replace(/window\.__ModuleLoader__\.load\(/, 'void function(){};(').replace(/\);?\s*$/, ');'))
  check(true, '静态 client bundle 语法有效')
} catch (e) {
  check(false, '静态 client bundle 语法无效: ' + e.message)
}
check(/window\.__ModuleLoader__\.load/.test(sClient), '静态 client 为 ModuleLoader bundle')
check(sClient.includes('exports.inject = ["slots"]') || sClient.includes("exports.inject = ['slots']"), '静态 client 注入 slots')
check(sClient.includes('/upd-check/api/check'), 'client fetch check API')
check(sClient.includes('shell.overlay'), 'client 挂载 shell.overlay 横幅')
check(sClient.includes('settings.section'), 'client 挂载顶级设置区(settings.section)')
check(sClient.includes('id: "upd-check"'), 'client 设置区 id = upd-check')
check(sClient.includes('order: 9999'), 'client 设置区排最后(order 9999)')
check(sClient.includes('dismissedLatest'), 'client 记住「稍后」的版本,不再重复弹风险横幅')
check(sClient.includes('bannerVisible'), 'client 设置页手动检查不弹顶部横幅(bannerVisible)')
check(sClient.includes('doCheck("manual")'), 'client 设置页「立即检查」标记为 manual 来源')
check(!sClient.includes('API_INSTALL') && !sClient.includes('doInstall'), 'client 无安装接口/流程')
check(!sClient.includes('installProgress') && !sClient.includes('renderProgress'), 'client 无安装进度条')
check(!sClient.includes('installArmed'), 'client 无安装二次确认状态')
check(sClient.includes('↑ 检查更新'), 'client 设置入口显示向上箭头')
check(!sClient.includes('settings.plugins.tab'), 'client 不再挂载插件页签')
check(sClient.includes('无法连接 GitHub'), 'client 网络错误提示')
check(sClient.includes('已是最新版本'), 'client 已是最新提示')
check(sClient.includes('confirm-breaking'), 'client 含风险提示态')
check(sClient.includes('release-notes-weak'), 'client 区分弱信号(可能破坏性)')
check(sClient.includes('breakingSignals'), 'client 展示判定依据片段')
check(sClient.includes('知道了'), 'client 风险提示关闭按钮')

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
