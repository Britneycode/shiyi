# NOW — 当前进度与焦点

> 接续开发前先读本文件。只记当前迭代的活信息，过期细节归档到 history/ 后从这里删除。

## 当前迭代

**拾遗（shiyi）v1.0.0 已交付**：4 个里程碑全落地，`node --test tests/*.test.js` → **135/135 pass**。

## 已完成

- Step 1：P1 + 存储层（settings/threads/repo/exclusions）46/46
- Step 2：P2+P3+P4（extract/reconcile/recall/tools-host）116/116
- Step 3：P5+P6+P7（proactive engine/gate/banner/handoff）135/135
- Step 4：P8+P9（routes/ui.js 35 端点 + ui/panel.* + README/CHANGELOG）135/135
- 宿主适配修复：wire.js 的 createAgentPolicy 签名对齐；index.js 不再手动注册路由（宿主自动扫描 routes/）。冒烟 apply/boot 通过。
- 测试时钟修复：repo 增可选 clock 注入，step3 冻结时钟后 staleDropped 误判消除；交付包 shiyi-v0.1.0.zip 已重打（含全部修复）。
- 安装失败根因定位并修复：原交付包由 `Compress-Archive` 打出，条目名用 `\` 分隔，宿主 `yauzl`（`strictFileNames:true`）判非法 → `INSTALL_ARCHIVE_INVALID`。改用 `tools/pack.ps1`（.NET ZipArchive，条目名用 `/`）重打，宿主校验器复验通过；release v0.1.0 资产已替换。

## 停留位置

- 全部代码已落地于 `routes/ui.js`、`lib/**`、`ui/panel.*`。
- 前端 `panel.js` 最后一处行为：「稍后再说」「交给 Hana…」为本地降级态（无对应后端端点），见 CHANGELOG §已知限制。

## Next Steps

- [ ] 用户手动安装 shiyi-v0.1.0.zip 后在真实宿主中验证（前端无可自动化测试，验收方式见 PLAN.md §4.14）。
- [ ] 若宿主可用，补全局 snooze 与 handoff 建卡端点（当前为前端降级）。

## 阻塞点

无。
