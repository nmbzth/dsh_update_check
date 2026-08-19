# 安装指引(给 DSH 智能体的任务文件)

本文件用于在**另一台机器**上快速重建并运行「更新检查」插件。把本仓库放入 DSH 工作区后,在对话中让智能体按下面的步骤执行(或直接把「执行指令」整段发给智能体)。

## 执行指令(可直接发送给智能体)

> 请安装并运行工作区里的「更新检查」插件:
>
> 1. 读取本仓库 `src/host.js` 与 `src/client.js` 的完整内容;
> 2. 调用 `cordis_define` 创建新插件:插件 idPrefix 用 `updt`,名称「更新检查」,`code.host` 填入 host.js 的完整内容,`code.client` 填入 client.js 的完整内容;
> 3. 调用 `cordis_run` 激活(首次运行客户端代码可能需要审批,请提示我批准);
> 4. 完成后告诉我结果,并提示我刷新页面验证顶部横幅与 设置 → 插件 →「检查更新」页。

## 智能体自检清单

- [ ] `cordis_define` 成功返回 pluginId 与 packageId;
- [ ] `cordis_run` 进入 `awaiting-approval` 或 `starting`,并最终 `running`(可 `cordis_inspect_self` 确认 Host handlers 含 `check`/`install`,Client 无渲染错误);
- [ ] `slots` 树中 `shell.overlay` 出现 `updcheck.banner`、`settings.plugins.tab` 出现 `check-updates`;
- [ ] 告知用户:刷新页面后 3 秒应看到顶部检查横幅;设置 → 插件 应出现「检查更新」页签。

## 卸载 / 重启说明

- 动态插件**随当前 DSH 进程存活**:重启 DSH 后需要重新执行上述指令(或由部署方把插件固化为宿主 composition 行,实现持久加载);
- 需要临时停用:`cordis_stop`;永久移除:`cordis_undefine`。

## 常见问题

- 首次运行时若提示「无法连接 GitHub」:请先检查本机 hosts 是否有 `github.com` / `api.github.com → 127.0.0.1` 的劫持行(如 Steamcommunity302 写入);插件内置 DNS 直连绕过,多数情况下可直接点「重试」通过。
- 显示「无法读取本地版本」:DSH 非 npm 全局安装(pnpm/git clone 等),远端版本检测不受影响。
