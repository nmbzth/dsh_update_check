// dsh-update-check — 静态 Client 半区(浏览器 bundle,ModuleLoader 格式)
// 仅提供更新检测与提示(不提供安装):
//   - RPC 走同源 fetch → /upd-check/api/check(宿主 webServer 路由)
//   - 样式用 React 内联 style(无 styles.insert builtin)
window.__ModuleLoader__.load({
	id: "dsh-update-check",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const API_CHECK = "/upd-check/api/check";

		const STYLE = {
			banner: {
				position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
				zIndex: 10000, display: "flex", flexDirection: "column", gap: 8,
				alignItems: "center", maxWidth: "min(640px, calc(100vw - 32px))",
				padding: "10px 14px", borderRadius: 10,
				background: "rgba(24,26,32,0.92)", color: "#fff",
				font: "13px/1.5 system-ui, sans-serif",
				boxShadow: "0 6px 24px rgba(0,0,0,0.35)", pointerEvents: "auto"
			},
			bannerWarning: {
				position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
				zIndex: 10000, display: "flex", flexDirection: "column", gap: 8,
				alignItems: "center", maxWidth: "min(640px, calc(100vw - 32px))",
				padding: "10px 14px", borderRadius: 10,
				background: "rgba(122,92,0,0.96)", border: "1px solid #ffc107", color: "#ffe082",
				font: "13px/1.5 system-ui, sans-serif",
				boxShadow: "0 6px 24px rgba(0,0,0,0.35)", pointerEvents: "auto"
			},
			text: { minWidth: 0, overflowWrap: "anywhere" },
			warningText: { color: "#ffc107", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
			signalRow: { display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px", borderRadius: 6, background: "rgba(255,193,7,0.12)", width: "100%" },
			signalKeyword: { color: "#ffd54f", fontWeight: 600 },
			signalContext: { color: "#ffe082", overflowWrap: "anywhere" },
			btnRow: { display: "flex", gap: 10 },
			btnPrimary: { border: 0, borderRadius: 6, padding: "4px 10px", font: "inherit", cursor: "pointer", background: "#4c8dff", color: "#fff" },
			btnGhost: { border: 0, borderRadius: 6, padding: "4px 10px", font: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.16)", color: "#fff" },
			tab: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, font: "13px/1.6 system-ui, sans-serif" },
			tabTitle: { margin: 0, fontSize: 15 },
			tabBody: { display: "flex", flexDirection: "column", borderTop: "1px solid rgba(128,128,128,0.3)" },
			row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.2)" },
			rowKey: { opacity: 0.7 },
			actions: { display: "flex", gap: 10 },
			actionBtn: { border: 0, borderRadius: 6, padding: "6px 14px", font: "inherit", cursor: "pointer" },
			error: { color: "#ff6b6b", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
		};

		function createStore() {
			let state = {
				phase: "idle", current: null, latest: null, updateAvailable: false,
				breaking: false, breakingReason: null, breakingSignals: [], prerelease: false,
				localUnreadable: false, checkedAt: null, errorKind: null, message: null,
				dismissedLatest: null, bannerVisible: true
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

		async function apiCall(path, method) {
			const res = await fetch(path, { method, headers: { "Accept": "application/json" } });
			let data = null;
			try { data = await res.json(); } catch (e) { /* ignore */ }
			return data;
		}

		// 模块级单例:client bundle 可能被宿主多次 apply(连接重置/热重载等),
		// 若每个 apply 各建一个 store,会注册出多个互不同步的横幅实例。
		let sharedStore = null;
		function getStore() {
			if (!sharedStore) sharedStore = createStore();
			return sharedStore;
		}
		// 同一页面生命周期只自动检查一次(跨 apply 共享,避免连接重置后重复弹窗)
		let autoChecked = false;

		function apply(ctx) {
			const timer = ctx.get("timer");
			const store = getStore();

			// source: "auto"(打开页面/连接重置自动检查)、"manual"(设置页立即检查)、"banner"(横幅重试)
			// 设置页手动检查只更新设置页状态,不弹顶部横幅
			async function doCheck(source) {
				store.set({ phase: "checking", errorKind: null, message: null, bannerVisible: source !== "manual" });
				try {
					const res = await apiCall(API_CHECK, "GET");
					if (!res || typeof res !== "object" || res.ok !== true) {
						store.set({ phase: "error", errorKind: (res && res.error) || "network", message: (res && res.message) || null });
						return;
					}
					if (res.updateAvailable) {
						store.set({
							phase: "update", current: res.current, latest: res.latest,
							breaking: !!res.breaking, breakingReason: res.breakingReason || null,
							breakingSignals: (res.breakingSignals) || [],
							prerelease: !!res.prerelease, localUnreadable: !!res.localUnreadable, checkedAt: res.checkedAt
						});
					} else {
						store.set({ phase: "up-to-date", current: res.current, latest: res.latest, localUnreadable: !!res.localUnreadable, checkedAt: res.checkedAt });
					}
				} catch (e) {
					store.set({ phase: "error", errorKind: "network", message: e && e.message ? String(e.message) : "unknown" });
				}
			}

			function scheduleAutoCheck() {
				if (autoChecked) return;
				autoChecked = true;
				if (timer) timer.timeout(() => { doCheck("auto").catch(() => {}); }, 3000);
				else setTimeout(() => { doCheck("auto").catch(() => {}); }, 3000);
			}
			scheduleAutoCheck();
			try {
				ctx.on("connection/reset", () => scheduleAutoCheck());
			} catch (e) { /* event seat may differ across versions */ }

			function Banner() {
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				react.useEffect(() => {
					// 横幅隐藏时(设置页手动检查)不调度自动隐藏,避免把设置页状态提前切回 idle
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
				// 用户点过「稍后」的同一版本更新,不再重复弹横幅
				if (state.phase === "update" && state.dismissedLatest && state.latest === state.dismissedLatest) return null;

				const warning = state.phase === "update" && state.breaking;
				let title = "";
				let buttons = [];
				let detail = null;
				if (state.phase === "checking") {
					title = "正在检查更新…";
				} else if (state.phase === "up-to-date") {
					title = state.localUnreadable
						? "最新版本 " + (state.latest || "?") + "(无法读取本地版本)"
						: "已是最新版本 " + (state.latest || "?");
				} else if (state.phase === "update") {
					if (state.breaking) {
						title = (state.breakingReason === "release-notes-weak" ? "⚠️ 检测到可能破坏性更新:" : "⚠️ 检测到破坏性更新:")
							+ (state.current || "?") + " → " + (state.latest || "?") + (state.prerelease ? "(预发布版)" : "");
						buttons = [
							{ label: "了解风险", primary: true, onClick: () => store.set({ phase: "confirm-breaking" }) },
							{ label: "稍后", primary: false, onClick: () => store.set({ phase: "idle", dismissedLatest: state.latest }) }
						];
					} else {
						title = "发现新版本:" + (state.current || "?") + " → " + (state.latest || "?") + (state.prerelease ? "(预发布版)" : "");
						buttons = [
							{ label: "稍后", primary: false, onClick: () => store.set({ phase: "idle", dismissedLatest: state.latest }) }
						];
					}
				} else if (state.phase === "confirm-breaking") {
					title = "⚠️ 更新风险提示:" + (state.current || "?") + " → " + (state.latest || "?");
					if (state.breakingReason === "version") {
						detail = "版本跨度较大(主版本/次要版本变更)。DSH 官方公告提示未来版本可能不兼容现有插件;更新前请确认插件兼容性。";
					} else if (state.breakingReason === "release-notes") {
						detail = "官方发布说明包含破坏性变更提示。更新前请先阅读发布说明,并确认插件兼容性。";
					} else {
						detail = "官方发布说明包含以下疑似破坏性/不兼容相关描述,请核实是否影响插件兼容性:";
					}
					buttons = [
						{ label: "知道了", primary: false, onClick: () => store.set({ phase: "update" }) }
					];
				} else if (state.phase === "error") {
					title = state.errorKind === "no-release"
						? "GitHub 上未找到版本信息"
						: "无法连接 GitHub,检查失败(网络不佳或 GitHub 不可达)";
					buttons = [
						{ label: "重试", primary: true, onClick: () => { doCheck("banner").catch(() => {}); } },
						{ label: "关闭", primary: false, onClick: () => store.set({ phase: "idle" }) }
					];
				}

				const sig = state.breakingSignals || [];
				const btnStyle = (b) => b.primary ? (warning ? STYLE.btnPrimary : STYLE.btnPrimary) : STYLE.btnGhost;
				return react.createElement("div", { style: warning ? STYLE.bannerWarning : STYLE.banner, role: "alert" },
					react.createElement("span", { style: STYLE.text }, title),
					detail ? react.createElement("div", { style: STYLE.warningText }, detail) : null,
					sig.length > 0 ? sig.map((s) => react.createElement("div", { style: STYLE.signalRow, key: (s.keyword || "") + (s.context || "") },
						react.createElement("span", { style: STYLE.signalKeyword }, "[" + (s.level === "strong" ? "强信号" : "弱信号") + "] 命中关键词: " + s.keyword),
						react.createElement("span", { style: STYLE.signalContext }, "…" + (s.context || "") + "…")
					)) : null,
					react.createElement("div", { style: STYLE.btnRow },
						buttons.map((b) => react.createElement("button", {
							key: b.label,
							style: btnStyle(b),
							onClick: b.onClick
						}, b.label))
					)
				);
			}

			function UpdaterTab() {
				const [state, setState] = react.useState(store.getState());
				react.useEffect(() => store.subscribe(setState), []);
				const busy = state.phase === "checking";
				const phaseLabel = {
					idle: "未检查", checking: "检查中…", "up-to-date": "已是最新",
					update: state.breaking ? "发现更新(破坏性)" : "发现更新",
					"confirm-breaking": "查看风险提示", error: "检查失败"
				}[state.phase] || state.phase;
				const rows = [
					["当前版本", state.current || "未知"],
					["最新版本", state.latest || "—"],
					["上次检查", state.checkedAt ? new Date(state.checkedAt).toLocaleString() : "—"],
					["状态", phaseLabel]
				];
				return react.createElement("div", { style: STYLE.tab },
					react.createElement("h3", { style: STYLE.tabTitle }, "↑ 检查更新"),
					react.createElement("div", { style: STYLE.tabBody },
						rows.map((r) => react.createElement("div", { style: STYLE.row, key: r[0] },
							react.createElement("span", { style: STYLE.rowKey }, r[0]),
							react.createElement("span", null, r[1])
						))
					),
					(state.phase === "update" && state.breaking)
						? react.createElement("div", { style: STYLE.warningText },
							"⚠️ 该更新被判定为破坏性变更(" + (state.breakingReason === "version" ? "大版本/次要版本变更" : (state.breakingReason === "release-notes" ? "官方发布说明提示" : "发布说明含疑似不兼容描述,请核实")) + "),更新前请确认插件兼容性。",
						)
						: null,
					react.createElement("div", { style: STYLE.actions },
						react.createElement("button", { style: Object.assign({}, STYLE.actionBtn, STYLE.btnPrimary), disabled: busy, onClick: () => { doCheck("manual").catch(() => {}); } }, "立即检查")
					),
					(state.phase === "error")
						? react.createElement("div", { style: STYLE.error },
							"检查失败:" + (state.message || "")
						)
						: null
				);
			}

			if (ctx.get("slots")) {
				ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
					{ name: "shell.overlay", id: "updcheck.banner" },
					() => react.createElement(Banner)
				)));
				// 独立的顶级设置页(与 通用设置/模型/插件 同级),排在设置区最后;
				// DSH 设置外壳的导航图标由内置 navIcon(id) 映射决定,自定义 id 只显示齿轮,
				// 因此把向上箭头放进入口标签与页面标题,实现「↑ 检查更新」。
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
