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
  new Function(sHost.replace(/^export\s+/, '').replace(/export \{ apply \}/, 'return { apply }'))
  check(true, '静态 host 语法有效')
} catch (e) {
  check(false, '静态 host 语法无效: ' + e.message)
}
check(/export \{ apply \}/.test(sHost), '静态 host 导出 apply')
check(sHost.includes('deepseek-ai/deepseek-harness'), 'host 指向官方仓库')
check(sHost.includes('releases/latest') && sHost.includes('/tags'), 'host 含 releases/tags 通道')
check(sHost.includes('webServer.register'), 'host 注册 webServer 路由')
check(sHost.includes('/upd-check/api/check'), 'host check 路由')
check(sHost.includes('/upd-check/api/install'), 'host install 路由')
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
check(sClient.includes('shell.overlay') && sClient.includes('settings.plugins.tab'), 'client 挂载两个插槽')
check(sClient.includes('无法连接 GitHub'), 'client 网络错误提示')
check(sClient.includes('已是最新版本'), 'client 已是最新提示')
check(sClient.includes('立即更新'), 'client 发现更新常驻横幅')
check(sClient.includes('confirm-breaking'), 'client 含二次确认态')
check(sClient.includes('release-notes-weak'), 'client 区分弱信号(可能破坏性)')
check(sClient.includes('breakingSignals'), 'client 展示判定依据片段')
check(sClient.includes('我了解风险,确认更新'), 'client 二次确认按钮文案')
check(sClient.includes('再次确认更新'), 'client 设置页两段式确认')

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
