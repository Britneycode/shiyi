// 路由层契约测试（补 R25 装配层盲区）。
// 宿主 routes/ 的契约是 Hono：handler 只收一个 context c，响应走 c.json；
// 之前 routes/ui.js 按 Express 形状写（req/res 两参 + res.json），真实宿主里全部 500。
// 这里用假 Hono app + 假 context 固定该契约：任何回到 Express 形状的改动都会红。

import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers.js";
import { wire } from "../lib/wire.js";
import registerRoutes from "../routes/ui.js";

/** 假 Hono app：记录注册的方法 + 路径 + handler。 */
function fakeApp() {
  const routes = new Map();
  const reg = (method) => (path, handler) => { routes.set(`${method} ${path}`, handler); };
  return {
    get: reg("GET"), post: reg("POST"), patch: reg("PATCH"),
    delete: reg("DELETE"), put: reg("PUT"),
    routes,
  };
}

/** 假 Hono context：c.json 出响应，c.req 提供 param / query / json。 */
function fakeC({ method = "GET", params = {}, query = {}, body } = {}) {
  const c = {
    req: {
      method,
      param: () => ({ ...params }),
      query: () => ({ ...query }),
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    },
    json(obj) { c.result = obj; return { status: 200, body: obj }; },
  };
  return c;
}

/** 按具体路径找注册的路由，并抽出路径参数。 */
function matchRoute(app, method, path) {
  for (const [key, handler] of app.routes) {
    const [m, pat] = key.split(" ");
    if (m !== method) continue;
    const ps = pat.split("/"), xs = path.split("/");
    if (ps.length !== xs.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
      else if (ps[i] !== xs[i]) { hit = false; break; }
    }
    if (hit) return { handler, params };
  }
  return null;
}

/** 模拟一次宿主请求：只有 c，没有 req/res。 */
async function call(app, method, path, { query = {}, body } = {}) {
  const m = matchRoute(app, method, path);
  assert.ok(m, `没有匹配到路由：${method} ${path}`);
  const c = fakeC({ method, params: m.params, query, body });
  const res = await m.handler(c);
  return res?.body ?? c.result;
}

function setup() {
  const ctx = fakeCtx();
  const deps = wire(ctx);
  const app = fakeApp();
  registerRoutes(app, ctx);
  return { ctx, deps, app };
}

test("路由按 Hono 契约注册：路径以 /api/ 开头且不含 query", () => {
  const { app } = setup();
  assert.ok(app.routes.size >= 20, `端点数偏少：${app.routes.size}`);
  for (const key of app.routes.keys()) {
    const path = key.split(" ")[1];
    assert.ok(path.startsWith("/api/"), `路径须以 /api/ 开头：${path}`);
    assert.ok(!path.includes("?"), `路径不得含 query：${path}`);
  }
});

test("全部端点在 Hono 契约下都答出统一信封，不抛异常", async () => {
  const { app } = setup();
  for (const key of app.routes.keys()) {
    const [method, pat] = key.split(" ");
    const path = pat.replace(/:([^/]+)/g, "x");
    const out = await call(app, method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(typeof out?.ok, "boolean", `${method} ${pat} 未返回 ok 信封`);
  }
});

test("GET /api/settings 返回设置", async () => {
  const { app } = setup();
  const out = await call(app, "GET", "/api/settings");
  assert.equal(out.ok, true);
  assert.equal(typeof out.settings, "object");
});

test("GET /api/overview 返回 ok 信封", async () => {
  const { app } = setup();
  const out = await call(app, "GET", "/api/overview");
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.agents));
});

test("POST 请求体缺失时不应崩，仍答信封", async () => {
  const { app } = setup();
  const out = await call(app, "POST", "/api/threads/x/messages");
  assert.equal(typeof out.ok, "boolean");
});

test("全局「稍后再说」落盘，重启后 overview 仍带截止时间", async () => {
  const ctx = fakeCtx();
  const app1 = fakeApp();
  registerRoutes(app1, ctx);
  const before = Date.now();
  const out = await call(app1, "POST", "/api/proactive/snooze", { body: { hours: 2 } });
  assert.equal(out.ok, true);
  assert.ok(out.until > before + 3600_000, `until 应落在约 2 小时后：${out.until}`);
  assert.equal((await call(app1, "GET", "/api/overview")).snoozedUntil, out.until);

  // 新引擎 = 面板刷新；状态只能来自 proactive-state.json
  const app2 = fakeApp();
  registerRoutes(app2, ctx);
  assert.equal((await call(app2, "GET", "/api/overview")).snoozedUntil, out.until);

  const cleared = await call(app2, "POST", "/api/proactive/snooze", { body: { hours: 0 } });
  assert.equal(cleared.until, 0);
  assert.equal((await call(app2, "GET", "/api/overview")).snoozedUntil, 0);
});
