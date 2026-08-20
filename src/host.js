// DSH 更新检查插件 — Host 半区
// 用法:把本文件内容作为 cordis_define 的 code.host(函数体)。
return {
  apply(ctx) {
    const timer = ctx.get('timer')
    const web = ctx.get('web')
    const subprocess = ctx.get('subprocess')
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')

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

    function handleCheck() {
      return (async () => {
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
      })()
    }

    function handleInstall() {
      return (async () => {
        try {
          const r = await runShell('npm install -g @deepseek-ai/dsh@latest')
          const out = (r.stdout + '\n' + r.stderr).trim().slice(-2000)
          if (r.exitCode === 0) return { ok: true, message: '安装成功,重启 DSH 后生效' }
          return { ok: false, message: out || ('安装失败(退出码 ' + r.exitCode + ')') }
        } catch (e) {
          return { ok: false, message: e && e.message ? String(e.message) : '安装失败' }
        }
      })()
    }

    ctx.effect(() => harness.handle('check', (args) => handleCheck()))
    ctx.effect(() => harness.handle('install', (args) => handleInstall()))
  },
}
