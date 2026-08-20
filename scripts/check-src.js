// DSH 更新检查插件 — 源码校验脚本(CI 与本地共用)
// 用法:node scripts/check-src.js
// 校验 src/host.js 与 src/client.js:语法可解析 + 关键契约标记存在。
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

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
