// dsh-update-check — 静态 Client 半区(浏览器 bundle,ModuleLoader 格式)
// 纯提示型:顶部横幅(简略/详细两态)+ 设置区独立页(版本、上游改动、插件自身更新、三个开关)。
window.__ModuleLoader__.load({
	id: "dsh-update-check",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const API_CHECK = "/upd-check/api/check";
		const API_SETTINGS = "/upd-check/api/settings";

		const SECTION_TITLES = {
			features: "新增功能",
			fixes: "问题修复",
			improvements: "体验优化",
			other: "其他变更",
			sdk: "SDK"
		};

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
				expanded: false, bannerVisible: true, dismissedLatest: null
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
						? react.createElement("div", { style: STYLE.dim }, "（未获取到发布说明：" + dsh.notesError + "）")
						: null;
				}
				return sections.map((section) => {
					const items = limit ? section.items.slice(0, limit) : section.items;
					const hidden = section.items.length - items.length;
					return react.createElement("div", { style: STYLE.sectionBlock, key: section.key },
						react.createElement("div", { style: STYLE.sectionTitle }, (SECTION_TITLES[section.key] || section.title || section.key) + "（" + section.items.length + "）"),
						react.createElement("ul", { style: STYLE.list },
							items.map((item, index) => react.createElement("li", {
								key: index,
								style: item.breaking ? STYLE.itemBreaking : STYLE.item
							}, (item.breaking ? "⚠️ " : "") + item.text))
						),
						hidden > 0 ? react.createElement("div", { style: STYLE.dim }, "… 另有 " + hidden + " 条，见设置页") : null
					);
				});
			}

			function renderSignals(dsh) {
				const signals = (dsh && dsh.signals) || [];
				if (signals.length === 0) return null;
				return signals.map((s, index) => react.createElement("div", { style: STYLE.signalRow, key: index },
					react.createElement("span", { style: STYLE.signalKeyword }, "[" + (s.level === "strong" ? "强信号" : "弱信号") + "] 命中关键词：" + s.keyword),
					react.createElement("span", { style: STYLE.signalContext }, s.item)
				));
			}

			function Banner() {
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				react.useEffect(() => {
					if (!state.bannerVisible || (state.phase !== "checking" && state.phase !== "up-to-date")) return;
					const delay = state.phase === "checking" ? 4000 : 2500;
					const dispose = timer ? timer.timeout(() => store.setIf(state.phase, { phase: "idle" }), delay) : null;
					if (!dispose) {
						const t = setTimeout(() => store.setIf(state.phase, { phase: "idle" }), delay);
						return () => clearTimeout(t);
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
					title = "正在检查更新…";
				} else if (state.phase === "up-to-date") {
					title = "已是最新版本" + (dsh && dsh.latest ? "：" + dsh.latest : "");
				} else if (state.phase === "update") {
					const parts = [];
					if (dsh && dsh.updateAvailable) parts.push("DSH " + (dsh.current || "?") + " → " + (dsh.latest || "?"));
					if (plugin && plugin.updateAvailable) parts.push("插件 " + (plugin.current || "?") + " → " + (plugin.latest || "?"));
					title = (warning ? "⚠️ 发现更新（含破坏性变更）：" : "发现更新：") + parts.join("；");
					buttons = [
						{ label: expanded ? "收起" : "详情", primary: true, onClick: () => store.set({ expanded: !expanded }) },
						{ label: "稍后", primary: false, onClick: () => store.set({ phase: "idle", dismissedLatest: updateKey }) }
					];
				} else if (state.phase === "error") {
					title = state.errorKind === "no-release"
						? "GitHub 上未找到版本信息"
						: "无法连接 GitHub，检查失败（网络不佳或 GitHub 不可达）";
					buttons = [
						{ label: "重试", primary: true, onClick: () => { doCheck({ source: "banner" }).catch(() => {}); } },
						{ label: "关闭", primary: false, onClick: () => store.set({ phase: "idle" }) }
					];
				}

				const showDetails = state.phase === "update" && expanded;
				return react.createElement("div", { style: warning ? STYLE.bannerWarning : STYLE.banner, role: "alert" },
					react.createElement("div", { style: STYLE.text }, title),
					showDetails && dsh ? react.createElement("div", null,
						dsh.breaking ? react.createElement("div", { style: STYLE.warningText }, "该版本包含疑似破坏性变更，请确认插件兼容性后再更新：") : null,
						renderSignals(dsh),
						renderSections(dsh, 3)
					) : null,
					showDetails && plugin && plugin.updateAvailable ? react.createElement("div", { style: STYLE.dim },
						"插件自身有新版本：" + (plugin.current || "?") + " → " + (plugin.latest || "?") + "（见设置页）"
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
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				const dsh = state.dsh;
				const plugin = state.plugin;
				const settings = state.settings || { checkOnStartup: true, checkPluginOnStartup: true, verboseBanner: false };
				const busy = state.phase === "checking";
				const phaseLabel = {
					idle: "未检查", checking: "检查中…", "up-to-date": "已是最新", update: "发现更新", error: "检查失败"
				}[state.phase] || state.phase;
				const fmtTime = (value) => value ? new Date(value).toLocaleString() : "—";

				const rows = [
					["当前 DSH 版本", (dsh && dsh.current) || "未知"],
					["最新 DSH 版本", (dsh && dsh.latest) || "—"],
					["发布时间", dsh && dsh.publishedAt ? fmtTime(dsh.publishedAt) : "—"],
					["上次检查", fmtTime(state.checkedAt)],
					["状态", phaseLabel]
				];

				return react.createElement("div", { style: STYLE.tab },
					react.createElement("h3", { style: STYLE.tabTitle }, "↑ 检查更新"),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, "DSH 更新"),
						react.createElement("div", null,
							rows.map((r) => react.createElement("div", { style: STYLE.row, key: r[0] },
								react.createElement("span", { style: STYLE.rowKey }, r[0]),
								react.createElement("span", null, r[1])
							))
						),
						react.createElement("div", { style: STYLE.actions },
							react.createElement("button", {
								style: Object.assign({}, STYLE.actionBtn, STYLE.btnPrimary),
								disabled: busy,
								onClick: () => { doCheck({ dsh: true, plugin: true, source: "manual" }).catch(() => {}); }
							}, "立即检查"),
							dsh && dsh.updateAvailable
								? react.createElement("span", { style: dsh.breaking ? STYLE.warnText : STYLE.okText },
									dsh.breaking ? "发现更新（含破坏性变更）" : "发现新版本")
								: null,
							dsh && dsh.releaseUrl
								? react.createElement("a", { style: STYLE.link, href: dsh.releaseUrl, target: "_blank", rel: "noreferrer" }, "查看发布说明")
								: null
						),
						dsh && dsh.signals && dsh.signals.length > 0
							? react.createElement("div", null,
								react.createElement("div", { style: STYLE.warningText }, "破坏性相关描述（完整）："),
								renderSignals(dsh)
							)
							: null,
						dsh && dsh.sections && dsh.sections.length > 0
							? react.createElement("div", null,
								react.createElement("div", { style: STYLE.sectionTitle }, "本次改动"),
								renderSections(dsh, 0)
							)
							: (dsh ? react.createElement("div", { style: STYLE.dim }, "（无发布说明可展示）") : null),
						state.dshError
							? react.createElement("div", { style: STYLE.error }, "上游检查失败：" + state.dshError)
							: null
					),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, "插件自身更新"),
						react.createElement("div", null,
							[["当前插件版本", (plugin && plugin.current) || "未知"],
							 ["最新插件版本", (plugin && plugin.latest) || (plugin && plugin.error ? "无法获取" : "—")],
							 ["状态", plugin && plugin.updateAvailable ? "有新版本（请手动替换 plugin/ 目录）" : (plugin ? "已是最新" : "未检查")]]
								.map((r) => react.createElement("div", { style: STYLE.row, key: r[0] },
									react.createElement("span", { style: STYLE.rowKey }, r[0]),
									react.createElement("span", null, r[1])
								))
						),
						plugin && plugin.repoUrl
							? react.createElement("div", null,
								react.createElement("a", { style: STYLE.link, href: plugin.repoUrl, target: "_blank", rel: "noreferrer" }, "插件仓库")
							)
							: null
					),

					react.createElement("div", { style: STYLE.card },
						react.createElement("h4", { style: STYLE.cardTitle }, "设置"),
						react.createElement(SwitchRow, {
							label: "每次启动检查 DSH 更新",
							hint: "打开页面时自动检查上游是否有新版本",
							checked: settings.checkOnStartup,
							onChange: (value) => { saveSettings({ checkOnStartup: value }).catch(() => {}); }
						}),
						react.createElement(SwitchRow, {
							label: "每次启动检查插件自身更新",
							hint: "打开页面时自动检查本插件是否有新版本",
							checked: settings.checkPluginOnStartup,
							onChange: (value) => { saveSettings({ checkPluginOnStartup: value }).catch(() => {}); }
						}),
						react.createElement(SwitchRow, {
							label: "顶部窗口显示描述细节",
							hint: "开：横幅直接展示改动细节；关：只显示版本提示，点「详情」展开",
							checked: settings.verboseBanner,
							onChange: (value) => { saveSettings({ verboseBanner: value }).catch(() => {}); }
						}),
						state.settingsError
							? react.createElement("div", { style: STYLE.error }, "设置保存失败：" + state.settingsError)
							: null
					),

					state.phase === "error"
						? react.createElement("div", { style: STYLE.error }, "检查失败：" + (state.message || ""))
						: null
				);
			}

			if (ctx.get("slots")) {
				ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
					{ name: "shell.overlay", id: "updcheck.banner" },
					() => react.createElement(Banner)
				)));
				ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register(
					{ name: "settings.section", id: "upd-check", order: 9999, label: "↑ 检查更新" },
					() => react.createElement(UpdaterTab)
				)));
			}
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
