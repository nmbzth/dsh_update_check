// DSH 更新检查插件 — 源码校验脚本(CI 与本地共用)
// 用法:node scripts/check-src.js
// 校验 src/(动态版)与 plugin/(静态包):语法可解析 + 关键契约标记存在。
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let failed = false
const check = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label)
  if (!cond) failed = true
}

const host = read('src/host.js')
const client = read('src/client.js')

// 1) 语法:两者都是「函数体」(以 return 开头),用 new Function 包裹解析
try {
  new Function(host)
  check(true, 'host.js 语法有效')
} catch (e) {
  check(false, 'host.js 语法无效: ' + e.message)
}
try {
  new Function(client)
  check(true, 'client.js 语法有效')
} catch (e) {
  check(false, 'client.js 语法无效: ' + e.message)
}

// 2) Host 关键契约
check(host.includes('deepseek-ai/deepseek-harness'), 'host 指向官方仓库')
check(host.includes('releases/latest'), 'host 含 releases/latest 通道')
check(host.includes('/tags'), 'host 含 tags 通道')
check(host.includes('UPD_URL'), 'host 含 node 传输通道(UPD_URL)')
check(host.includes('dns.resolve4'), 'host 含 hosts 绕过(dns.resolve4)')
check(host.includes('resolveExecutable'), 'host 用 resolveExecutable 解析 node')
check(host.includes('npm ls -g @deepseek-ai/dsh'), 'host 检测 npm 全局安装版本')
check(host.includes("harness.handle('check'"), 'host 注册 check RPC')
check(host.includes("harness.handle('install'"), 'host 注册 install RPC')
check(host.includes("'\\\\n'"), 'host 子脚本转义保留双反斜杠')
check(host.includes('isBreakingChange'), 'host 含破坏性更新判定(isBreakingChange)')
check(host.includes('fetchBreakingNote'), 'host 含发布说明关键词检测(fetchBreakingNote)')
check(host.includes('breakingReason'), 'host 返回 breakingReason 判定来源')
check(host.includes('BREAKING_PATTERNS'), 'host 含收紧版关键词表(BREAKING_PATTERNS)')
check(host.includes('\\bbreaking[- ]change[s]?\\b'), 'host 关键词含整词 breaking change')

// 3) Client 关键契约
check(client.includes('shell.overlay'), 'client 挂载 shell.overlay 横幅')
check(client.includes('settings.plugins.tab'), 'client 挂载 settings.plugins.tab 页')
check(client.includes('check-updates'), 'client 页签 id = check-updates')
check(client.includes('无法连接 GitHub'), 'client 网络错误提示')
check(client.includes('已是最新版本'), 'client 已是最新提示')
check(client.includes('立即更新'), 'client 发现更新常驻横幅')
check(client.includes('host.call('), 'client 使用 host RPC')
check(client.includes('confirm-breaking'), 'client 含破坏性更新二次确认态')
check(client.includes('upd-banner-warning'), 'client 含黄色高亮样式')
check(client.includes('我了解风险,确认更新'), 'client 二次确认按钮文案')
check(client.includes('再次确认更新'), 'client 设置页两段式确认')

// 4) 静态包(plugin/)契约
const sHost = read('plugin/lib/index.js')
const sClient = read('plugin/lib/client.js')
const sPkg = JSON.parse(read('plugin/package.json'))
check(sPkg.name === 'dsh-update-check', '静态包名 = dsh-update-check')
check(sPkg.type === 'module' && sPkg.main === 'lib/index.js', '静态包 ESM 入口')
check(sPkg.exports && sPkg.exports['./client'] === './lib/client.js', '静态包 exports["./client"]')
check(sPkg.dsh && sPkg.dsh.client && sPkg.dsh.client.platform === 'web', '静态包 dsh.client platform=web')
check(sPkg.dsh.client.inject && sPkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'), '静态包注入 slots 运行时')
check(/export \{ apply \}/.test(sHost), '静态 host 导出 apply')
check(sHost.includes('webServer.register'), '静态 host 注册 webServer 路由')
check(sHost.includes('/upd-check/api/check'), '静态 host check 路由')
check(sHost.includes('/upd-check/api/install'), '静态 host install 路由')
check(sHost.includes('dns.resolve4'), '静态 host 含 hosts 绕过')
check(sHost.includes('BREAKING_PATTERNS'), '静态 host 含破坏性关键词表')
check(!sHost.includes('harness.'), '静态 host 不依赖 harness')
check(/window\.__ModuleLoader__\.load/.test(sClient), '静态 client 为 ModuleLoader bundle')
check(sClient.includes('exports.inject = ["slots"]') || sClient.includes("exports.inject = ['slots']"), '静态 client 注入 slots')
check(sClient.includes('/upd-check/api/check'), '静态 client fetch check API')
check(sClient.includes('confirm-breaking'), '静态 client 含二次确认态')
check(sClient.includes('shell.overlay') && sClient.includes('settings.plugins.tab'), '静态 client 挂载两个插槽')
try {
  new Function(sClient.replace(/window\.__ModuleLoader__\.load\(/, 'void function(){};(').replace(/\);?\s*$/, ');'))
  check(true, '静态 client bundle 语法有效')
} catch (e) {
  check(false, '静态 client bundle 语法无效: ' + e.message)
}

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
