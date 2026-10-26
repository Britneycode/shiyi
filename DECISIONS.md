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

## D-003 manifest 不写 minAppVersion（2026-10-25）

**背景**：宿主版本存在两套编号——仓库 package.json 恒为 0.450.0（引擎兼容性检查读它），GitHub Releases 标签却是 1.1.x-beta。参考 app 声明的 `minAppVersion: "0.1059.0"` 与两者的对应关系不明。

**决定**：拾遗 manifest 不写 `minAppVersion`。plugin-manager 仅对声明了该字段的项目做门控，缺省直接放行。

**原因**：写了就可能因编号体系对不上被宿主误判 incompatible 而拒绝装载，且我们无法用本地环境验证这个门控行为；不写的唯一代价是失去「版本不足时给出明确报错」，可接受。若日后用户真实遇到不兼容，再凭宿主报错信息决定写什么值。
