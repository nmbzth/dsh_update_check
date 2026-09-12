// dsh_update_check — 运行期契约自测(不联网、不依赖 DSH 进程)
//
// 用桩 ctx 装载真正的 host 半区(index.js),直接驱动它的真实 HTTP handler,验证热更新框架:
//   ① 路由注册与 /check、/settings 的真实行为
//   ② 热插拔实现装载与契约校验(API_VERSION)
//   ③ 自更新引擎:先校验 → 再原子替换 → 引擎热换入 → 需重启文件单独标注
//   ④ 失败零损伤:远端实现非法时,磁盘与运行中的引擎都保持原状
//
// 用法:node scripts/check-runtime.mjs
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (rel) => readFile(join(ROOT, rel), 'utf8')

let failed = false
const check = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label)
  if (!cond) failed = true
}
const gitBlobSha = (text) => {
  const buf = Buffer.from(text, 'utf8')
  return createHash('sha1').update('blob ' + buf.length + '\u0000').update(buf).digest('hex')
}

// ---------- 素材 ----------
const sIndex = await readSrc('plugin/lib/index.js')
const sImpl = await readSrc('plugin/lib/impl.js')
const sClient = await readSrc('plugin/lib/client.js')
const pkg = JSON.parse(await readSrc('plugin/package.json'))

const IMPL_CONTRACT = Number(/IMPL_CONTRACT = (\d+)/.exec(sIndex)[1])
const nextVersion = String(pkg.version).replace(/(\d+)$/, (m) => String(Number(m) + 1))
const nextVersion2 = String(nextVersion).replace(/(\d+)$/, (m) => String(Number(m) + 1))
const nextVersion3 = String(nextVersion2).replace(/(\d+)$/, (m) => String(Number(m) + 1))

const RELEASE_BODY = [
  '<h3>新增功能</h3>',
  '- 新增插件热更新框架',
  '<h3>其他变更</h3>',
  '- 移除旧接口，属破坏性变更，需要迁移',
].join('\n')

const HOT_IMPL_MARK = 'payload.marker = "HOT2";'
const remoteImplHot = sImpl.replace(
  'return { ok: true, checkedAt: Date.now(), dsh, dshError, plugin }',
  'const payload = { ok: true, checkedAt: Date.now(), dsh, dshError, plugin }; ' + HOT_IMPL_MARK + ' return payload'
)
const remoteClientHot = sClient + '\n// hot-update marker\n'
const remoteIndexHot = sIndex + '\n// supervisor hot-update marker\n'

// ---------- 隔离沙箱:整个包复制到临时目录,自更新只动沙箱 ----------
const box = await mkdtemp(join(tmpdir(), 'dsh-updcheck-'))
await mkdir(join(box, 'lib'), { recursive: true })
await copyFile(join(ROOT, 'plugin/package.json'), join(box, 'package.json'))
await copyFile(join(ROOT, 'plugin/lib/index.js'), join(box, 'lib/index.js'))
await copyFile(join(ROOT, 'plugin/lib/impl.js'), join(box, 'lib/impl.js'))
await copyFile(join(ROOT, 'plugin/lib/client.js'), join(box, 'lib/client.js'))
// 设置与历史必须落在沙箱,绝不污染真实 $DSH_HOME
process.env.DSH_HOME = box

const boxPath = (rel) => join(box, rel)
const boxRead = (rel) => readFile(boxPath(rel), 'utf8')
const boxMayRead = async (rel) => {
  try { return await boxRead(rel) } catch (e) { return null }
}

// ---------- 远端桩(可切换,用于制造失败场景) ----------
const remote = {
  pluginVersion: nextVersion,
  implText: remoteImplHot,
  clientText: remoteClientHot,
  indexText: remoteIndexHot,
}
function remotePkgText(version) {
  return JSON.stringify(Object.assign({}, pkg, { version: version }), null, 2) + '\n'
}
const contentsOf = (rel, version) => {
  if (rel === 'package.json') return remotePkgText(version)
  if (rel === 'lib/impl.js') return remote.implText
  if (rel === 'lib/client.js') return remote.clientText
  if (rel === 'lib/index.js') return remote.indexText
  throw new Error('unstubbed-content:' + rel)
}
const okBody = (content) => ({ statusCode: 200, body: { content } })
let fetchLog = []

async function webFetch({ url }) {
  fetchLog.push(url)
  const u = new URL(url)
  if (u.pathname === '/repos/deepseek-ai/deepseek-harness/releases/latest') {
    return okBody(JSON.stringify({
      tag_name: 'dsh-v0.1.0-rc.8',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8',
      published_at: '2025-01-01T00:00:00Z',
      body: RELEASE_BODY,
    }))
  }
  if (u.pathname === '/repos/nmbzth/dsh_update_check/releases/latest') {
    return okBody(JSON.stringify({
      tag_name: 'v' + remote.pluginVersion,
      html_url: 'https://github.com/nmbzth/dsh_update_check/releases/tag/v' + remote.pluginVersion,
      published_at: '2025-01-02T00:00:00Z',
    }))
  }
  const prefix = '/repos/nmbzth/dsh_update_check/contents/'
  if (u.pathname.startsWith(prefix)) {
    // supervisor 请求 contents/plugin/<rel>,桩按 <rel> 供给
    const rel = u.pathname.slice(prefix.length).replace(/^plugin\//, '')
    const text = contentsOf(rel, remote.pluginVersion)
    return okBody(JSON.stringify({
      content: Buffer.from(text, 'utf8').toString('base64'),
      encoding: 'base64',
      sha: gitBlobSha(text),
    }))
  }
  throw new Error('unstubbed-fetch:' + url)
}

// ---------- 桩 ctx ----------
const routes = new Map()
const fakeTimer = { timeout: () => new Promise(() => {}) }
const fakeFsService = undefined
const fakeWebServer = {
  register(spec) {
    routes.set(spec.path, spec.handler)
    return () => routes.delete(spec.path)
  },
}
// subprocess:只服务 npm 探测;任何经 shell 的 --check 一律失败 ——
// 候选 client 的语法校验必须进程内完成(曾因 cmd.exe 引号改写在真实环境静默失效,
// 当时正是因为桩「宽恕」了它才漏过)
function fakeSubprocess() {
  const runLine = (cmdline) => {
    if (/--check/.test(cmdline)) {
      return { exitCode: 1, stdout: '', stderr: 'SHELL-SYNTAX-CHECK-FORBIDDEN' }
    }
    if (/npm ls -g/.test(cmdline)) {
      return { exitCode: 0, stdout: JSON.stringify({ dependencies: { '@deepseek-ai/dsh': { version: '0.1.0-rc.7' } } }), stderr: '' }
    }
    return { exitCode: 1, stdout: '', stderr: 'unstubbed:' + cmdline }
  }
  return {
    async resolveExecutable() { return process.execPath },
    spawn(request) {
      const out = runLine((request.argv || []).join(' '))
      const stream = (text) => (text ? { readFrom: () => ({ text }) } : null)
      return {
        collected: { stdout: stream(out.stdout), stderr: stream(out.stderr) },
        done: Promise.resolve({ exitCode: out.exitCode }),
      }
    },
  }
}

// web 服务保持同一个对象(host 半区在 apply 时就捕获了它),fetch 可被替换
let offline = false
const webService = {
  fetch: async (request) => {
    if (offline) throw new Error('network-down')
    return webFetch(request)
  },
}

const disposers = []
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  get(name) {
    if (name === 'timer') return fakeTimer
    if (name === 'web') return webService
    if (name === 'webServer') return fakeWebServer
    if (name === 'subprocess') return fakeSubprocess()
    if (name === 'fs') return fakeFsService
    if (name === 'sandboxPolicy') return { workspaceRoot: box }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    disposers.push(dispose)
    return () => { if (typeof dispose === 'function') dispose() }
  },
}

// ---------- 驱动 HTTP handler ----------
function makeRes() {
  return {
    statusCode: 0,
    headers: null,
    chunks: [],
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(chunk) { if (chunk) this.chunks.push(String(chunk)) },
    json() { return JSON.parse(this.chunks.join('') || '{}') },
  }
}
function makeReq(method, url, body) {
  const listeners = {}
  const req = {
    method,
    url,
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); return req },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined) (listeners.data || []).forEach((fn) => fn(Buffer.from(body, 'utf8')))
    ;(listeners.end || []).forEach((fn) => fn())
  })
  return req
}
async function call(pathWithQuery, method, body) {
  const handler = routes.get(String(pathWithQuery).split('?')[0])
  if (!handler) throw new Error('route-missing:' + pathWithQuery)
  const res = makeRes()
  await handler(makeReq(method, pathWithQuery, body), res)
  return res.json()
}

// ---------- 起测 ----------
const hostMod = await import(pathToFileURL(boxPath('lib/index.js')).href)
hostMod.apply(ctx)

check(routes.size === 3, 'apply 注册 3 条路由(实际 ' + routes.size + ')')
check(routes.has('/upd-check/api/check') && routes.has('/upd-check/api/settings') && routes.has('/upd-check/api/self-update'), '三条路由路径齐备')

// ① 检测载荷
const r1 = await call('/upd-check/api/check', 'GET')
check(r1.ok === true, '/check 返回 ok')
check(r1.dsh && r1.dsh.latest === 'dsh-v0.1.0-rc.8', '/check 取到上游最新 tag')
check(r1.dsh && r1.dsh.current === '0.1.0-rc.7', '/check 取到本地 DSH 版本')
check(r1.dsh && r1.dsh.updateAvailable === true && r1.dsh.prerelease === true, '/check 判定有更新(预发布)')
check(r1.dsh && r1.dsh.breaking === true && r1.dsh.breakingReason === 'release-notes', '/check 从改动描述判定破坏性更新')
check(r1.dsh && r1.dsh.signals.length > 0 && r1.dsh.signals[0].keyword, '/check 给出命中关键词证据')
check(r1.dsh && r1.dsh.sections.some((s) => s.key === 'features'), '/check 改动分节归一化(features)')
check(r1.settings && typeof r1.settings.checkOnStartup === 'boolean' && typeof r1.settings.checkPluginOnStartup === 'boolean' && typeof r1.settings.verboseBanner === 'boolean', '/check 附带三项设置')
check(r1.engine && r1.engine.contract === IMPL_CONTRACT, '/check 标注引擎契约版本')
check(r1.plugin && r1.plugin.updateAvailable === true && r1.plugin.targetRef === 'v' + nextVersion, '/check 判定插件有新版本并给出目标 tag')
check(r1.plugin && r1.plugin.hotUpdateSupported === true, '/check 声明支持热更新')

const r2 = await call('/upd-check/api/check?dsh=0', 'GET')
check(r2.ok === true && r2.dsh === null && r2.plugin !== null, '/check?dsh=0 只查插件自身')

// ② 设置读写
const w1 = await call('/upd-check/api/settings', 'POST', JSON.stringify({ checkOnStartup: false }))
check(w1.ok === true && w1.settings.checkOnStartup === false, 'POST /settings 写入生效')
const g1 = await call('/upd-check/api/settings', 'GET')
check(g1.settings.checkOnStartup === false && g1.settings.checkPluginOnStartup === true, 'GET /settings 读回持久化值')
await call('/upd-check/api/settings', 'POST', JSON.stringify({ checkOnStartup: true }))

// ③ 状态路由
const st = await call('/upd-check/api/self-update', 'GET')
check(st.ok === true && st.installed === pkg.version, 'GET /self-update 报告本地版本')
check(st.contract === IMPL_CONTRACT && st.hotFiles.indexOf('lib/impl.js') >= 0 && st.hotFiles.indexOf('lib/client.js') >= 0, 'GET /self-update 声明热更新文件集')
check(Array.isArray(st.restartScope) && st.restartScope.indexOf('lib/index.js') === 0, 'GET /self-update 声明需重启范围')

// ④ 真·热更新:阶段校验 → 原子替换 → 引擎热换入
const up = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
check(up.ok === true, 'POST /self-update 执行成功(' + JSON.stringify(up.message || up.error || '') + ')')
check(up.from === pkg.version && up.to === nextVersion, '自更新版本 ' + pkg.version + ' → ' + nextVersion)
check(up.hot === true && up.clientReloaded === true, '自更新标注界面/实现免重启生效')
check(up.restartRequired === true, '自更新标注 supervisor 变更需下次启动')
check(up.installed && up.installed.length === 4, '自更新替换 4 个文件(实际 ' + (up.installed || []).length + ')')
check(Array.isArray(up.files) && up.files.every((f) => typeof f.changed === 'boolean'), '自更新逐文件报告 changed')

const boxPkg = JSON.parse(await boxRead('package.json'))
check(boxPkg.version === nextVersion, 'install 后 package.json 版本已提升')
check((await boxRead('lib/impl.js')).indexOf('HOT2') > 0, 'install 后 impl.js 为新内容')
check((await boxRead('lib/client.js')).indexOf('hot-update marker') > 0, 'install 后 client.js 为新内容')
check((await boxRead('lib/index.js')).indexOf('supervisor hot-update marker') > 0, 'install 后 index.js 为新内容')
check(await boxMayRead('lib/.stage') === null, 'install 后 .stage 已清理')

const backups = await readdir(join(box, 'lib/.bak')).catch(() => [])
check(backups.length === 1, 'install 生成一代备份(' + backups.length + ')')
const backupFiles = backups.length ? await readdir(join(box, 'lib/.bak', backups[0])) : []
check(backupFiles.length === 4, '备份含全部被替换文件(' + backupFiles.length + ')')

const r3 = await call('/upd-check/api/check', 'GET')
check(r3.ok === true && r3.engine.version === nextVersion, '换入后引擎版本 = ' + nextVersion)
check(r3.dsh && r3.dsh.latest === 'dsh-v0.1.0-rc.8', '换入后仍需正常出检测结果')
const history = JSON.parse(await readFile(join(box, 'update-check-history.json'), 'utf8'))
check(Array.isArray(history) && history.length === 1 && history[0].ok === true, '热更新历史已落盘($DSH_HOME)')
check(history[0].from === pkg.version && history[0].to === nextVersion, '历史记录版本迁移')

// ⑤ 已是新版:不重复安装
const up2 = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
check(up2.ok === true && up2.updateAvailable === false && up2.reason === 'already-latest', '已是最新时不重复安装')

// ⑥ force + 内容一致:零操作
const up3 = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update', force: true }))
check(up3.ok === true && up3.noop === true && up3.reason === 'content-identical', 'force 且内容一致时判定零操作')

// ⑦ reload:仅重载实现,不碰磁盘
const rl = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'reload' }))
check(rl.ok === true && rl.action === 'reload' && rl.engine, 'reload 仅换引擎实例')

// ⑧ 失败零损伤:远端实现契约失配 → 拒绝安装并保持原状
const beforeImpl = await boxRead('lib/impl.js')
const beforePkg = await boxRead('package.json')
remote.pluginVersion = nextVersion2
remote.implText = sImpl.replace('export const API_VERSION = ' + IMPL_CONTRACT, 'export const API_VERSION = 99')
const bad = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
check(bad.ok === false, '远端实现非法时自更新失败(不静默成功)')
check(String(bad.message || '').indexOf('impl-contract-mismatch') >= 0, '失败原因指明契约失配:' + String(bad.message || ''))
check((await boxRead('lib/impl.js')) === beforeImpl, '失败时 impl.js 未被替换')
check((await boxRead('package.json')) === beforePkg, '失败时 package.json 未被替换')
const r4 = await call('/upd-check/api/check', 'GET')
check(r4.ok === true && r4.engine.version === nextVersion, '失败后运行中的引擎仍为 ' + nextVersion)
const history2 = JSON.parse(await readFile(join(box, 'update-check-history.json'), 'utf8'))
check(Array.isArray(history2) && history2.length === 2 && history2[0].ok === false, '失败也记入历史(可追溯)')

// ⑧b 失败零损伤:远端 client 语法坏 → 进程内解析拒绝(不经 shell),磁盘不动
const beforeClient = await boxRead('lib/client.js')
remote.pluginVersion = nextVersion3
remote.implText = remoteImplHot
remote.clientText = remoteClientHot + '\nfunction ('   // 故意破坏语法
const badClient = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
check(badClient.ok === false, '远端 client 语法坏时自更新失败')
check(String(badClient.message || '').indexOf('remote-client-syntax') === 0, '失败原因来自进程内语法校验:' + String(badClient.message || '').slice(0, 80))
check(String(badClient.message || '').indexOf('SHELL-SYNTAX-CHECK-FORBIDDEN') < 0, '未走 shell 语法校验(引号改写防线)')
check(JSON.parse(await boxRead('package.json')).version === nextVersion, '失败时 package.json 未被替换')
check((await boxRead('lib/client.js')) === beforeClient, '失败时 client.js 未被替换')
const history3 = JSON.parse(await readFile(join(box, 'update-check-history.json'), 'utf8'))
check(Array.isArray(history3) && history3.length === 3 && history3[0].ok === false, '第二次失败也留痕')

// ⑨ 网络不可达:检测降级为 dshError=network,而不是抛异常/假成功
check(/releases\/latest/.test(fetchLog[0] || ''), '检测确实走上游 API')
offline = true
const r5 = await call('/upd-check/api/check', 'GET')
offline = false
check(r5.ok === true && r5.dsh === null && r5.dshError === 'network', '网络不可达时降级为 dshError=network')

// ⑩ 限流与网络不可达必须区分(403/429 → rate-limit)
let rateLimited = false
const baseFetch = webService.fetch
webService.fetch = async (request) => {
  if (rateLimited && /deepseek-harness/.test(String(request.url))) {
    const e = new Error('http-403')
    throw e
  }
  return baseFetch(request)
}
rateLimited = true
const r8 = await call('/upd-check/api/check', 'GET')
rateLimited = false
check(r8.ok === true && r8.dsh === null && r8.dshError === 'rate-limit', '上游 403 归类为 rate-limit(实际 ' + r8.dshError + ')')
check(r8.plugin && r8.plugin.updateAvailable === true, '限流只影响 DSH 上游,插件自身检测不受影响')
webService.fetch = baseFetch

// ⑪ 本机版本检测渠道:模块解析优先于 npm 全局探测,并自报来源
check(r1.dsh && r1.dsh.source === 'npm-global', '沙箱无 dsh 包时回落 npm 全局探测(实际 ' + (r1.dsh && r1.dsh.source) + ')')
check(r1.dsh && r1.dsh.current === '0.1.0-rc.7', '回落渠道读到 npm 桩版本')
await mkdir(join(box, 'node_modules/@deepseek-ai/dsh'), { recursive: true })
await writeFile(join(box, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-planted' }, null, 2), 'utf8')
const r6 = await call('/upd-check/api/check', 'GET')
check(r6.dsh && r6.dsh.source === 'module-resolution', '植入 dsh 包后命中模块解析(实际 ' + (r6.dsh && r6.dsh.source) + ')')
check(r6.dsh && r6.dsh.current === '9.9.9-planted', '模块解析优先于 npm 全局探测(读到 ' + (r6.dsh && r6.dsh.current) + ')')
check(r6.dsh && typeof r6.dsh.sourcePath === 'string' && r6.dsh.sourcePath.indexOf('node_modules') > 0, '回报命中的安装路径(' + (r6.dsh && r6.dsh.sourcePath) + ')')
check(r6.dsh && r6.dsh.updateAvailable === false, '本地 9.9.9 高于上游 → 判定无更新')
await rm(join(box, 'node_modules'), { recursive: true, force: true })
const r7 = await call('/upd-check/api/check', 'GET')
check(r7.dsh && r7.dsh.source === 'npm-global' && r7.dsh.updateAvailable === true, '移除植入包后回落且恢复「有更新」判定')

// 清理
for (const dispose of disposers) {
  try { if (typeof dispose === 'function') dispose() } catch (e) { /* ignore */ }
}
await rm(box, { recursive: true, force: true })

console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
process.exit(failed ? 1 : 0)
