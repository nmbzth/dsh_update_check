// DSH 更新检查插件 — Client 半区
// 用法:把本文件内容作为 cordis_define 的 code.client(函数体)。
return {
  apply(ctx) {
    const timer = ctx.get('timer')
    const slots = ctx.get('slots')

    ctx.effect(() => styles.insert(
      '.upd-banner{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:10px;max-width:min(640px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;background:rgba(24,26,32,0.92);color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.35);pointer-events:auto}' +
      '.upd-banner-text{min-width:0;overflow-wrap:anywhere}' +
      '.upd-banner button{border:0;border-radius:6px;padding:4px 10px;font:inherit;cursor:pointer;white-space:nowrap}' +
      '.upd-btn-primary{background:#4c8dff;color:#fff}' +
      '.upd-btn-primary:disabled{opacity:0.5;cursor:default}' +
      '.upd-btn-ghost{background:rgba(255,255,255,0.16);color:#fff}' +
      '.upd-tab{display:flex;flex-direction:column;gap:14px;max-width:520px;font:13px/1.6 system-ui,sans-serif}' +
      '.upd-tab h3{margin:0;font-size:15px}' +
      '.upd-tab-body{display:flex;flex-direction:column;border-top:1px solid rgba(128,128,128,0.3)}' +
      '.upd-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.2)}' +
      '.upd-row span:first-child{opacity:0.7}' +
      '.upd-actions{display:flex;gap:10px}' +
      '.upd-actions button{border:0;border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer}' +
      '.upd-error{color:#ff6b6b;white-space:pre-wrap;overflow-wrap:anywhere}'
    ))

    const store = {
      state: { phase: 'idle', current: null, latest: null, updateAvailable: false, prerelease: false, localUnreadable: false, checkedAt: null, errorKind: null, message: null },
      listeners: new Set(),
      set(patch) {
        this.state = Object.assign({}, this.state, patch)
        this.listeners.forEach((fn) => fn(this.state))
      },
      setIf(expectedPhase, patch) {
        if (this.state.phase === expectedPhase) this.set(patch)
      },
      subscribe(fn) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
      },
    }

    async function doCheck() {
      store.set({ phase: 'checking', errorKind: null, message: null })
      try {
        const res = await host.call('check', {})
        if (!res || typeof res !== 'object' || res.ok !== true) {
          const err = (res && res.error) || 'network'
          store.set({ phase: 'error', errorKind: err, message: (res && res.message) || null })
          return
        }
        if (res.updateAvailable) {
          store.set({ phase: 'update', current: res.current, latest: res.latest, prerelease: !!res.prerelease, localUnreadable: !!res.localUnreadable, checkedAt: res.checkedAt })
        } else {
          store.set({ phase: 'up-to-date', current: res.current, latest: res.latest, localUnreadable: !!res.localUnreadable, checkedAt: res.checkedAt })
        }
      } catch (e) {
        store.set({ phase: 'error', errorKind: 'network', message: e && e.message ? String(e.message) : 'unknown' })
      }
    }

    async function doInstall() {
      store.set({ phase: 'installing' })
      try {
        const res = await host.call('install', {})
        if (res && res.ok) {
          store.set({ phase: 'installed', message: (res.message) || '安装成功,重启 DSH 后生效' })
        } else {
          store.set({ phase: 'install-error', message: (res && res.message) || '安装失败' })
        }
      } catch (e) {
        store.set({ phase: 'install-error', message: e && e.message ? String(e.message) : '安装失败' })
      }
    }

    let autoChecked = false
    function scheduleAutoCheck() {
      if (autoChecked) return
      autoChecked = true
      if (timer) timer.timeout(() => { doCheck().catch(() => {}) }, 3000)
      else doCheck().catch(() => {})
    }
    scheduleAutoCheck()
    ctx.on('connection/reset', () => scheduleAutoCheck())

    function Banner() {
      const [state, setState] = React.useState(store.state)
      React.useEffect(() => store.subscribe(setState), [])
      React.useEffect(() => {
        if (state.phase !== 'checking' && state.phase !== 'up-to-date') return
        const delay = state.phase === 'checking' ? 4000 : 2500
        if (!timer) return
        const dispose = timer.timeout(() => store.setIf(state.phase, { phase: 'idle' }), delay)
        return dispose
      }, [state.phase])
      if (state.phase === 'idle') return null

      let title = ''
      let buttons = []
      if (state.phase === 'checking') {
        title = '正在检查更新…'
      } else if (state.phase === 'up-to-date') {
        title = state.localUnreadable
          ? '最新版本 ' + (state.latest || '?') + '(无法读取本地版本)'
          : '已是最新版本 ' + (state.latest || '?')
      } else if (state.phase === 'update') {
        title = '发现新版本:' + (state.current || '?') + ' → ' + (state.latest || '?') + (state.prerelease ? '(预发布版)' : '')
        buttons = [
          { label: '立即更新', primary: true, onClick: () => { doInstall().catch(() => {}) } },
          { label: '稍后', primary: false, onClick: () => store.set({ phase: 'idle' }) },
        ]
      } else if (state.phase === 'error') {
        title = state.errorKind === 'no-release'
          ? 'GitHub 上未找到版本信息'
          : '无法连接 GitHub,检查失败(网络不佳或 GitHub 不可达)'
        buttons = [
          { label: '重试', primary: true, onClick: () => { doCheck().catch(() => {}) } },
          { label: '关闭', primary: false, onClick: () => store.set({ phase: 'idle' }) },
        ]
      } else if (state.phase === 'installing') {
        title = '正在安装更新 ' + (state.latest || '') + '…'
      } else if (state.phase === 'installed') {
        title = state.message || '更新安装成功,重启 DSH 后生效'
        buttons = [{ label: '关闭', primary: false, onClick: () => store.set({ phase: 'idle' }) }]
      } else if (state.phase === 'install-error') {
        title = '安装失败:' + (state.message || '未知错误')
        buttons = [{ label: '关闭', primary: false, onClick: () => store.set({ phase: 'idle' }) }]
      }

      return React.createElement('div', { className: 'upd-banner', role: 'alert' },
        React.createElement('span', { className: 'upd-banner-text' }, title),
        buttons.map((b) => React.createElement('button', {
          key: b.label,
          className: b.primary ? 'upd-btn-primary' : 'upd-btn-ghost',
          onClick: b.onClick,
        }, b.label)),
      )
    }

    function UpdaterTab() {
      const [state, setState] = React.useState(store.state)
      React.useEffect(() => store.subscribe(setState), [])
      const busy = state.phase === 'checking' || state.phase === 'installing'
      const phaseLabel = {
        idle: '未检查',
        checking: '检查中…',
        'up-to-date': '已是最新',
        update: '发现更新',
        error: '检查失败',
        installing: '安装中…',
        installed: '已安装',
        'install-error': '安装失败',
      }[state.phase] || state.phase
      const canInstall = !!state.latest && !!state.updateAvailable && state.phase !== 'installing' && state.phase !== 'installed'
      const rows = [
        ['当前版本', state.current || '未知'],
        ['最新版本', state.latest || '—'],
        ['上次检查', state.checkedAt ? new Date(state.checkedAt).toLocaleString() : '—'],
        ['状态', phaseLabel],
      ]
      return React.createElement('div', { className: 'upd-tab' },
        React.createElement('h3', null, '检查更新'),
        React.createElement('div', { className: 'upd-tab-body' },
          rows.map((r) => React.createElement('div', { className: 'upd-row', key: r[0] },
            React.createElement('span', null, r[0]),
            React.createElement('span', null, r[1]),
          )),
        ),
        React.createElement('div', { className: 'upd-actions' },
          React.createElement('button', { className: 'upd-btn-primary', disabled: busy, onClick: () => { doCheck().catch(() => {}) } }, '立即检查'),
          React.createElement('button', { className: 'upd-btn-primary', disabled: !canInstall, onClick: () => { doInstall().catch(() => {}) } }, '安装更新'),
        ),
        (state.phase === 'error' || state.phase === 'install-error')
          ? React.createElement('div', { className: 'upd-error' },
            (state.phase === 'error' ? '检查失败:' : '安装失败:') + (state.message || ''),
          )
          : null,
      )
    }

    if (slots) {
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'updcheck.banner' },
        () => React.createElement(Banner),
      )))
      ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register(
        { name: 'settings.plugins.tab', id: 'check-updates', order: 30, label: '检查更新' },
        () => React.createElement(UpdaterTab),
      )))
    }
  },
}
