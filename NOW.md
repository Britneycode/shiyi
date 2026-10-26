# NOW — 当前进度与焦点

> 接续开发前先读本文件。只记当前迭代的活信息，过期细节归档到 history/ 后从这里删除。

## 当前迭代

**市场更新通道**：拾遗已挂上一份自托管市场索引（`market/index.v2.json`），宿主能提示更新、确认后就地覆盖安装，应用代码零改动。`v0.1.2` 已发布（release `v0.1.2`，资产 `shiyi-v0.1.2.zip`），代码侧修复全部落地，`node --test tests/*.test.js` → **148/148 pass**，宿主 `validate-app.mjs --archive` → **0 error**。剩下的是在真实宿主里把旧的本地 zip 安装换成市场源安装，确认面板不再 500/403，之后发新版本就能在市场页点更新覆盖。

## 已完成

- Step 1：P1 + 存储层（settings/threads/repo/exclusions）46/46
- Step 2：P2+P3+P4（extract/reconcile/recall/tools-host）116/116
- Step 3：P5+P6+P7（proactive engine/gate/banner/handoff）135/135
- Step 4：P8+P9（routes/ui.js 35 端点 + ui/panel.* + README/CHANGELOG）135/135
- 宿主适配修复：wire.js 的 createAgentPolicy 签名对齐；index.js 不再手动注册路由（宿主自动扫描 routes/）。冒烟 apply/boot 通过。
- 测试时钟修复：repo 增可选 clock 注入，step3 冻结时钟后 staleDropped 误判消除；交付包 shiyi-v0.1.0.zip 已重打（含全部修复）。
- 安装失败根因定位并修复：原交付包由 `Compress-Archive` 打出，条目名用 `\` 分隔，宿主 `yauzl`（`strictFileNames:true`）判非法 → `INSTALL_ARCHIVE_INVALID`。改用 `tools/pack.ps1`（.NET ZipArchive，条目名用 `/`）重打，宿主校验器复验通过；release v0.1.0 资产已替换。
- 宿主 manifest 校验四连修复：卡片图标移入 `ui/assets/`（宿主相对 `ui/` 解析）、两张卡 route 同用 `/panel.html`（宿主不接受 query，小窗按视口宽度 ≤640px 判定）、加 `minAppVersion:"0.1020.0"`。宿主 `validate-app.mjs --archive` → **0 error**。
- 路由契约修复（v0.1.1）：`routes/ui.js` 原按 Express 形状写（`req`/`res` + `res.json`），宿主是 Hono（handler 只收一个 context，响应走 `c.json`），真机上 35 个端点全 500（`res.json is not a function`）。改为在 `h()` 包装里把 Hono context 归一成 `{params,query,body}`，35 个处理体不动。
- 路由层测试（v0.1.1）：新增 `tests/routes.test.js`（13 例，含全端点扫描），148/148。
- 前端会话凭证（v0.1.2）：宿主把 surface 会话放在 iframe URL 的 `appSurfaceSession` 参数里，原代码只认 `hana-surface-session`/`session`，面板拿不到凭证。已按宿主 APPS.md「鉴权两通道」修正。
- 打包包名跟随 manifest 版本（v0.1.1），改版本后不必手改文件名。
- 发布：v0.1.0 / v0.1.1 / v0.1.2 三个 release。**v0.1.1 的包缺前端会话修正，可用包是 v0.1.2。**
- 市场索引与更新通道：宿主自带「提示更新 → 一次确认 → 就地覆盖安装（失败把旧目录搬回来）」，应用侧不自建检查器（生态里 `shiguangji-app` 已删掉自建检查器，`biaoqingbao-app` 只给下载链接、不装）。拾遗改为挂在市场索引上：`tools/market-index.mjs` 生成 `market/app-shiyi-<版本>.entry.json` 与 `market/index.v2.json`，用宿主官方 `extension-index-build.mjs` 交叉校验，`items` 完全一致；已发布资产的 size/sha256 与索引声明逐字节一致。约束：**只有从市场源安装的记录才有更新通道**，本地 zip 装的调 update 会报 `EXTENSION_UPDATE_SOURCE_UNSUPPORTED`。

## 停留位置

- 代码全部落地；最后一处改动是 `ui/panel.js` 的 surface 会话参数名，其次是 `tools/market-index.mjs`（新增，不进安装包）。
- 真实宿主里仍装的是旧包 → 面板在宿主中的实际表现未验证；且它是本地 zip 安装，在换成市场源安装之前没有更新通道。
- 前端 `panel.js` 最后一处行为：「稍后再说」「交给 Hana…」为本地降级态（无对应后端端点），见 CHANGELOG §已知限制。

## Next Steps

- [ ] 用户在真实宿主加自定义源（地址见 README §从宿主市场安装）并装/替换为市场源的 v0.1.2，确认面板加载（不再 500/403）；之后发 v0.1.3 时市场页应出现「可更新」，点更新即覆盖安装 —— 这是更新通道的端到端验收。
- [ ] 宿主 `--smoke` UI 检查（本机无 Electron，未跑）。
- [ ] 若宿主可用，补全局 snooze 与 handoff 建卡端点（当前为前端降级）。

## 阻塞点

- 覆盖 `~/.hanako/apps/shiyi/` 下的旧包、删除已发布的 release 资产，都需用户对该目标显式授权（自动化被拒），故走加法发布 v0.1.2，v0.1.1 资产保留但作废。
