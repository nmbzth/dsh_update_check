// dsh-update-check — 静态 Host 半区:监督者(supervisor)
//
// 分层(可持续热更新的关键):
//   lib/index.js  ← 监督者(本文件,进程级基础设施:服务、设置、网络回退、路由、热更新引擎)
//   lib/impl.js   ← 可热插拔实现(检测/解析逻辑;换版本只需重新 import,不重启 DSH)
//   lib/client.js ← UI 半区(文件变更即由 dsh-client-hmr 推新 rev,免刷新)
//
// 路由:
//   GET  /upd-check/api/check                → 检测(DSH 更新 + 插件自身更新 + 设置)
//   GET  /upd-check/api/settings             → 当前设置 | POST 写入部分设置
//   GET  /upd-check/api/self-update          → 插件热更新状态(引擎版本/契约/历史)
//   POST /upd-check/api/self-update          → 执行插件热更新({action:'update'|'reload', force})
//
// 热更新边界(诚实标注):
//   impl.js / client.js → 免重启生效;index.js(本文件)属进程级基础设施 → 写入后下次启动生效。
// inject 声明 webServer 硬依赖:webServer 由 web-app 层提供,可能晚于本插件激活,
// 声明注入可让 cordis 等服务就绪后再 apply(否则 ctx.get('webServer') 可能为 undefined,路由注册被跳过)。
import { readFile, writeFile, mkdir, rename, copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const inject = ['webServer']
export { apply, resolveDshHome, sanitizeSettings }

const REPO = 'deepseek-ai/deepseek-harness'
const PLUGIN_REPO = 'nmbzth/dsh_update_check'

// 监督者与实现之间的版本契约:impl.js 的 API_VERSION 必须严格等于它
const IMPL_CONTRACT = 2
// 自更新覆盖的文件(相对 plugin/ 目录);顺序即安装顺序
const PATCH_FILES = ['lib/client.js', 'lib/impl.js', 'lib/index.js', 'package.json']
// 安装后免重启即生效的文件
const HOT_FILES = ['lib/client.js', 'lib/impl.js']
const HISTORY_LIMIT = 20

const DEFAULT_SETTINGS = { checkOnStartup: true, checkPluginOnStartup: true, verboseBanner: false }
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS)

function resolveDshHome() {
  try {
    const env = process.env && typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
    if (env) return env
    return join(homedir(), '.dsh')
  } catch (e) {
    return '.dsh'
  }
}

function settingsFilePath() {
  return join(resolveDshHome(), 'update-check.json')
}

function historyFilePath() {
  return join(resolveDshHome(), 'update-check-history.json')
}

function sanitizeSettings(input) {
  const out = {}
  for (const key of SETTING_KEYS) {
    out[key] = input && typeof input[key] === 'boolean' ? input[key] : DEFAULT_SETTINGS[key]
  }
  return out
}

async function readSettings() {
  try {
    const text = await readFile(settingsFilePath(), 'utf8')
    return { settings: sanitizeSettings(JSON.parse(text)), error: null }
  } catch (e) {
    return {
      settings: Object.assign({}, DEFAULT_SETTINGS),
      error: e && e.code === 'ENOENT' ? null : (e && e.message ? String(e.message) : 'settings-read-failed'),
    }
  }
}

async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
  return data
}

async function writeSettings(patch) {
  const current = (await readSettings()).settings
  const next = sanitizeSettings(Object.assign({}, current, patch || {}))
  await writeJsonAtomic(settingsFilePath(), next)
  return next
}

// 版本解析/比较(监督者自带,不依赖 impl —— impl 损坏时监督者仍须可用)
function parseVersionLoose(text) {
  const m = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : null }
}

function compareVersionsLoose(a, b) {
  if (!a || !b) return 0
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const len = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < len; i++) {
    const pa = a.pre[i]
    const pb = b.pre[i]
    if (pa === undefined) return -1
    if (pb === undefined) return 1
    if (pa === pb) continue
    const na = /^\d+$/.test(pa)
    const nb = /^\d+$/.test(pb)
    if (na && nb) return Number(pa) < Number(pb) ? -1 : 1
    if (na) return -1
    if (nb) return 1
    return pa < pb ? -1 : 1
  }
  return 0
}

// git blob sha1:与 GitHub contents API 返回的 sha 同口径,用于精确判定文件是否变化
function gitBlobSha(text) {
  const buf = Buffer.from(text, 'utf8')
  return createHash('sha1').update('blob ' + buf.length + '\u0000').update(buf).digest('hex')
}

function apply(ctx) {
  const timer = ctx.get('timer')
  const web = ctx.get('web')
  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const webServer = ctx.get('webServer')

  const LIB_DIR = dirname(fileURLToPath(import.meta.url))
  const PKG_DIR = dirname(LIB_DIR)
  const STAGE_DIR = join(LIB_DIR, '.stage')
  const BAK_DIR = join(LIB_DIR, '.bak')

  function log(level, message) {
    try {
      const target = ctx.logger
      if (target && typeof target[level] === 'function') target[level]('dsh-update-check: ' + message)
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  function withTimeout(task, timeoutMs) {
    if (!timer) return task
    return Promise.race([task, timer.timeout(timeoutMs).then(() => { throw new Error('fetch-timeout') })])
  }

  async function baseCwd() {
    if (fs) {
      try {
        const target = await fs.resolve('.')
        const p = fs.processPath(target)
        if (p) return p
      } catch (e) { /* ignore */ }
    }
    if (sandboxPolicy && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot
    return '.'
  }

  // 第二传输通道:subprocess 跑 node 直连官方 GitHub API(不依赖 web provider);
  // hosts 劫持环境下用 dns.resolve4 取真实 IP + servername/Host 头绕过。
  async function fetchTextViaNode(url, timeoutMs) {
    if (!subprocess) throw new Error('subprocess-unavailable')
    let nodePath = null
    for (const name of ['node', 'node.exe']) {
      try {
        const resolved = await subprocess.resolveExecutable(name)
        if (resolved) { nodePath = resolved; break }
      } catch (e) { /* try next */ }
    }
    if (!nodePath) throw new Error('node-unavailable')
    const cwd = await baseCwd()
    const script = [
      "const dns = require('dns').promises;",
      "const https = require('https');",
      "const targetUrl = process.env.UPD_URL;",
      "function directGet(u, depth) {",
      "  return new Promise((resolve, reject) => {",
      "    const target = new URL(u);",
      "    dns.resolve4(target.hostname).then((addrs) => {",
      "      const tryIp = (i) => {",
      "        if (i >= addrs.length) return reject(new Error('no-ip'));",
      "        const req = https.request({",
      "          host: addrs[i],",
      "          servername: target.hostname,",
      "          path: target.pathname + target.search,",
      "          method: 'GET',",
      "          headers: { 'User-Agent': 'dsh-update-check', 'Accept': 'application/vnd.github+json,text/html,text/plain', 'Host': target.hostname },",
      "        }, (res) => {",
      "          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && depth > 0) {",
      "            res.resume();",
      "            return resolve(directGet(new URL(res.headers.location, target).href, depth - 1));",
      "          }",
      "          let body = '';",
      "          res.on('data', (c) => { body += c; });",
      "          res.on('end', () => resolve({ status: res.statusCode, body }));",
      "        });",
      "        req.on('error', () => tryIp(i + 1));",
      "        req.end();",
      "      };",
      "      tryIp(0);",
      "    }).catch(reject);",
      "  });",
      "}",
      "fetch(targetUrl, { headers: { 'User-Agent': 'dsh-update-check' } })",
      "  .then((r) => r.text().then((t) => ({ status: r.status, body: t })))",
      "  .catch(() => directGet(targetUrl, 3))",
      "  .then((r) => { process.stdout.write('STATUS=' + r.status + '\\n' + r.body); })",
      "  .catch((e) => { process.stderr.write('ERR=' + (e && e.message || String(e)) + '\\n'); process.exitCode = 1; });",
    ].join('\n')
    const handle = subprocess.spawn({
      argv: [nodePath, '-'],
      cwd,
      stdio: {
        stdin: { data: script },
        stdout: { maxBytes: 1048576, spill: { maxBytes: 4194304 } },
        stderr: { maxBytes: 65536 },
      },
      graceMs: 3000,
      env: { UPD_URL: url },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0) {
      const msg = (stderr || '').trim().slice(0, 300)
      throw new Error(msg ? 'node-fetch:' + msg : 'node-fetch-exit')
    }
    const m = stdout.match(/^STATUS=(\d+)/m)
    const status = m ? Number(m[1]) : 0
    if (status < 200 || status >= 300) throw new Error('http-' + status)
    return stdout.replace(/^STATUS=\d+\r?\n?/, '')
  }

  async function fetchText(url, timeoutMs) {
    const errors = []
    if (web) {
      try {
        return await withTimeout(web.fetch({ url }).then((result) => {
          if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('http-' + result.statusCode)
          return result.body.content
        }), timeoutMs)
      } catch (e) { errors.push(e) }
    }
    try {
      return await withTimeout(fetchTextViaNode(url, timeoutMs), timeoutMs)
    } catch (e) { errors.push(e) }
    for (const e of errors) {
      if (e && /^http-/.test(String(e.message))) throw e
    }
    throw errors[errors.length - 1] || new Error('fetch-failed')
  }

  async function runShell(cmdline) {
    if (!subprocess) throw new Error('subprocess-unavailable')
    const cwd = await baseCwd()
    let lastError = null
    const shells = [
      { argv: ['cmd.exe', '/d', '/s', '/c', cmdline] },
      { argv: ['sh', '-c', cmdline] },
    ]
    for (const shell of shells) {
      try {
        const handle = subprocess.spawn({
          argv: shell.argv,
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: 65536, spill: { maxBytes: 1048576 } },
            stderr: { maxBytes: 65536, spill: { maxBytes: 1048576 } },
          },
          graceMs: 3000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
        const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
        return { exitCode: outcome.exitCode, stdout: stdout || '', stderr: stderr || '' }
      } catch (e) {
        lastError = e
      }
    }
    throw lastError || new Error('no-shell')
  }

  async function detectLocalDshVersion() {
    try {
      const r = await runShell('npm ls -g @deepseek-ai/dsh --depth=0 --json')
      if (r.exitCode === 0 && r.stdout) {
        const data = JSON.parse(r.stdout)
        const dep = data && data.dependencies && data.dependencies['@deepseek-ai/dsh']
        if (dep && typeof dep.version === 'string' && dep.version) return dep.version
      }
    } catch (e) { /* fall through */ }
    try {
      const r = await runShell('npm root -g')
      if (r.exitCode === 0 && r.stdout) {
        const root = r.stdout.trim().split(/\r?\n/)[0]
        if (root && fs) {
          const target = await fs.resolve(root + '/@deepseek-ai/dsh/package.json')
          const text = await fs.readText(target)
          const data = JSON.parse(text)
          if (data && typeof data.version === 'string' && data.version) return data.version
        }
      }
    } catch (e) { /* fall through */ }
    return null
  }

  // 插件自身版本:本地读自身 package.json,远端读仓库内 plugin/package.json
  async function readLocalPluginVersion() {
    try {
      const text = await readFile(join(PKG_DIR, 'package.json'), 'utf8')
      const data = JSON.parse(text)
      return data && typeof data.version === 'string' ? data.version : null
    } catch (e) {
      return null
    }
  }

  async function fetchRemotePluginVersion() {
    try {
      const text = await fetchText('https://api.github.com/repos/' + PLUGIN_REPO + '/contents/plugin/package.json', 12000)
      const data = JSON.parse(text)
      if (data && typeof data.content === 'string') {
        const decoded = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
        const pkg = JSON.parse(decoded)
        if (pkg && typeof pkg.version === 'string') return pkg.version
      }
      return null
    } catch (e) {
      return null
    }
  }

  // 插件自身最新发行版(热更新的内容来源):优先 release tag,缺失时回落远端 package.json
  async function fetchPluginRelease() {
    let release = null
    try {
      const text = await fetchText('https://api.github.com/repos/' + PLUGIN_REPO + '/releases/latest', 12000)
      release = JSON.parse(text)
    } catch (e) { release = null }
    if (release && typeof release.tag_name === 'string' && release.tag_name) {
      const parsed = parseVersionLoose(release.tag_name)
      return {
        tag: release.tag_name,
        version: parsed ? parsed.major + '.' + parsed.minor + '.' + parsed.patch + (parsed.pre ? '-' + parsed.pre.join('.') : '') : null,
        url: typeof release.html_url === 'string' ? release.html_url : null,
        publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      }
    }
    const fallback = await fetchRemotePluginVersion()
    return fallback ? { tag: null, version: fallback, url: null, publishedAt: null } : null
  }

  async function readHistory() {
    try {
      const text = await readFile(historyFilePath(), 'utf8')
      const arr = JSON.parse(text)
      return Array.isArray(arr) ? arr : []
    } catch (e) {
      return []
    }
  }

  async function pushHistory(entry) {
    const arr = await readHistory()
    arr.unshift(entry)
    const next = arr.slice(0, HISTORY_LIMIT)
    try {
      await writeJsonAtomic(historyFilePath(), next)
    } catch (e) { /* 历史写入失败不影响主流程 */ }
    return next
  }

  // ---------- 热插拔实现装载 ----------
  // impl.js 通过 ?v=<version> 导入:URL 变化即 Node ESM 新实例,旧引擎留在内存可回滚。
  let enginePromise = null
  let engineError = null

  function buildDeps() {
    return {
      fetchText,
      detectLocalDshVersion,
      readLocalPluginVersion,
      fetchRemotePluginVersion,
      fetchPluginRelease,
      getSettings: async () => (await readSettings()).settings,
      repos: { dsh: REPO, plugin: PLUGIN_REPO },
      log,
    }
  }

  async function importImpl(moduleUrl) {
    const mod = await import(moduleUrl)
    if (!mod || mod.API_VERSION !== IMPL_CONTRACT) {
      throw new Error('impl-contract-mismatch:' + String(mod && mod.API_VERSION))
    }
    if (typeof mod.createEngine !== 'function') throw new Error('impl-missing-createEngine')
    const engine = mod.createEngine(buildDeps())
    if (!engine || typeof engine.check !== 'function') throw new Error('impl-missing-check')
    return { engine, contract: mod.API_VERSION }
  }

  async function loadEngine(version, bust) {
    const base = pathToFileURL(join(LIB_DIR, 'impl.js')).href
    const query = '?v=' + encodeURIComponent(String(version || 'builtin')) + (bust ? '&t=' + Date.now() : '')
    try {
      const { engine, contract } = await importImpl(base + query)
      return { engine, version: String(version || 'builtin'), contract, error: null }
    } catch (e) {
      return { engine: null, version: String(version || 'builtin'), contract: null, error: e && e.message ? String(e.message) : 'impl-load-failed' }
    }
  }

  async function swapEngine(version, bust) {
    const next = await loadEngine(version, bust)
    if (next.error) throw new Error(next.error)
    enginePromise = Promise.resolve(next)
    engineError = null
    log('info', 'engine swapped → v' + next.version)
    return next
  }

  async function getEngine() {
    const state = await enginePromise
    if (!state || state.error || !state.engine) {
      throw new Error('engine-unavailable:' + String((state && state.error) || engineError || 'not-loaded'))
    }
    return state
  }

  enginePromise = loadEngine('builtin', false).then((state) => {
    if (state.error) {
      engineError = state.error
      log('warn', 'engine load failed: ' + state.error)
    }
    return state
  })

  // ---------- 自更新引擎 ----------
  async function fetchFileAtRef(relPath, ref) {
    const url = 'https://api.github.com/repos/' + PLUGIN_REPO + '/contents/plugin/' + relPath +
      (ref ? '?ref=' + encodeURIComponent(ref) : '')
    const text = await fetchText(url, 15000)
    const data = JSON.parse(text)
    if (!data || typeof data.content !== 'string') throw new Error('file-missing:' + relPath)
    const buf = Buffer.from(data.content.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
    return { text: buf.toString('utf8'), sha: typeof data.sha === 'string' ? data.sha : null }
  }

  // 写入前的静态校验:先把候选文件落到 .stage,全部通过才允许替换线上文件
  async function stageAndValidate(files) {
    await rm(STAGE_DIR, { recursive: true, force: true })
    await mkdir(STAGE_DIR, { recursive: true })
    const staged = []
    for (const file of files) {
      const flat = file.path.replace(/[\\/]/g, '__')
      const stagePath = /\.json$/.test(file.path)
        ? join(STAGE_DIR, flat)
        : join(STAGE_DIR, /client\.js$/.test(file.path) ? flat + '.cjs' : flat + '.mjs')
      await writeFile(stagePath, file.text, 'utf8')
      const item = Object.assign({}, file, { stagePath })
      if (/package\.json$/.test(file.path)) {
        const pkg = JSON.parse(file.text)
        if (!pkg || pkg.name !== 'dsh-update-check') throw new Error('remote-package-invalid')
        if (typeof pkg.version !== 'string' || !parseVersionLoose(pkg.version)) throw new Error('remote-version-invalid')
      } else if (/client\.js$/.test(file.path)) {
        if (!file.text.includes('__ModuleLoader__')) throw new Error('remote-client-invalid')
        const r = await runShell('node --check "' + stagePath + '"')
        if (r.exitCode !== 0) throw new Error('remote-client-syntax:' + String(r.stderr || '').trim().slice(0, 160))
      } else if (/impl\.js$/.test(file.path)) {
        if (!/API_VERSION\s*=\s*\d+/.test(file.text) || !file.text.includes('createEngine')) throw new Error('remote-impl-invalid')
        await importImpl(pathToFileURL(stagePath).href + '?stage=' + Date.now())
      } else if (/index\.js$/.test(file.path)) {
        if (!file.text.includes('webServer.register') || !/inject\s*=\s*\[/.test(file.text)) throw new Error('remote-supervisor-invalid')
      }
      staged.push(item)
    }
    return staged
  }

  async function performSelfUpdate(options) {
    const opts = options || {}
    const force = opts.force === true
    const installed = await readLocalPluginVersion()
    const release = await fetchPluginRelease()
    if (!release || !release.version) throw new Error('release-unavailable')
    const ref = release.tag
    const remotePkg = await fetchFileAtRef('package.json', ref)
    const pkg = JSON.parse(remotePkg.text)
    if (!pkg || pkg.name !== 'dsh-update-check' || typeof pkg.version !== 'string') throw new Error('remote-package-invalid')
    const target = pkg.version
    const cmp = compareVersionsLoose(parseVersionLoose(installed), parseVersionLoose(target))
    if (!force && cmp >= 0) {
      return { ok: true, updateAvailable: false, from: installed, to: target, ref, reason: 'already-latest', files: [] }
    }

    const files = []
    for (const rel of PATCH_FILES) {
      const item = rel === 'package.json' ? remotePkg : await fetchFileAtRef(rel, ref)
      const sha = gitBlobSha(item.text)
      // 下载完整性:GitHub 给出的 blob sha 必须与收到内容一致
      if (item.sha && item.sha !== sha) throw new Error('download-corrupt:' + rel)
      // 是否需要替换:与本地现有内容比对(不是与远端自比)
      let localText = null
      try {
        localText = await readFile(join(PKG_DIR, rel), 'utf8')
      } catch (e) {
        localText = null
      }
      files.push({
        path: rel,
        text: item.text,
        sha,
        changed: localText === null || gitBlobSha(localText) !== sha,
        bytes: Buffer.byteLength(item.text, 'utf8'),
        hot: HOT_FILES.indexOf(rel) >= 0,
      })
    }
    const changed = files.filter((f) => f.changed)
    const summary = files.map((f) => ({ path: f.path, changed: f.changed, bytes: f.bytes, hot: f.hot }))
    if (changed.length === 0) {
      return { ok: true, updateAvailable: true, noop: true, from: installed, to: target, ref, reason: 'content-identical', files: summary }
    }

    const staged = await stageAndValidate(changed)

    // 备份 → 逐个原子替换(同一目录内 rename)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(BAK_DIR, (installed || 'unknown') + '_' + stamp)
    await mkdir(backupDir, { recursive: true })
    const restore = []
    for (const item of staged) {
      const live = join(PKG_DIR, item.path)
      let existed = true
      try {
        await copyFile(live, join(backupDir, item.path.replace(/[\\/]/g, '__')))
      } catch (e) {
        existed = false
      }
      restore.push({ live, backup: join(backupDir, item.path.replace(/[\\/]/g, '__')), existed })
    }
    const installedFiles = []
    let implChanged = false
    let clientChanged = false
    let indexChanged = false
    try {
      for (const item of staged) {
        const live = join(PKG_DIR, item.path)
        await mkdir(dirname(live), { recursive: true })
        await rename(item.stagePath, live)
        installedFiles.push(item.path)
        if (item.path === 'lib/impl.js') implChanged = true
        if (item.path === 'lib/client.js') clientChanged = true
        if (item.path === 'lib/index.js') indexChanged = true
      }
    } catch (e) {
      // 中断即回滚已替换的文件,保证磁盘上始终是一份自洽的版本
      for (const item of restore) {
        try {
          if (item.existed) await copyFile(item.backup, item.live)
          else await rm(item.live, { force: true })
        } catch (err) { /* 尽力而为 */ }
      }
      await rm(STAGE_DIR, { recursive: true, force: true })
      throw new Error('install-failed:' + String(e && e.message || e))
    }
    await rm(STAGE_DIR, { recursive: true, force: true })

    let engine = null
    if (implChanged) {
      try {
        const next = await swapEngine(target, true)
        engine = { version: next.version, contract: next.contract }
      } catch (e) {
        // 新实现无法装载:回滚 impl.js 与 client.js,继续用内存中的旧引擎
        for (const item of restore) {
          if (!/lib\/(impl|client)\.js$/.test(item.live)) continue
          try { if (item.existed) await copyFile(item.backup, item.live) } catch (err) { /* ignore */ }
        }
        throw new Error('engine-swap-failed:' + String(e && e.message || e))
      }
    } else {
      const state = await getEngine().catch(() => null)
      engine = state ? { version: state.version, contract: state.contract } : null
    }

    const result = {
      ok: true,
      updateAvailable: true,
      from: installed,
      to: target,
      ref,
      releaseUrl: release.url,
      files: summary,
      installed: installedFiles,
      backup: backupDir,
      engine,
      hot: implChanged || clientChanged,
      clientReloaded: clientChanged,
      restartRequired: indexChanged,
      at: Date.now(),
    }
    await pushHistory({ at: result.at, ok: true, from: installed, to: target, ref, files: installedFiles, hot: result.hot, restartRequired: indexChanged })
    log('info', 'self-update ' + String(installed) + ' → ' + target + (indexChanged ? ' (supervisor: restart required)' : ' (hot)'))
    return result
  }

  // ---------- HTTP ----------
  function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) { reject(new Error('body-too-large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  async function handleCheck(query) {
    const scopeDsh = query.dsh !== '0'
    const scopePlugin = query.plugin !== '0'
    const { settings, error: settingsError } = await readSettings()
    try {
      const state = await getEngine()
      const payload = await state.engine.check({ dsh: scopeDsh, plugin: scopePlugin })
      if (!payload || payload.ok !== true) {
        return Object.assign({ ok: false, error: (payload && payload.error) || 'engine', message: payload && payload.message }, { settings, settingsError })
      }
      return Object.assign({}, payload, {
        settings,
        settingsError,
        engine: { version: state.version, contract: state.contract },
      })
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'unknown'
      const kind = /^engine-unavailable/.test(msg) ? 'engine' : (msg === 'no-release' ? 'no-release' : 'network')
      return { ok: false, error: kind, message: msg, settings, settingsError }
    }
  }

  async function handleSelfUpdate(req, res) {
    let action = 'update'
    let force = false
    try {
      const raw = await readBody(req, 16384)
      if (raw) {
        const body = JSON.parse(raw)
        if (body && typeof body.action === 'string') action = body.action
        if (body && body.force === true) force = true
      }
    } catch (e) {
      sendJson(res, 200, { ok: false, error: 'bad-request', message: e && e.message ? String(e.message) : 'bad-request' })
      return
    }
    if (action === 'reload') {
      try {
        const installed = await readLocalPluginVersion()
        const next = await swapEngine(installed || 'reload', true)
        sendJson(res, 200, { ok: true, action: 'reload', engine: { version: next.version, contract: next.contract } })
      } catch (e) {
        sendJson(res, 200, { ok: false, action: 'reload', error: 'engine-swap-failed', message: e && e.message ? String(e.message) : 'reload-failed' })
      }
      return
    }
    try {
      const result = await performSelfUpdate({ force })
      sendJson(res, 200, Object.assign({ action: 'update' }, result))
    } catch (e) {
      const message = e && e.message ? String(e.message) : 'self-update-failed'
      // 任何一次自更新尝试都留痕(成功由 performSelfUpdate 内部记录)
      await pushHistory({ at: Date.now(), ok: false, action: 'update', error: message })
      sendJson(res, 200, { ok: false, action: 'update', error: 'self-update-failed', message })
    }
  }

  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/check',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        let query = {}
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          query = { dsh: url.searchParams.get('dsh'), plugin: url.searchParams.get('plugin') }
        } catch (e) { /* default scope */ }
        const result = await handleCheck(query)
        sendJson(res, 200, result)
      },
    }))
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/settings',
      handler: async (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const { settings, error } = await readSettings()
          sendJson(res, 200, { ok: true, settings, error })
          return
        }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        try {
          const raw = await readBody(req, 16384)
          const patch = raw ? JSON.parse(raw) : {}
          const settings = await writeSettings(patch)
          sendJson(res, 200, { ok: true, settings })
        } catch (e) {
          sendJson(res, 200, { ok: false, error: e && e.message ? String(e.message) : 'settings-write-failed' })
        }
      },
    }))
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/self-update',
      handler: async (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const installed = await readLocalPluginVersion()
          const state = await enginePromise
          const history = await readHistory()
          sendJson(res, 200, {
            ok: true,
            installed,
            engine: { version: state && state.version, contract: state && state.contract, error: (state && state.error) || null },
            contract: IMPL_CONTRACT,
            hotFiles: HOT_FILES,
            restartScope: ['lib/index.js'],
            lastUpdate: history[0] || null,
            history: history.slice(0, 5),
          })
          return
        }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        await handleSelfUpdate(req, res)
      },
    }))
  }
}
