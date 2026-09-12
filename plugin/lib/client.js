// dsh-update-check — 静态 Client 半区(浏览器 bundle,ModuleLoader 格式)
// 多语言:注册 dsh-update-check 命名空间的 zh / en 字典,经 client locale 服务翻译;
// 语言切换通过 locale.subscribe 触发重渲染。locale 服务缺失时回退内置中文字典。
window.__ModuleLoader__.load({
	id: "dsh-update-check",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const NS = "dsh-update-check";
		const API_CHECK = "/upd-check/api/check";
		const API_SETTINGS = "/upd-check/api/settings";
		const API_SELF_UPDATE = "/upd-check/api/self-update";

		const DICT = {
			zh: {
				"banner.checking": "正在检查更新…",
				"banner.upToDate": "已是最新版本：{version}",
				"banner.upToDateBare": "已是最新版本",
				"banner.update": "发现更新：{items}",
				"banner.updateBreaking": "⚠️ 发现更新（含破坏性变更）：{items}",
				"banner.dshItem": "DSH {from} → {to}",
				"banner.pluginItem": "插件 {from} → {to}",
				"banner.details": "详情",
				"banner.collapse": "收起",
				"banner.later": "稍后",
				"banner.retry": "重试",
				"banner.close": "关闭",
				"banner.networkError": "无法连接 GitHub，检查失败（网络不佳或 GitHub 不可达）",
				"banner.rateLimit": "GitHub 拒绝请求：匿名 API 限流（60 次/小时）已用尽，稍后重试即可",
				"banner.noRelease": "GitHub 上未找到版本信息",
				"banner.breakingHint": "该版本包含疑似破坏性变更，请确认插件兼容性后再更新：",
				"banner.pluginHint": "插件自身有新版本：{from} → {to}（见设置页）",
				"page.title": "↑ 检查更新",
				"card.dsh": "DSH 更新",
				"card.plugin": "插件自身更新",
				"card.settings": "设置",
				"row.currentDsh": "当前 DSH 版本",
				"row.latestDsh": "最新 DSH 版本",
				"row.publishedAt": "发布时间",
				"row.lastCheck": "上次检查",
				"row.status": "状态",
				"row.currentPlugin": "当前插件版本",
				"row.latestPlugin": "最新插件版本",
				"source.line": "本机版本来源:{source}{path}",
				"source.module": "模块解析",
				"source.npm": "npm 全局探测",
				"source.unknown": "未知",
				"btn.checkNow": "立即检查",
				"btn.releaseNotes": "查看发布说明",
				"status.idle": "未检查",
				"status.checking": "检查中…",
				"status.upToDate": "已是最新",
				"status.update": "发现更新",
				"status.error": "检查失败",
				"badge.update": "发现新版本",
				"badge.breakingUpdate": "发现更新（含破坏性变更）",
				"section.breakingFull": "破坏性相关描述（完整）：",
				"section.changes": "本次改动",
				"section.none": "（无发布说明可展示）",
				"section.notesError": "（未获取到发布说明：{error}）",
				"section.more": "… 另有 {count} 条，见设置页",
				"section.features": "新增功能",
				"section.fixes": "问题修复",
				"section.improvements": "体验优化",
				"section.other": "其他变更",
				"section.sdk": "SDK",
				"plugin.statusUpdate": "有新版本（可一键热更新）",
				"plugin.statusLatest": "已是最新",
				"plugin.statusUnchecked": "未检查",
				"plugin.repo": "插件仓库",
				"btn.hotUpdate": "热更新插件",
				"btn.updating": "热更新中…",
				"plugin.hotHint": "免重启:检测/界面代码原子换入并校验,失败自动回滚",
				"plugin.updatedHot": "热更新完成:{from} → {to}(已生效,无需重启)",
				"plugin.updatedRestart": "热更新完成:{from} → {to}(进程级变更,下次启动生效)",
				"plugin.updateFailed": "热更新失败(已回滚):{error}",
				"value.unknown": "未知",
				"value.unavailable": "无法获取",
				"value.dash": "—",
				"switch.checkDsh": "每次启动检查 DSH 更新",
				"switch.checkDshHint": "打开页面时自动检查上游是否有新版本",
				"switch.checkPlugin": "每次启动检查插件自身更新",
				"switch.checkPluginHint": "打开页面时自动检查本插件是否有新版本",
				"switch.verbose": "顶部窗口显示描述细节",
				"switch.verboseHint": "开：横幅直接展示改动细节；关：只显示版本提示，点「详情」展开",
				"error.checkFailed": "检查失败：{message}",
				"error.upstreamFailed": "上游检查失败：{error}",
				"error.upstreamRateLimit": "上游检查失败：GitHub 匿名 API 限流（60 次/小时）已用尽，稍后重试即可",
				"error.settingsSave": "设置保存失败：{error}",
				"signal.strong": "强信号",
				"signal.weak": "弱信号",
				"signal.hit": "[{level}] 命中关键词：{keyword}"
			},
			en: {
				"banner.checking": "Checking for updates…",
				"banner.upToDate": "Up to date: {version}",
				"banner.upToDateBare": "Up to date",
				"banner.update": "Update available: {items}",
				"banner.updateBreaking": "⚠️ Update available (breaking changes): {items}",
				"banner.dshItem": "DSH {from} → {to}",
				"banner.pluginItem": "Plugin {from} → {to}",
				"banner.details": "Details",
				"banner.collapse": "Collapse",
				"banner.later": "Later",
				"banner.retry": "Retry",
				"banner.close": "Close",
				"banner.networkError": "Cannot reach GitHub — check failed (network issue or GitHub unreachable)",
				"banner.rateLimit": "GitHub rejected the request: the anonymous API limit (60/hour) is exhausted — try again later",
				"banner.noRelease": "No version info found on GitHub",
				"banner.breakingHint": "This version may contain breaking changes — verify plugin compatibility before updating:",
				"banner.pluginHint": "The plugin itself has a new version: {from} → {to} (see Settings)",
				"page.title": "↑ Check for updates",
				"card.dsh": "DSH update",
				"card.plugin": "Plugin self-update",
				"card.settings": "Settings",
				"row.currentDsh": "Current DSH version",
				"row.latestDsh": "Latest DSH version",
				"row.publishedAt": "Published at",
				"row.lastCheck": "Last checked",
				"row.status": "Status",
				"row.currentPlugin": "Current plugin version",
				"row.latestPlugin": "Latest plugin version",
				"source.line": "Local version detected via {source}{path}",
				"source.module": "module resolution",
				"source.npm": "npm global probe",
				"source.unknown": "unknown",
				"btn.checkNow": "Check now",
				"btn.releaseNotes": "Release notes",
				"status.idle": "Not checked",
				"status.checking": "Checking…",
				"status.upToDate": "Up to date",
				"status.update": "Update available",
				"status.error": "Check failed",
				"badge.update": "New version available",
				"badge.breakingUpdate": "Update available (breaking changes)",
				"section.breakingFull": "Breaking-change descriptions (full):",
				"section.changes": "Changes in this release",
				"section.none": "(no release notes to show)",
				"section.notesError": "(release notes unavailable: {error})",
				"section.more": "… {count} more, see Settings",
				"section.features": "New features",
				"section.fixes": "Bug fixes",
				"section.improvements": "Improvements",
				"section.other": "Other changes",
				"section.sdk": "SDK",
				"plugin.statusUpdate": "New version available (one-click hot update)",
				"plugin.statusLatest": "Up to date",
				"plugin.statusUnchecked": "Not checked",
				"plugin.repo": "Plugin repository",
				"btn.hotUpdate": "Hot-update plugin",
				"btn.updating": "Hot-updating…",
				"plugin.hotHint": "No restart: engine and UI code are validated and swapped atomically, with automatic rollback on failure",
				"plugin.updatedHot": "Hot update done: {from} → {to} (live now, no restart needed)",
				"plugin.updatedRestart": "Hot update done: {from} → {to} (process-level change, applies on next start)",
				"plugin.updateFailed": "Hot update failed (rolled back): {error}",
				"value.unknown": "Unknown",
				"value.unavailable": "Unavailable",
				"value.dash": "—",
				"switch.checkDsh": "Check DSH updates on startup",
				"switch.checkDshHint": "Automatically check the upstream repo when the page loads",
				"switch.checkPlugin": "Check plugin updates on startup",
				"switch.checkPluginHint": "Automatically check this plugin's own version when the page loads",
				"switch.verbose": "Show details in the top banner",
				"switch.verboseHint": "On: expand details in the banner; Off: show only the version line with a Details button",
				"error.checkFailed": "Check failed: {message}",
				"error.upstreamFailed": "Upstream check failed: {error}",
				"error.upstreamRateLimit": "Upstream check failed: GitHub's anonymous API limit (60/hour) is exhausted — try again later",
				"error.settingsSave": "Failed to save settings: {error}",
				"signal.strong": "Strong",
				"signal.weak": "Weak",
				"signal.hit": "[{level}] Matched keyword: {keyword}"
			}
		};

		// 回退翻译(locale 服务不可用时使用内置中文)
		function fallbackTranslate(key, params) {
			const template = DICT.zh[key] || key;
			if (!params) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
		}

		const STYLE = {
			banner: {
				position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
				zIndex: 10000, display: "flex", flexDirection: "column", gap: 8,
				alignItems: "stretch", maxWidth: "min(680px, calc(100vw - 32px))",
				padding: "12px 16px", borderRadius: 10,
				background: "rgba(24,26,32,0.94)", color: "#fff",
				font: "13px/1.6 system-ui, sans-serif",
				boxShadow: "0 6px 24px rgba(0,0,0,0.35)", pointerEvents: "auto"
			},
			bannerWarning: {
				position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
				zIndex: 10000, display: "flex", flexDirection: "column", gap: 8,
				alignItems: "stretch", maxWidth: "min(680px, calc(100vw - 32px))",
				padding: "12px 16px", borderRadius: 10,
				background: "rgba(122,92,0,0.96)", border: "1px solid #ffc107", color: "#ffe082",
				font: "13px/1.6 system-ui, sans-serif",
				boxShadow: "0 6px 24px rgba(0,0,0,0.35)", pointerEvents: "auto"
			},
			text: { minWidth: 0, overflowWrap: "anywhere" },
			dim: { opacity: 0.8 },
			warningText: { color: "#ffc107", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
			signalRow: { display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", borderRadius: 6, background: "rgba(255,193,7,0.14)", width: "100%" },
			signalKeyword: { color: "#ffd54f", fontWeight: 600 },
			signalContext: { color: "#ffe082", overflowWrap: "anywhere" },
			list: { display: "flex", flexDirection: "column", gap: 4, margin: 0, padding: "0 0 0 18px", maxHeight: 220, overflowY: "auto", textAlign: "left" },
			btnRow: { display: "flex", gap: 10, justifyContent: "flex-end" },
			btnPrimary: { border: 0, borderRadius: 6, padding: "5px 12px", font: "inherit", cursor: "pointer", background: "#4c8dff", color: "#fff" },
			btnGhost: { border: 0, borderRadius: 6, padding: "5px 12px", font: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.16)", color: "#fff" },
			tab: { display: "flex", flexDirection: "column", gap: 18, maxWidth: 640, font: "13px/1.6 system-ui, sans-serif" },
			tabTitle: { margin: 0, fontSize: 15 },
			card: { display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(128,128,128,0.28)" },
			cardTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
			row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.18)" },
			rowKey: { opacity: 0.7 },
			actions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
			actionBtn: { border: 0, borderRadius: 6, padding: "6px 14px", font: "inherit", cursor: "pointer" },
			error: { color: "#ff6b6b", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
			okText: { color: "#2ecc71", fontWeight: 600 },
			warnText: { color: "#f39c12", fontWeight: 600 },
			switchRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.18)" },
			switchLabel: { display: "flex", flexDirection: "column", gap: 2 },
			switchHint: { opacity: 0.65, fontSize: 12 },
			checkbox: { width: 18, height: 18, cursor: "pointer", accentColor: "#4c8dff" },
			sectionBlock: { display: "flex", flexDirection: "column", gap: 4, padding: "8px 0 4px" },
			sectionTitle: { fontWeight: 600, opacity: 0.85 },
			item: { overflowWrap: "anywhere" },
			itemBreaking: { color: "#ffd54f", overflowWrap: "anywhere" },
			link: { color: "#4c8dff", textDecoration: "none" }
		};

		function createStore() {
			let state = {
				phase: "idle",
				dsh: null, plugin: null, settings: null,
				dshError: null, settingsError: null,
				checkedAt: null, errorKind: null, message: null,
				expanded: false, bannerVisible: true, dismissedLatest: null,
				updatePhase: "idle", updateMessage: null, updateResult: null
			};
			const listeners = new Set();
			return {
				getState: () => state,
				set(patch) {
					state = Object.assign({}, state, patch);
					listeners.forEach((fn) => fn(state));
				},
				setIf(expectedPhase, patch) {
					if (state.phase === expectedPhase) this.set(patch);
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => listeners.delete(fn);
				}
			};
		}

		async function apiCall(path, method, body) {
			const options = { method: method || "GET", headers: { "Accept": "application/json" } };
			if (body !== undefined) {
				options.headers["Content-Type"] = "application/json";
				options.body = JSON.stringify(body);
			}
			const res = await fetch(path, options);
			let data = null;
			try { data = await res.json(); } catch (e) { /* ignore */ }
			return data;
		}

		let sharedStore = null;
		function getStore() {
			if (!sharedStore) sharedStore = createStore();
			return sharedStore;
		}
		let autoChecked = false;

		function apply(ctx) {
			const timer = ctx.get("timer");
			const store = getStore();
			const locale = ctx.get("locale");

			// 每次插件挂载(宿主重启 / 插件热重载)都清空上一次的检查结果:
			// store 是模块级单例,不清空会让设置页在新一轮检查完成前显示旧版本的改动描述。
			store.set({
				phase: "idle",
				dsh: null,
				plugin: null,
				checkedAt: null,
				errorKind: null,
				message: null,
				dshError: null,
				settingsError: null,
				expanded: false,
				dismissedLatest: null,
				updatePhase: "idle",
				updateMessage: null,
				updateResult: null
			});

			// 注册双语字典并绑定翻译;locale 服务缺失时回退内置中文
			let translate = fallbackTranslate;
			if (locale) {
				ctx.effect(() => locale.register(NS, "zh", DICT.zh), "dsh-update-check: zh dictionary");
				ctx.effect(() => locale.register(NS, "en", DICT.en), "dsh-update-check: en dictionary");
				translate = locale.bind(NS);
			}
			function t(key, params) {
				return translate(key, params);
			}
			// 语言切换时强制重渲染
			function useLocaleTick() {
				const [, setTick] = react.useState(0);
				react.useEffect(() => {
					if (!locale) return undefined;
					return locale.subscribe(() => setTick((v) => v + 1));
				}, []);
			}

			async function doCheck(options) {
				const opts = options || {};
				const source = opts.source || "auto";
				const wantDsh = opts.dsh !== false;
				const wantPlugin = opts.plugin !== false;
				store.set({ phase: "checking", errorKind: null, message: null, bannerVisible: source !== "manual" });
				try {
					const url = API_CHECK + "?dsh=" + (wantDsh ? "1" : "0") + "&plugin=" + (wantPlugin ? "1" : "0");
					const res = await apiCall(url, "GET");
					if (!res || typeof res !== "object" || res.ok !== true) {
						store.set({
							phase: "error",
							errorKind: (res && res.error) || "network",
							message: (res && res.message) || null,
							settings: (res && res.settings) || null
						});
						return;
					}
					const hasUpdate = !!(res.dsh && res.dsh.updateAvailable) || !!(res.plugin && res.plugin.updateAvailable);
					store.set({
						phase: hasUpdate ? "update" : "up-to-date",
						dsh: res.dsh || null,
						plugin: res.plugin || null,
						settings: res.settings || null,
						dshError: res.dshError || null,
						settingsError: res.settingsError || null,
						checkedAt: res.checkedAt || Date.now(),
						expanded: false
					});
				} catch (e) {
					store.set({ phase: "error", errorKind: "network", message: e && e.message ? String(e.message) : "unknown" });
				}
			}

			async function saveSettings(patch) {
				try {
					const res = await apiCall(API_SETTINGS, "POST", patch);
					if (res && res.ok && res.settings) store.set({ settings: res.settings, settingsError: null });
					else store.set({ settingsError: (res && res.error) || "settings-write-failed" });
				} catch (e) {
					store.set({ settingsError: e && e.message ? String(e.message) : "settings-write-failed" });
				}
			}

			// 失败原因压成一行限长文本,避免把堆栈倒进界面
			const shortError = (value) => String(value || "").split("\n")[0].slice(0, 200);

			// 插件自身热更新:只由用户点击触发(绝不静默自动更新);
			// 宿主侧先落 .stage 校验、再原子替换、失败自动回滚,这里只呈现结果。
			async function doSelfUpdate() {
				store.set({ updatePhase: "running", updateMessage: null, updateResult: null });
				try {
					const res = await apiCall(API_SELF_UPDATE, "POST", { action: "update" });
					if (!res || res.ok !== true) {
						store.set({
							updatePhase: "error",
							updateMessage: shortError((res && (res.message || res.error)) || "self-update-failed")
						});
						return;
					}
					if (res.updateAvailable === false || res.noop === true) {
						store.set({ updatePhase: "done", updateResult: { from: res.from, to: res.to, restartRequired: false, noop: true } });
						await doCheck({ dsh: true, plugin: true, source: "manual" });
						return;
					}
					store.set({ updatePhase: "done", updateResult: res, updateMessage: null });
					await doCheck({ dsh: true, plugin: true, source: "manual" });
				} catch (e) {
					store.set({ updatePhase: "error", updateMessage: shortError(e && e.message ? String(e.message) : "self-update-failed") });
				}
			}

			function scheduleAutoCheck() {
				if (autoChecked) return;
				autoChecked = true;
				const run = async () => {
					let settings = null;
					try {
						const res = await apiCall(API_SETTINGS, "GET");
						settings = res && res.settings ? res.settings : null;
						if (settings) store.set({ settings });
					} catch (e) { /* 设置读取失败时按默认(都开)处理 */ }
					const wantDsh = !settings || settings.checkOnStartup !== false;
					const wantPlugin = !settings || settings.checkPluginOnStartup !== false;
					if (!wantDsh && !wantPlugin) return;
					await doCheck({ dsh: wantDsh, plugin: wantPlugin, source: "auto" });
				};
				if (timer) timer.timeout(() => { run().catch(() => {}); }, 3000);
				else setTimeout(() => { run().catch(() => {}); }, 3000);
			}
			scheduleAutoCheck();
			try {
				ctx.on("connection/reset", () => scheduleAutoCheck());
			} catch (e) { /* event seat may differ across versions */ }

			function renderSections(dsh, limit) {
				const sections = (dsh && dsh.sections) || [];
				if (sections.length === 0) {
					return dsh && dsh.notesError
						? react.createElement("div", { style: STYLE.dim }, t("section.notesError", { error: dsh.notesError }))
						: null;
				}
				return sections.map((section) => {
					const items = limit ? section.items.slice(0, limit) : section.items;
					const hidden = section.items.length - items.length;
					const title = t("section." + section.key);
					return react.createElement("div", { style: STYLE.sectionBlock, key: section.key },
						react.createElement("div", { style: STYLE.sectionTitle }, title + "（" + section.items.length + "）"),
						react.createElement("ul", { style: STYLE.list },
							items.map((item, index) => react.createElement("li", {
								key: index,
								style: item.breaking ? STYLE.itemBreaking : STYLE.item
							}, (item.breaking ? "⚠️ " : "") + item.text))
						),
						hidden > 0 ? react.createElement("div", { style: STYLE.dim }, t("section.more", { count: hidden })) : null
					);
				});
			}

			function renderSignals(dsh) {
				const signals = (dsh && dsh.signals) || [];
				if (signals.length === 0) return null;
				return signals.map((s, index) => react.createElement("div", { style: STYLE.signalRow, key: index },
					react.createElement("span", { style: STYLE.signalKeyword }, t("signal.hit", {
						level: t(s.level === "strong" ? "signal.strong" : "signal.weak"),
						keyword: s.keyword
					})),
					react.createElement("span", { style: STYLE.signalContext }, s.item)
				));
			}

			function Banner() {
				useLocaleTick();
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				react.useEffect(() => {
					if (!state.bannerVisible || (state.phase !== "checking" && state.phase !== "up-to-date")) return;
					const delay = state.phase === "checking" ? 4000 : 2500;
					const dispose = timer ? timer.timeout(() => store.setIf(state.phase, { phase: "idle" }), delay) : null;
					if (!dispose) {
						const timeoutId = setTimeout(() => store.setIf(state.phase, { phase: "idle" }), delay);
						return () => clearTimeout(timeoutId);
					}
					return dispose;
				}, [state.phase, state.bannerVisible]);
				if (!state.bannerVisible || state.phase === "idle") return null;

				const dsh = state.dsh;
				const plugin = state.plugin;
				const updateKey = (dsh && dsh.latest ? "dsh:" + dsh.latest : "") + (plugin && plugin.updateAvailable && plugin.latest ? "|plugin:" + plugin.latest : "");
				if (state.phase === "update" && state.dismissedLatest && state.dismissedLatest === updateKey) return null;

				const warning = state.phase === "update" && !!(dsh && dsh.breaking);
				const verbose = !!(state.settings && state.settings.verboseBanner);
				const expanded = state.expanded || verbose;
				let title = "";
				let buttons = [];
				if (state.phase === "checking") {
					title = t("banner.checking");
				} else if (state.phase === "up-to-date") {
					title = dsh && dsh.latest
						? t("banner.upToDate", { version: dsh.latest })
						: t("banner.upToDateBare");
				} else if (state.phase === "update") {
					const items = [];
					if (dsh && dsh.updateAvailable) items.push(t("banner.dshItem", { from: dsh.current || "?", to: dsh.latest || "?" }));
					if (plugin && plugin.updateAvailable) items.push(t("banner.pluginItem", { from: plugin.current || "?", to: plugin.latest || "?" }));
					title = t(warning ? "banner.updateBreaking" : "banner.update", { items: items.join("；") });
					buttons = [
						{ label: t(expanded ? "banner.collapse" : "banner.details"), primary: true, onClick: () => store.set({ expanded: !expanded }) },
						{ label: t("banner.later"), primary: false, onClick: () => store.set({ phase: "idle", dismissedLatest: updateKey }) }
					];
				} else if (state.phase === "error") {
					title = t(state.errorKind === "no-release"
						? "banner.noRelease"
						: (state.errorKind === "rate-limit" ? "banner.rateLimit" : "banner.networkError"));
					buttons = [
						{ label: t("banner.retry"), primary: true, onClick: () => { doCheck({ source: "banner" }).catch(() => {}); } },
						{ label: t("banner.close"), primary: false, onClick: () => store.set({ phase: "idle" }) }
					];
				}

				const showDetails = state.phase === "update" && expanded;
				return react.createElement("div", { style: warning ? STYLE.bannerWarning : STYLE.banner, role: "alert" },
					react.createElement("div", { style: STYLE.text }, title),
					showDetails && dsh ? react.createElement("div", null,
						dsh.breaking ? react.createElement("div", { style: STYLE.warningText }, t("banner.breakingHint")) : null,
						renderSignals(dsh),
						renderSections(dsh, 3)
					) : null,
					showDetails && plugin && plugin.updateAvailable ? react.createElement("div", { style: STYLE.dim },
						t("banner.pluginHint", { from: plugin.current || "?", to: plugin.latest || "?" })
					) : null,
					react.createElement("div", { style: STYLE.btnRow },
						buttons.map((b) => react.createElement("button", {
							key: b.label,
							style: b.primary ? STYLE.btnPrimary : STYLE.btnGhost,
							onClick: b.onClick
						}, b.label))
					)
				);
			}

			function SwitchRow(props) {
				return react.createElement("div", { style: STYLE.switchRow },
					react.createElement("span", { style: STYLE.switchLabel },
						react.createElement("span", null, props.label),
						props.hint ? react.createElement("span", { style: STYLE.switchHint }, props.hint) : null
					),
					react.createElement("input", {
						type: "checkbox",
						style: STYLE.checkbox,
						checked: !!props.checked,
						onChange: (e) => props.onChange(!!e.target.checked)
					})
				);
			}

			function UpdaterTab() {
				useLocaleTick();
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				const dsh = state.dsh;
				const plugin = state.plugin;
				const settings = state.settings || { checkOnStartup: true, checkPluginOnStartup: true, verboseBanner: false };
				const busy = state.phase === "checking";
				const phaseLabel = {
					idle: t("status.idle"),
					checking: t("status.checking"),
					"up-to-date": t("status.upToDate"),
					update: t("status.update"),
					error: t("status.error")
				}[state.phase] || state.phase;
				const fmtTime = (value) => value ? new Date(value).toLocaleString() : t("value.dash");
				const unknown = t("value.unknown");
				// 本机版本来源(Diagnostics):模块解析 / npm 全局探测 —— 版本读错时一眼看出读的是哪份安装
				const sourceKey = (s) => s === "module-resolution" ? "source.module" : (s === "npm-global" ? "source.npm" : "source.unknown");

				const rows = [
					[t("row.currentDsh"), (dsh && dsh.current) || unknown],
					[t("row.latestDsh"), (dsh && dsh.latest) || t("value.dash")],
					[t("row.publishedAt"), dsh && dsh.publishedAt ? fmtTime(dsh.publishedAt) : t("value.dash")],
					[t("row.lastCheck"), fmtTime(state.checkedAt)],
					[t("row.status"), phaseLabel]
				];
				const pluginRows = [
					[t("row.currentPlugin"), (plugin && plugin.current) || unknown],
					[t("row.latestPlugin"), (plugin && plugin.latest) || (plugin && plugin.error ? t("value.unavailable") : t("value.dash"))],
					[t("row.status"), plugin
						? (plugin.updateAvailable ? t("plugin.statusUpdate") : t("plugin.statusLatest"))
						: t("plugin.statusUnchecked")]
				];

				return react.createElement("div", { style: STYLE.tab },
					react.createElement("h3", { style: STYLE.tabTitle }, t("page.title")),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, t("card.dsh")),
						react.createElement("div", null,
							rows.map((r) => react.createElement("div", { style: STYLE.row, key: r[0] },
								react.createElement("span", { style: STYLE.rowKey }, r[0]),
								react.createElement("span", null, r[1])
							))
						),
						// 诊断行:本机版本是哪条渠道读出来的(版本读错时一眼定位)
						dsh && dsh.current
							? react.createElement("div", { style: STYLE.dim },
								t("source.line", {
									source: t(sourceKey(dsh.source)),
									path: dsh.sourcePath ? "(" + dsh.sourcePath + ")" : ""
								}))
							: null,
						react.createElement("div", { style: STYLE.actions },
							react.createElement("button", {
								style: Object.assign({}, STYLE.actionBtn, STYLE.btnPrimary),
								disabled: busy,
								onClick: () => { doCheck({ dsh: true, plugin: true, source: "manual" }).catch(() => {}); }
							}, t("btn.checkNow")),
							dsh && dsh.updateAvailable
								? react.createElement("span", { style: dsh.breaking ? STYLE.warnText : STYLE.okText },
									t(dsh.breaking ? "badge.breakingUpdate" : "badge.update"))
								: null,
							dsh && dsh.updateAvailable && dsh.releaseUrl
								? react.createElement("a", { style: STYLE.link, href: dsh.releaseUrl, target: "_blank", rel: "noreferrer" }, t("btn.releaseNotes"))
								: null
						),
						// 仅在「确实有更新」时展示改动详情;已是最新时不残留上一版描述
						dsh && dsh.updateAvailable && dsh.signals && dsh.signals.length > 0
							? react.createElement("div", null,
								react.createElement("div", { style: STYLE.warningText }, t("section.breakingFull")),
								renderSignals(dsh)
							)
							: null,
						dsh && dsh.updateAvailable && dsh.sections && dsh.sections.length > 0
							? react.createElement("div", null,
								react.createElement("div", { style: STYLE.sectionTitle }, t("section.changes")),
								renderSections(dsh, 0)
							)
							: (dsh && dsh.updateAvailable ? react.createElement("div", { style: STYLE.dim }, t("section.none")) : null),
						state.dshError
							? react.createElement("div", { style: STYLE.error },
								state.dshError === "rate-limit"
									? t("error.upstreamRateLimit")
									: t("error.upstreamFailed", { error: state.dshError }))
							: null
					),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, t("card.plugin")),
						react.createElement("div", null,
							pluginRows.map((r) => react.createElement("div", { style: STYLE.row, key: r[0] },
								react.createElement("span", { style: STYLE.rowKey }, r[0]),
								react.createElement("span", null, r[1])
							))
						),
						plugin && plugin.repoUrl
							? react.createElement("div", null,
								react.createElement("a", { style: STYLE.link, href: plugin.repoUrl, target: "_blank", rel: "noreferrer" }, t("plugin.repo"))
							)
							: null,
						// 热更新入口:仅在有新版本时出现,且只由点击触发
						plugin && plugin.updateAvailable
							? react.createElement("div", { style: STYLE.actions },
								react.createElement("button", {
									style: Object.assign({}, STYLE.actionBtn, STYLE.btnPrimary),
									disabled: state.updatePhase === "running",
									onClick: () => { doSelfUpdate().catch(() => {}); }
								}, t(state.updatePhase === "running" ? "btn.updating" : "btn.hotUpdate")),
								react.createElement("span", { style: STYLE.dim }, t("plugin.hotHint"))
							)
							: null,
						state.updatePhase === "done" && state.updateResult
							? react.createElement("div", { style: STYLE.okText },
								state.updateResult.noop
									? t("plugin.statusLatest")
									: t(state.updateResult.restartRequired ? "plugin.updatedRestart" : "plugin.updatedHot", {
										from: state.updateResult.from || "",
										to: state.updateResult.to || ""
									})
							)
							: null,
						state.updatePhase === "error"
							? react.createElement("div", { style: STYLE.error }, t("plugin.updateFailed", { error: state.updateMessage || "" }))
							: null
					),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, t("card.settings")),
						react.createElement(SwitchRow, {
							label: t("switch.checkDsh"),
							hint: t("switch.checkDshHint"),
							checked: settings.checkOnStartup,
							onChange: (value) => { saveSettings({ checkOnStartup: value }).catch(() => {}); }
						}),
						react.createElement(SwitchRow, {
							label: t("switch.checkPlugin"),
							hint: t("switch.checkPluginHint"),
							checked: settings.checkPluginOnStartup,
							onChange: (value) => { saveSettings({ checkPluginOnStartup: value }).catch(() => {}); }
						}),
						react.createElement(SwitchRow, {
							label: t("switch.verbose"),
							hint: t("switch.verboseHint"),
							checked: settings.verboseBanner,
							onChange: (value) => { saveSettings({ verboseBanner: value }).catch(() => {}); }
						}),
						state.settingsError
							? react.createElement("div", { style: STYLE.error }, t("error.settingsSave", { error: state.settingsError }))
							: null
					),

					state.phase === "error"
						? react.createElement("div", { style: STYLE.error }, t("error.checkFailed", { message: state.message || "" }))
						: null
				);
			}

			if (ctx.get("slots")) {
				ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
					{ name: "shell.overlay", id: "updcheck.banner" },
					() => react.createElement(Banner)
				)));
				ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register(
					{ name: "settings.section", id: "upd-check", order: 9999, label: () => t("page.title") },
					() => react.createElement(UpdaterTab)
				)));
			}
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
