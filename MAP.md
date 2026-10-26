# MAP — 拾遗目录映射

```
shiyi/
├── manifest.json            # HanaAgent v2 清单（realization:"page"、siteNavEntry）
├── routes/ui.js             # 34 REST 端点，registerRoutes(app, ctx) 自动扫描
├── lib/
│   ├── settings.js          # settings.json 原子写（tmp→rename + .bak）
│   ├── threads.js           # 会话历史：{seq,role,text,at,clientId?,meta?}
│   ├── handoff.js           # 交接卡：pending→sending→sent|failed|cancelled
│   ├── tools-host.js        # 主对话工具：main 放行；ch_/dm_/外部拒绝
│   ├── memory/
│   │   ├── extract.js       # 提取 prompt（[MM-DD HH:mm]，L3.5 不合并）
│   │   ├── repo.js          # Markdown 真相源 + index.json 缓存
│   │   ├── reconcile.js     # 启动对账
│   │   ├── exclusions.js    # 删除写排除防回填
│   │   └── recall.js        # 情境检索
│   └── proactive/
│       ├── engine.js        # 主动引擎（5min tick、预算、停机补发）
│       ├── gate.js          # 10 道护栏
│       └── banner.js        # 输入框横幅（75s 租约、回执）
├── ui/
│   ├── panel.html           # 面板壳
│   ├── panel.css            # v9 剥离演示样式后生成
│   └── panel.js             # v9 原型改造：接真 API，三栏 / 窄窗小窗
├── tests/
│   ├── helpers.js           # fakeCtx / tmpdir
│   ├── step1.test.js        # P1+存储层 46 用例
│   ├── step2.test.js        # P2+P3+P4 70 用例
│   └── step3.test.js        # P5+P6+P7 19 用例
└── 文档层：PLAN.md / AGENTS.md / PROJECT_INDEX.md / MAP.md / RUNBOOK.md / NOW.md / CHANGELOG.md
```

## 同步边界

- 前端 `BASE` 与后端 `routes/ui.js` 前缀必须一致：`/api/apps/shiyi/routes`。
- 面板会话头 `X-Hana-App-Surface-Session` 前后端共用。
- 事/知字段以 `lib/memory/repo.js` 为准；前端不依赖未存在的展示字段（fuzzyWindow/exactRemindText 已裁决为客户端派生）。
