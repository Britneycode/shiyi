# DECISIONS — 关键取舍

## D-001 调度索引：index.json，不用 SQLite（2026-10-25）

**背景**：设计阶段定过 Markdown 卡片 + SQLite 双写（正文/调度分离）。二轮源码查证推翻 SQLite。

**决定**：调度索引存 `ctx.dataDir/index.json`，原子写（tmp+rename+备份恢复，照表情包 atomic-store）。双写结构保留，只是索引层换介质。

**原因**：
- 三个参考 app（茶话会/拾光记/表情包）全部用 JSON 文件持久化，无一用 sqlite——无先例背书
- app 跑在宿主 spawn 的 Node 权限沙箱子进程，启动 flag 不受我们控制，`node:sqlite` 可用性无实证
- 卡片量级数百张，JSON 全量读写无性能问题

**升级路径**：卡片破几千且 index.json 读写出现可观测卡顿时再考虑 sqlite，届时先实测沙箱里 `node:sqlite` 能 import。

## D-002 post-assistant 钩子只入队，提取异步跑（2026-10-25）

表情包 v0.1.38 实证：消息「定稿这一刻会话可能还在收尾」，钩子里做慢操作（我们的 LLM 提取要 1-2 次 utility 调用）会拖住回复链路。钩子同步部分只把 `{sessionId, message}` 推进内存队列，提取在队列消费侧跑，失败静默丢（不影响聊天）。

## D-003 manifest 的 minAppVersion：初版不写，v0.1.0 前改为声明下限

**背景**：宿主版本存在两套编号——仓库 package.json 恒为 0.450.0（引擎兼容性检查读它），GitHub Releases 标签却是 1.1.x-beta。参考 app 声明的 `minAppVersion: "0.1059.0"` 与两者的对应关系不明。

**初版决定（2026-10-25）**：不写 `minAppVersion`。plugin-manager 仅对声明了该字段的项目做门控，缺省直接放行；写了就可能因编号体系对不上被误判 incompatible，且无法用本地环境验证门控。

**修订（2026-10-26，v0.1.0 安装前）**：改为 `"minAppVersion": "0.1020.0"`。原因：用了 `pageIcon` 与 `cardForm: "edge-to-edge"`，宿主要求声明该下限。宿主 `validate-app.mjs --archive` → 0 error，原担心的编号误判未出现。判据仍是宿主校验器的报错，不是猜编号。

## D-004 品牌主色切陶土橙（2026-10-27，CDS 第二轮）

**背景**：`docs/CDS-BRIDGE.md` 原决策保留拾遗青石蓝 `#537D96` + 米色纸底；CDS 第二轮审计把品牌色列为主线待裁决项（Q25，推荐 A 或 C）。

**决定**：执行 C——保留米色纸底 `#F8F4ED`，主色连同 `--accent-hover`/`--accent-light` 切 CDS 陶土橙：浅色 `#d97757`、深色 `#cc6b49`。纸张底、衬线标题、字号体系不动。`--sy-k-*` 分类色未跟随，其唯一使用者 `.dot` 已随右栏删除，令牌与规则一并移除。

**原因**：陶土橙与米色底同为暖调，整体感比青石蓝更强；代价是丢掉原青色辨识度。

**回退成本**：改 `--accent*` 三个值即可，无结构耦合。
