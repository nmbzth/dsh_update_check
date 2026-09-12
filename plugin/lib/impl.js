// dsh-update-check — 可热插拔实现(Hot-swappable implementation)
//
// 本文件由监督者(lib/index.js)通过 createEngine(deps) 装载。插件自身热更新时,
// 监督者会用 ?v=<version> 重新导入本文件并原子换入新引擎 —— 不需要重启 DSH。
// 因此:检测/展示逻辑的演进放这里;进程级基础设施(服务、设置、网络回退、路由)放监督者。
//
// 契约:API_VERSION 必须等于监督者的 IMPL_CONTRACT;createEngine(deps) 返回 { check }。
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

export const API_VERSION = 2

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

// 提取每条文本命中的关键词(强优先)
export function matchSignals(text) {
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

export function classifySectionKind(title) {
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
export function parseReleaseNotes(body) {
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

export function parseVersion(text) {
  const m = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : null }
}

export function compareVersions(a, b) {
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

// 破坏性更新判定(语义版本层面):major 变化,或 0.x 阶段 minor 变化
export function isBreakingChange(current, latest) {
  if (!current || !latest) return false
  if (current.major !== latest.major) return true
  if (current.major === 0 && current.minor !== latest.minor) return true
  return false
}

/**
 * 创建一次引擎实例。监督者在初始装载与每次热更新后都会调用。
 * deps 由监督者提供(进程级基础设施),本模块只依赖这组能力,不直接触碰 ctx。
 * @param deps - { fetchText, detectLocalDshVersion, readLocalPluginVersion, fetchRemotePluginVersion, fetchPluginRelease, getSettings, repos }
 * @returns { check(options): Promise<object> }
 */
export function createEngine(deps) {
  const { fetchText, detectLocalDshVersion, readLocalPluginVersion, fetchRemotePluginVersion, fetchPluginRelease, repos } = deps
  const REPO = (repos && repos.dsh) || 'deepseek-ai/deepseek-harness'

  // 本机 DSH 版本:先走模块系统解析——它找到的是「按 Node 解析规则真正会加载的那份安装」,
  // 实测 6ms 且对 pnpm / bun / 本地克隆等布局同样有效;失败再回落到监督者的 npm 全局探测
  // (881ms,且需要 shell + PATH + npm 可用)。source 字段回报实际命中的渠道,便于自证。
  // ponytail: 暂不做 argv 入口自证——模块解析在本部署已直指运行中的那份安装,
  //           等真出现「本地安装遮蔽全局安装」的实际案例再加第三渠道。
  async function resolveDshViaModule() {
    try {
      const require_ = createRequire(String(import.meta.url).split('?')[0])
      const pkgPath = require_.resolve('@deepseek-ai/dsh/package.json')
      const data = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (data && typeof data.version === 'string' && data.version) {
        return { version: data.version, source: 'module-resolution', path: pkgPath }
      }
    } catch (e) { /* 落回 npm 探测 */ }
    return null
  }

  async function resolveDshLocal() {
    const viaModule = await resolveDshViaModule()
    if (viaModule) return viaModule
    try {
      const version = await detectLocalDshVersion()
      return version ? { version, source: 'npm-global' } : null
    } catch (e) {
      return null
    }
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
            return {
              tag: item.name,
              releaseUrl: null,
              publishedAt: null,
              sections: [],
              notesError: lastError ? String(lastError.message || lastError) : 'no-release-notes',
            }
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

  async function check(options) {
    const opts = options || {}
    const scopeDsh = opts.dsh !== false
    const scopePlugin = opts.plugin !== false
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
        const local = await resolveDshLocal()
        const current = local ? local.version : null
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
          source: local ? local.source : null,
          sourcePath: local && local.path ? local.path : null,
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
        const release = await fetchPluginRelease().catch(() => null)
        const latest = release && release.version ? release.version : await fetchRemotePluginVersion()
        const cp = current ? parseVersion(current) : null
        const lp = latest ? parseVersion(latest) : null
        plugin = {
          current: current || null,
          latest: latest || null,
          updateAvailable: !!(cp && lp && compareVersions(cp, lp) < 0),
          repoUrl: 'https://github.com/' + ((repos && repos.plugin) || 'nmbzth/dsh_update_check'),
          targetRef: release && release.tag ? release.tag : null,
          hotUpdateSupported: true,
          error: latest ? null : 'remote-unavailable',
        }
      }
      return { ok: true, checkedAt: Date.now(), dsh, dshError, plugin }
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'unknown'
      return { ok: false, error: msg === 'no-release' ? 'no-release' : 'network', message: msg }
    }
  }

  return { check, fetchUpstream, parseReleaseNotes, parseVersion, compareVersions, isBreakingChange, matchSignals }
}
