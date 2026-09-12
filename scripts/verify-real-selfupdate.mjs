// dsh_update_check — 真实网络端到端验证(可选,不进 CI)
//
// 与 check-runtime.mjs 的分工:那个用桩远端验证「逻辑与失败路径」,这个用**真实 GitHub**验证
// 「框架真的能把自己更新掉」——把某个副本降到 0.0.1 并制造内容漂移,然后对它执行一次真自更新。
//
// 用法:
//   node scripts/verify-real-selfupdate.mjs                  # 源 = 仓库 plugin/
//   node scripts/verify-real-selfupdate.mjs <包目录>          # 源 = 指定已部署的包目录
//
// 安全:全程只在系统临时目录里操作副本,**不改动源目录**,跑完即删。
// 网络:GitHub 不可达(或本机 hosts 劫持且无直连能力)时输出 SKIP 并以 0 退出,不误报失败。
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { promises as dns } from 'node:dns'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = process.argv[2] ? process.argv[2] : join(ROOT, 'plugin')
const FALLBACK_VERSION = '0.0.1'

let failed = false
const check = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label)
  if (!cond) failed = true
}

// 本机常见 hosts 劫持:先试标准 fetch,失败再走 DNS 直连(与插件生产通道同款)
async function directGet(u, depth = 4) {
  const target = new URL(u)
  const addrs = await dns.resolve4(target.hostname)
  let lastError = null
  for (const ip of addrs) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          host: ip,
          servername: target.hostname,
          path: target.pathname + target.search,
          method: 'GET',
          headers: { 'User-Agent': 'dsh-update-check-verify', Accept: 'application/vnd.github+json', Host: target.hostname },
        }, (r) => {
          let body = ''
          r.on('data', (c) => { body += c })
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }))
        })
        req.on('error', reject)
        req.end()
      })
      if ([301, 302, 303, 307, 308].indexOf(res.status) >= 0 && res.headers.location && depth > 0) {
        return await directGet(new URL(res.headers.location, target).href, depth - 1)
      }
      if (res.status < 200 || res.status >= 300) throw new Error('http-' + res.status)
      return res.body
    } catch (e) { lastError = e }
  }
  throw lastError || new Error('no-ip')
}
async function getText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'dsh-update-check-verify', Accept: 'application/vnd.github+json' } })
    const body = await r.text()
    if (r.status < 200 || r.status >= 300) throw new Error('http-' + r.status)
    return body
  } catch (e) {
    return await directGet(url)
  }
}

// 沙箱:源目录 → 临时副本,版本降到 0.0.1 并制造内容漂移(保证四个文件都需替换)
const box = await mkdtemp(join(tmpdir(), 'dsh-real-'))
try {
  await mkdir(join(box, 'lib'), { recursive: true })
  const pkg = JSON.parse(await readFile(join(SOURCE, 'package.json'), 'utf8'))
  const originalVersion = pkg.version
  pkg.version = FALLBACK_VERSION
  await writeFile(join(box, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  for (const rel of ['lib/index.js', 'lib/impl.js', 'lib/client.js']) {
    const text = await readFile(join(SOURCE, rel), 'utf8')
    await writeFile(join(box, rel), text + '\n// local drift marker\n', 'utf8')
  }
  process.env.DSH_HOME = box

  // 先探一次网络:不可达就 SKIP,不误报
  let releaseTag = null
  try {
    const body = await getText('https://api.github.com/repos/nmbzth/dsh_update_check/releases/latest')
    releaseTag = JSON.parse(body).tag_name
  } catch (e) {
    console.log('SKIP  GitHub 不可达,跳过联网端到端验证:' + String(e && e.message || e))
    console.log('RESULT: SKIPPED')
  }

  if (releaseTag) {
    const routes = new Map()
    const webService = { fetch: async ({ url }) => ({ statusCode: 200, body: { content: await getText(url) } }) }
    const subprocess = {
      async resolveExecutable() { return process.execPath },
      spawn(request) {
        const line = (request.argv || []).join(' ')
        let out = { exitCode: 1, stdout: '', stderr: 'unstubbed:' + line }
        const m = /--check\s+"?([^"]+)"?/.exec(line)
        if (m) {
          try { new Function(readFileSync(m[1], 'utf8')); out = { exitCode: 0, stdout: '', stderr: '' } }
          catch (e) { out = { exitCode: 1, stdout: '', stderr: String(e.message) } }
        } else if (/npm ls -g/.test(line)) {
          out = { exitCode: 0, stdout: JSON.stringify({ dependencies: { '@deepseek-ai/dsh': { version: '0.0.0-verify' } } }), stderr: '' }
        }
        const stream = (t) => (t ? { readFrom: () => ({ text: t }) } : null)
        return { collected: { stdout: stream(out.stdout), stderr: stream(out.stderr) }, done: Promise.resolve({ exitCode: out.exitCode }) }
      },
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get(name) {
        if (name === 'timer') return { timeout: () => new Promise(() => {}) }
        if (name === 'web') return webService
        if (name === 'webServer') return { register(s) { routes.set(s.path, s.handler); return () => routes.delete(s.path) } }
        if (name === 'subprocess') return subprocess
        if (name === 'sandboxPolicy') return { workspaceRoot: box }
        return undefined
      },
      effect(fn) { fn() },
    }
    const makeRes = () => ({ chunks: [], writeHead() {}, end(c) { if (c) this.chunks.push(String(c)) }, json() { return JSON.parse(this.chunks.join('') || '{}') } })
    const makeReq = (method, body) => {
      const listeners = {}
      const req = { method, url: '/verify', on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); return req }, destroy() {} }
      queueMicrotask(() => {
        if (body !== undefined) (listeners.data || []).forEach((fn) => fn(Buffer.from(body, 'utf8')))
        ;(listeners.end || []).forEach((fn) => fn())
      })
      return req
    }
    const call = async (path, method, body) => {
      const res = makeRes()
      await routes.get(path)(makeReq(method, body), res)
      return res.json()
    }

    const host = await import(pathToFileURL(join(box, 'lib/index.js')).href)
    host.apply(ctx)
    check(routes.size === 3, '沙箱内路由注册')

    const up = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
    const targetVersion = releaseTag.replace(/^v/, '')
    check(up.ok === true, '真实自更新成功' + (up.ok ? '' : '(' + (up.error || '') + ': ' + (up.message || '') + ')'))
    check(up.from === FALLBACK_VERSION && up.to === targetVersion && up.ref === releaseTag, '目标来自 releases/latest(' + releaseTag + ')')
    check(Array.isArray(up.installed) && up.installed.length === 4, '四个文件全部替换')
    check(up.hot === true, '标注为免重启生效')

    const newImpl = await readFile(join(box, 'lib/impl.js'), 'utf8')
    const newPkg = JSON.parse(await readFile(join(box, 'package.json'), 'utf8'))
    check(newImpl.indexOf('local drift marker') < 0 && newImpl.indexOf('createEngine') > 0, 'impl.js 已替换为发布内容')
    check(newPkg.version === targetVersion, 'package.json 版本 = ' + targetVersion)

    const r = await call('/upd-check/api/check', 'GET')
    check(r.ok === true && r.engine.version === targetVersion, '换入后引擎版本 = ' + targetVersion)
    check(r.dsh && typeof r.dsh.latest === 'string' && /^dsh-v\d/.test(r.dsh.latest), '真实上游检测正常(latest=' + (r.dsh && r.dsh.latest) + ')')
    check(r.plugin && r.plugin.current === targetVersion && r.plugin.updateAvailable === false, '插件自身判定为已最新')

    const baks = await readdir(join(box, 'lib/.bak')).catch(() => [])
    const bakFiles = baks.length ? await readdir(join(box, 'lib/.bak', baks[0])) : []
    check(baks.length === 1 && bakFiles.length === 4, '备份 1 代 × 4 文件')

    const up2 = await call('/upd-check/api/self-update', 'POST', JSON.stringify({ action: 'update' }))
    check(up2.ok === true && up2.updateAvailable === false, '重复执行 → 已是最新')

    console.log('   源目录版本 ' + originalVersion + ' → 已验证可由 Release ' + releaseTag + ' 自我更新')
    console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASS')
  }
} finally {
  await rm(box, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
