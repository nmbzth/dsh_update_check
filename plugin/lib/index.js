// dsh-update-check — 静态 Host 半区(宿主 composition 插件)
// 纯提示型:检测 DSH 上游更新与插件自身更新,结构化解析上游改动,不提供安装。
//   GET  /upd-check/api/check?dsh=1&plugin=1  → 检测结果(版本 + 上游改动分节 + 破坏性条目 + 设置)
//   GET  /upd-check/api/settings              → 当前设置
//   POST /upd-check/api/settings              → 写入部分设置(patch)
// inject 声明 webServer 硬依赖:webServer 由 web-app 层提供,可能晚于本插件激活,
// 声明注入可让 cordis 等服务就绪后再 apply(否则 ctx.get('webServer') 可能为 undefined,路由注册被跳过)。
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer']
export { apply, parseReleaseNotes, matchSignals, classifySectionKind, parseVersion, compareVersions, sanitizeSettings, isBreakingChange }

const REPO = 'deepseek-ai/deepseek-harness'
const PLUGIN_REPO = 'nmbzth/dsh_update_check'

// 高置信度破坏性措辞(强信号)
const STRONG_PATTERNS = [
  /\bbreaking[- ]change[s]?\b/i,
  /\b(?:breaking|breaks?|broke)\s+compatibilit\w*\b/i,
  /\bnot\s+backward[- ]compatible\b/i,
  /\bbackward[- ]incompatible\b/i,
  /\bbc[- ]break[s]?\b/i,
  /破坏性(?:更新|变更|修改|改动)/,
  /破坏[^。\n]{0,12}兼容/,
  /不向后兼容/,
]
// 宽泛措辞(弱信号):同样黄色预警,但由用户核实
const WEAK_PATTERNS = [
  /\bincompatible\b/i,
  /\bmigration\b/i,
  /\bmigrate\b/i,
  /\bremoved\b/i,
  /\bdeprecated\b/i,
  /不兼容/,
  /迁移/,
  /移除/,
  /不再支持/,
]

// release notes 分节 → 归一化分类
const SECTION_KINDS = [
  { key: 'features', zh: /新增功能|新功能/, en: /new features?|features?/i },
  { key: 'fixes', zh: /问题修复|修复/, en: /bug fixes?|fixes?/i },
  { key: 'improvements', zh: /体验优化|优化/, en: /improvements?/i },
  { key: 'other', zh: /其他变更|其他/, en: /chores?|other changes?/i },
  { key: 'sdk', zh: /^sdk$/i, en: /^sdk$/i },
]

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

async function writeSettings(patch) {
  const current = (await readSettings()).settings
  const next = sanitizeSettings(Object.assign({}, current, patch || {}))
  const file = settingsFilePath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await rename(tmp, file)
  return next
}

// 提取每条文本命中的关键词(强优先)
function matchSignals(text) {
  const hits = []
  for (const re of STRONG_PATTERNS) {
    const m = re.exec(text)
    if (m) hits.push({ keyword: m[0], level: 'strong' })
  }
  for (const re of WEAK_PATTERNS) {
    const m = re.exec(text)
    if (m) hits.push({ keyword: m[0], level: 'weak' })
  }
  return hits
}

function classifySectionKind(title) {
  const t = String(title || '').trim()
  for (const kind of SECTION_KINDS) {
    if (kind.zh.test(t) || kind.en.test(t)) return kind.key
  }
  return 'other'
}

function isChineseSectionTitle(title) {
  return /[\u4e00-\u9fff]/.test(String(title || ''))
}

// 解析 release body 为分节条目;优先中文块,缺失回落英文块。
function parseReleaseNotes(body) {
  const lines = String(body || '').split(/\r?\n/)
  const raw = []
  let current = null
  for (const line of lines) {
    const h3 = /^\s*<h3[^>]*>(.*?)<\/h3>\s*$/.exec(line)
    const md = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line)
    const title = h3 ? h3[1] : (md ? md[1] : null)
    if (title !== null) {
      current = { title: String(title).replace(/<[^>]*>/g, '').trim(), items: [] }
      raw.push(current)
      continue
    }
    const item = /^\s*[*-]\s+(.+?)\s*$/.exec(line)
    if (item && current) current.items.push(String(item[1]).trim())
  }
  const hasChinese = raw.some((s) => isChineseSectionTitle(s.title))
  const chosen = hasChinese ? raw.filter((s) => isChineseSectionTitle(s.title)) : raw
  const byKey = new Map()
  for (const section of chosen) {
    if (section.items.length === 0) continue
    const key = classifySectionKind(section.title)
    const entry = byKey.get(key) || { key, title: section.title, items: [] }
    for (const text of section.items) {
      const hits = matchSignals(text)
      entry.items.push(hits.length > 0 ? { text, breaking: hits[0] } : { text })
    }
    byKey.set(key, entry)
  }
  const order = ['features', 'fixes', 'improvements', 'other', 'sdk']
  const sections = [...byKey.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return { sections, hasChinese }
}

function parseVersion(text) {
  const m = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : null }
}

function compareVersions(a, b) {
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

function isBreakingChange(current, latest) {
  if (!current || !latest) return false
  if (current.major !== latest.major) return true
  if (current.major === 0 && current.minor !== latest.minor) return true
  return false
}

function apply(ctx) {
  const timer = ctx.get('timer')
  const web = ctx.get('web')
  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const webServer = ctx.get('webServer')

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

  // 上游最新 release:版本 + 结构化改动分节 + 破坏性条目
  async function fetchUpstream() {
    let release = null
    let lastError = null
    try {
      const text = await fetchText('https://api.github.com/repos/' + REPO + '/releases/latest', 12000)
      release = JSON.parse(text)
    } catch (e) { lastError = e }
    if (!release || typeof release.tag_name !== 'string' || !release.tag_name) {
      try {
        const text = await fetchText('https://api.github.com/repos/' + REPO + '/releases?per_page=1', 12000)
        const arr = JSON.parse(text)
        release = Array.isArray(arr) && arr[0] ? arr[0] : null
      } catch (e) { lastError = lastError || e }
    }
    if (!release || typeof release.tag_name !== 'string' || !release.tag_name) {
      // 版本兜底:tags 通道(无 release notes)
      try {
        const text = await fetchText('https://api.github.com/repos/' + REPO + '/tags', 12000)
        const arr = JSON.parse(text)
        for (const item of Array.isArray(arr) ? arr : []) {
          if (item && typeof item.name === 'string' && parseVersion(item.name)) {
            return { tag: item.name, releaseUrl: null, publishedAt: null, sections: [], notesError: lastError ? String(lastError.message || lastError) : 'no-release-notes' }
          }
        }
      } catch (e) { lastError = lastError || e }
      if (lastError) throw lastError
      throw new Error('no-release')
    }
    const parsed = parseReleaseNotes(release.body || '')
    return {
      tag: release.tag_name,
      releaseUrl: typeof release.html_url === 'string' ? release.html_url : null,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      sections: parsed.sections,
      notesError: null,
    }
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
      const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
      const text = await readFile(pkgPath, 'utf8')
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

  async function handleCheck(query) {
    const scopeDsh = query.dsh !== '0'
    const scopePlugin = query.plugin !== '0'
    const { settings, error: settingsError } = await readSettings()
    try {
      let upstream = null
      let dshError = null
      if (scopeDsh) {
        try {
          upstream = await fetchUpstream()
        } catch (e) {
          dshError = e && e.message === 'no-release' ? 'no-release' : 'network'
          upstream = null
        }
      }
      let dsh = null
      if (upstream) {
        const latestParsed = parseVersion(upstream.tag)
        let current = null
        try { current = await detectLocalDshVersion() } catch (e) { current = null }
        const currentParsed = current ? parseVersion(current) : null
        const updateAvailable = !!(currentParsed && latestParsed && compareVersions(currentParsed, latestParsed) < 0)
        const breakingByVersion = !!(currentParsed && latestParsed && updateAvailable && isBreakingChange(currentParsed, latestParsed))
        const matches = []
        for (const section of upstream.sections || []) {
          for (const item of section.items || []) {
            if (item.breaking) matches.push({ keyword: item.breaking.keyword, level: item.breaking.level, item: item.text, section: section.key })
          }
        }
        const hasStrong = matches.some((m) => m.level === 'strong')
        const hasWeak = matches.some((m) => m.level === 'weak')
        dsh = {
          current: current || null,
          latest: upstream.tag,
          version: latestParsed ? latestParsed.major + '.' + latestParsed.minor + '.' + latestParsed.patch + (latestParsed.pre ? '-' + latestParsed.pre.join('.') : '') : null,
          updateAvailable,
          prerelease: !!(latestParsed && latestParsed.pre),
          localUnreadable: !currentParsed,
          breaking: breakingByVersion || hasStrong || hasWeak,
          breakingReason: breakingByVersion ? 'version' : (hasStrong ? 'release-notes' : (hasWeak ? 'release-notes-weak' : null)),
          signals: matches,
          sections: upstream.sections || [],
          releaseUrl: upstream.releaseUrl,
          publishedAt: upstream.publishedAt,
          notesError: upstream.notesError,
        }
      }
      let plugin = null
      if (scopePlugin) {
        const current = await readLocalPluginVersion()
        const latest = await fetchRemotePluginVersion()
        const cp = current ? parseVersion(current) : null
        const lp = latest ? parseVersion(latest) : null
        plugin = {
          current: current || null,
          latest: latest || null,
          updateAvailable: !!(cp && lp && compareVersions(cp, lp) < 0),
          repoUrl: 'https://github.com/' + PLUGIN_REPO,
          error: latest ? null : 'remote-unavailable',
        }
      }
      return { ok: true, checkedAt: Date.now(), dsh, dshError, plugin, settings, settingsError }
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'unknown'
      return { ok: false, error: msg === 'no-release' ? 'no-release' : 'network', message: msg, settings, settingsError }
    }
  }

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
  }
}
