// dsh-update-check — 静态 Host 半区(宿主 composition 插件)
// RPC 改用 webServer HTTP 路由:
//   GET  /upd-check/api/check    → 检查结果 JSON
//   POST /upd-check/api/install  → 执行 npm install -g 更新
// 浏览器客户端(client bundle)通过同源 fetch 调用。
// inject 声明 webServer 硬依赖:webServer 由 web-app 层提供,可能晚于本插件激活,
// 声明注入可让 cordis 等服务就绪后再 apply(否则 ctx.get('webServer') 可能为 undefined,路由注册被跳过)。
export const inject = ['webServer']
export { apply }

function apply(ctx) {
  const timer = ctx.get('timer')
  const web = ctx.get('web')
  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const webServer = ctx.get('webServer')

  const REPO = 'deepseek-ai/deepseek-harness'

  // 破坏性关键词分级:
  // - STRONG:高置信度措辞 → 直接判破坏性(黄色预警 + 二次确认)
  // - WEAK:宽泛的「不兼容 / 迁移 / 移除 / deprecated」等 → 同样黄色预警,
  //   但向用户展示命中的关键词与原文片段,由用户核实是否真的破坏性。
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

  // 提取每个模式的首次命中及其前后上下文片段(供用户核实判定依据)
  function extractSignals(body, patterns) {
    const out = []
    for (const re of patterns) {
      const m = re.exec(String(body || ''))
      if (!m) continue
      const idx = m.index
      const raw = m[0]
      const start = Math.max(0, idx - 30)
      const end = Math.min(body.length, idx + raw.length + 30)
      out.push({ keyword: raw, context: body.slice(start, end).replace(/\s+/g, ' ').trim() })
    }
    return out
  }

  function classifySignals(body) {
    const strong = extractSignals(body, STRONG_PATTERNS)
    const weak = extractSignals(body, WEAK_PATTERNS)
    return {
      strong: strong.length > 0,
      weak: weak.length > 0,
      matches: [
        ...strong.map((m) => Object.assign({}, m, { level: 'strong' })),
        ...weak.map((m) => Object.assign({}, m, { level: 'weak' })),
      ].slice(0, 8),
    }
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

  // 破坏性更新判定(语义版本层面):major 变化,或 0.x 阶段 minor 变化(0.x 中 minor 即事实上的主版本)
  function isBreakingChange(current, latest) {
    if (!current || !latest) return false
    if (current.major !== latest.major) return true
    if (current.major === 0 && current.minor !== latest.minor) return true
    return false
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

  // 第二传输通道:subprocess 跑 node,直接请求官方 GitHub API(不依赖 web provider)。
  // 先尝试标准 fetch(自动跟随重定向);失败(如 hosts 劫持导致证书错误)时,
  // 用 dns.resolve4 取真实 IP + servername/Host 头绕过 hosts 直连,并手动跟随重定向、逐个 IP 重试。
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
        stdout: { maxBytes: 262144, spill: { maxBytes: 1048576 } },
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
    // 优先上报 http-*(GitHub 可达但非 2xx → no-release),否则抛传输错误(→ network)
    for (const e of errors) {
      if (e && /^http-/.test(String(e.message))) throw e
    }
    throw errors[errors.length - 1] || new Error('fetch-failed')
  }

  // 官方发布说明中的破坏性信号检测(尽力而为,失败不阻塞)。
  // 返回 { strong, weak, matches }——matches 为命中的关键词 + 原文片段,供 UI 展示判定依据。
  async function fetchBreakingSignals() {
    try {
      const text = await fetchText('https://api.github.com/repos/' + REPO + '/releases?per_page=1', 10000)
      const arr = JSON.parse(text)
      const body = Array.isArray(arr) && arr[0] ? String(arr[0].body || '') : ''
      return classifySignals(body)
    } catch (e) {
      return { strong: false, weak: false, matches: [] }
    }
  }

  async function fetchLatest() {
    let lastError = null
    // 1) GitHub releases/latest JSON
    try {
      const text = await fetchText('https://api.github.com/repos/' + REPO + '/releases/latest', 10000)
      const data = JSON.parse(text)
      if (data && typeof data.tag_name === 'string' && data.tag_name) {
        return { tag: data.tag_name, source: 'releases', signals: await fetchBreakingSignals() }
      }
      lastError = new Error('parse-no-tag')
    } catch (e) { lastError = e }
    // 2) GitHub tags JSON
    try {
        const text = await fetchText('https://api.github.com/repos/' + REPO + '/tags', 10000)
        const arr = JSON.parse(text)
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && typeof item.name === 'string' && parseVersion(item.name)) {
              return { tag: item.name, source: 'tags', signals: await fetchBreakingSignals() }
            }
          }
        }
        lastError = new Error('parse-no-tags')
      } catch (e) { lastError = e }
    // 3) releases 页面 HTML
    try {
      const text = await fetchText('https://github.com/' + REPO + '/releases/latest', 10000)
      const candidates = []
      const titleMatch = text.match(/<title>([^<]*?)<\/title>/i)
      if (titleMatch) {
        const t = titleMatch[1].replace(/^Release\s+/i, '').replace(/\s*·.*$/, '').trim()
        candidates.push(t)
      }
      const linkMatch = text.match(/\/releases\/tag\/([^"'<>\\\s]+)/)
      if (linkMatch) candidates.push(linkMatch[1])
      for (const c of candidates) {
        if (parseVersion(c)) return { tag: c, source: 'html', signals: await fetchBreakingSignals() }
      }
      lastError = new Error('parse-no-html')
    } catch (e) { lastError = e }
    if (lastError) {
      const msg = lastError.message || ''
      if (/^(parse-|http-)/.test(msg)) throw new Error('no-release')
      throw lastError
    }
    throw new Error('no-release')
  }

  async function resolveNpmPath() {
    if (!subprocess) return null
    const candidates = process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm']
    for (const name of candidates) {
      try {
        const resolved = await subprocess.resolveExecutable(name)
        if (resolved) return resolved
      } catch (e) { /* try next */ }
    }
    return null
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

  async function detectLocalVersion() {
    // 1) npm ls -g 直接读已装版本
    try {
      const r = await runShell('npm ls -g @deepseek-ai/dsh --depth=0 --json')
      if (r.exitCode === 0 && r.stdout) {
        const data = JSON.parse(r.stdout)
        const dep = data && data.dependencies && data.dependencies['@deepseek-ai/dsh']
        if (dep && typeof dep.version === 'string' && dep.version) return dep.version
      }
    } catch (e) { /* fall through */ }
    // 2) npm root -g + fs 读 package.json
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

  async function handleCheck() {
    try {
      const latest = await fetchLatest()
      const latestParsed = parseVersion(latest.tag)
      if (!latestParsed) return { ok: false, error: 'no-release', message: '无法解析远端版本 ' + latest.tag }
      let current = null
      try { current = await detectLocalVersion() } catch (e) { current = null }
      const currentParsed = current ? parseVersion(current) : null
      const updateAvailable = !!(currentParsed && latestParsed && compareVersions(currentParsed, latestParsed) < 0)
      const breakingByVersion = !!(currentParsed && latestParsed && updateAvailable && isBreakingChange(currentParsed, latestParsed))
      const signals = latest.signals || { strong: false, weak: false, matches: [] }
      const breaking = breakingByVersion || signals.strong || signals.weak
      lastCheck = { tag: latest.tag, version: npmVersionFromTag(latest.tag) }
      return {
        ok: true,
        current: current || null,
        latest: latest.tag,
        updateAvailable,
        breaking,
        breakingReason: breakingByVersion ? 'version' : (signals.strong ? 'release-notes' : (signals.weak ? 'release-notes-weak' : null)),
        breakingSignals: signals.matches || [],
        checkedAt: Date.now(),
        prerelease: !!latestParsed.pre,
        localUnreadable: !currentParsed,
      }
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'unknown'
      return { ok: false, error: msg === 'no-release' ? 'no-release' : 'network', message: msg }
    }
  }

  // ===== 安装更新(后台任务 + 状态轮询,支持实时进度条与文件变动窗口) =====
  let installJob = null
  // 最近一次 check 的远端版本,安装时安装该具体版本而不是 npm `latest` 标签:
  // GitHub 检测到 rc.8 时,npm 的 `latest` 可能仍是 rc.7(rc.8 在 `next` 标签),
  // 用 @latest 会「安装成功」但版本不变,导致设置页无法真正更新。
  let lastCheck = null

  function npmVersionFromTag(tag) {
    const m = parseVersion(tag)
    if (!m) return null
    return m.major + '.' + m.minor + '.' + m.patch + (m.pre ? '-' + m.pre.join('.') : '')
  }

  function pushInstallLog(job, line) {
    job.lines.push(line)
    if (job.lines.length > 300) job.lines.splice(0, job.lines.length - 300)
    // 只把与文件变动/错误相关的行放进变动窗口
    if (/added|removed|changed|reify|fetch|error|warn|EPERM|EACCES|ENOENT|not writable|permission|@deepseek-ai/i.test(line)) {
      job.files.push(line)
      if (job.files.length > 120) job.files.splice(0, job.files.length - 120)
    }
  }

  function onInstallOutput(job, text) {
    const lines = String(text || '').split(/\r?\n/)
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      pushInstallLog(job, line)
      job.progress = Math.min(90, job.progress + 1)
      if (/npm http fetch|npm http cache|silly fetch/i.test(line)) {
        job.stage = '正在下载依赖…'
      } else if (/reify|added \d+ package|removed \d+ package|changed \d+ package|npm info reify/i.test(line)) {
        job.stage = '正在写入/更新文件…'
      } else if (/^npm error|EPERM|EACCES|ENOENT|not writable|permission/i.test(line)) {
        job.stage = '安装出错'
      } else {
        job.stage = '正在安装…'
      }
    }
  }

  async function startInstallJob() {
    try {
      if (installJob && installJob.running) {
        return { ok: false, message: '已有安装任务正在执行,请稍候' }
      }
      // 1) 像 node 一样用 resolveExecutable 找 npm 真实路径:
      //    子进程 provider 可能清洗 PATH,裸 `npm` 会报「不是内部或外部命令」。
      const npm = await resolveNpmPath()
      const npmCmd = npm ? '"' + npm + '"' : 'npm'
      let cacheFlag = ''
      // 2) 默认 npm 缓存写 %LOCALAPPDATA%\npm-cache,在 DSH 文件沙箱下会 EPERM;
      //    把缓存指到沙箱可写的 workspace/profile 目录,避免「更新失败」。
      try {
        const cwd = await baseCwd()
        if (cwd && cwd !== '.') {
          cacheFlag = ' --cache "' + cwd.replace(/\\/g, '/') + '/.dsh-update-cache"'
        }
      } catch (e) { /* 拿不到 cwd 时用 npm 默认缓存 */ }
      // 安装 check 检测到的具体版本;没有检测记录时回退 @latest
      // (GitHub 的 rc.8 在 npm 上可能只挂在 `next` 标签,@latest 装不到)
      const pkgSpec = lastCheck && lastCheck.version
        ? '@deepseek-ai/dsh@' + lastCheck.version
        : '@deepseek-ai/dsh@latest'
      // --loglevel=info 让 npm 输出 add/remove/change/reify 等文件变动信息
      const cmdline = npmCmd + ' install -g ' + pkgSpec + cacheFlag + ' --no-audit --no-fund --loglevel=info'
      // PowerShell 版命令(Windows 优先):用单引号包路径,避免外层引号转义问题
      let cacheDir = ''
      try {
        const cwd = await baseCwd()
        if (cwd && cwd !== '.') cacheDir = cwd.replace(/\\/g, '/') + '/.dsh-update-cache'
      } catch (e) { /* 拿不到 cwd 时用 npm 默认缓存 */ }
      const psNpm = npm ? "'" + npm.replace(/'/g, "''") + "'" : 'npm'
      const psCmd = '& ' + psNpm + ' install -g ' + pkgSpec +
        (cacheDir ? " --cache '" + cacheDir.replace(/'/g, "''") + "'" : '') +
        ' --no-audit --no-fund --loglevel=info'
      const job = {
        running: true, progress: 5, stage: '正在启动 npm…', files: [], lines: [],
        message: '', exitCode: null, lastOut: '', lastErr: '', spawnError: null,
      }
      installJob = job
      spawnInstall(job, cmdline, psCmd).catch((e) => {
        job.running = false
        job.progress = 100
        job.stage = '安装失败'
        job.message = e && e.message ? String(e.message) : '安装失败'
        pushInstallLog(job, '安装失败:' + job.message)
      })
      return { ok: true, job: 'install' }
    } catch (e) {
      return { ok: false, message: e && e.message ? String(e.message) : '启动安装失败' }
    }
  }

  async function spawnInstall(job, cmdline, psCmd) {
    if (!subprocess) throw new Error('subprocess-unavailable')
    const cwd = await baseCwd()
    const shells = []
    // Windows 优先用 PowerShell 执行(用户建议:更新走 powershell 安装),
    // 失败再回退 cmd.exe / sh。
    if (process.platform === 'win32') {
      shells.push({ argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd] })
    }
    shells.push({ argv: ['cmd.exe', '/d', '/s', '/c', cmdline] })
    shells.push({ argv: ['sh', '-c', cmdline] })
    let handle = null
    let lastErr = null
    for (const shell of shells) {
      try {
        handle = subprocess.spawn({
          argv: shell.argv,
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: 524288, spill: { maxBytes: 4194304 } },
            stderr: { maxBytes: 262144, spill: { maxBytes: 2097152 } },
          },
          graceMs: 3000,
        })
        break
      } catch (e) { lastErr = e }
    }
    if (!handle) throw lastErr || new Error('no-shell')

    // 增量读取 stdout/stderr(字符串 diff,避免字节偏移在多字节字符处错位)
    const drain = () => {
      try {
        if (handle.collected && handle.collected.stdout) {
          const full = handle.collected.stdout.readFrom(0).text || ''
          if (full !== job.lastOut) {
            const chunk = full.startsWith(job.lastOut) ? full.slice(job.lastOut.length) : full
            job.lastOut = full
            if (chunk) onInstallOutput(job, chunk)
          }
        }
        if (handle.collected && handle.collected.stderr) {
          const full = handle.collected.stderr.readFrom(0).text || ''
          if (full !== job.lastErr) {
            const chunk = full.startsWith(job.lastErr) ? full.slice(job.lastErr.length) : full
            job.lastErr = full
            if (chunk) onInstallOutput(job, chunk)
          }
        }
      } catch (e) { /* 读取失败忽略,等下一次轮询 */ }
    }

    const poll = setInterval(drain, 250)
    try {
      const outcome = await handle.done
      clearInterval(poll)
      drain()
      job.exitCode = outcome.exitCode
      job.running = false
      if (outcome.exitCode === 0) {
        job.progress = 100
        job.stage = '安装完成'
        job.message = '安装成功,重启 DSH 后生效'
      } else {
        job.progress = 100
        job.stage = '安装失败'
        const tail = job.lines.slice(-8).join('\n')
        job.message = tail || ('安装失败(退出码 ' + outcome.exitCode + ')')
        if (/EPERM|EACCES|permission|not writable/i.test(tail)) {
          job.message += '\n提示:写入 npm 全局目录或缓存被拒绝(权限/沙箱限制)。请关闭 DSH 后,在终端手动执行:npm install -g @deepseek-ai/dsh@latest'
        }
      }
    } catch (e) {
      clearInterval(poll)
      job.running = false
      job.progress = 100
      job.stage = '安装失败'
      job.message = e && e.message ? String(e.message) : '安装失败'
    }
  }

  function handleInstallStatus() {
    if (!installJob) {
      return { ok: true, running: false, progress: 0, stage: 'idle', files: [], message: '' }
    }
    return {
      ok: true,
      running: installJob.running,
      progress: installJob.progress,
      stage: installJob.stage,
      files: installJob.files.slice(-80),
      message: installJob.message || '',
      exitCode: installJob.exitCode,
    }
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  // 通过宿主 webServer 暴露 HTTP API(同源 fetch,替代动态插件的 harness RPC)。
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/check',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        const result = await handleCheck()
        sendJson(res, 200, result)
      },
    }))
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/install',
      handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        const result = await startInstallJob()
        sendJson(res, 200, result)
      },
    }))
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/upd-check/api/install/status',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'method' }); return }
        const result = handleInstallStatus()
        sendJson(res, 200, result)
      },
    }))
  }
}
