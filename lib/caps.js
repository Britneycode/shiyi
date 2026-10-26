// 功能探测（装载期 typeof，不触发授权）+ 授权状态记录（ok | denied | unsupported | unknown）。
// D-003：manifest 不写 minAppVersion，全靠这里的探测降级。

export function createCaps(ctx) {
  /** @type {Map<string, {feature:boolean, auth:string, note:string}> */
  const table = new Map();
  const set = (name, auth, err) => {
    const cur = table.get(name) ?? { feature: false, auth: "unknown", note: "" };
    cur.auth = auth;
    if (err) cur.note = String(err?.message ?? err).slice(0, 200);
    table.set(name, cur);
  };
  const define = (name, feature) => {
    const cur = table.get(name) ?? { feature: false, auth: "unknown", note: "" };
    cur.feature = !!feature;
    table.set(name, cur);
  };

  // 装载期 typeof 探测（不触发授权）。PLAN §2.3。
  define("models.stream", typeof ctx?.models?.stream === "function");
  define("models.utility", typeof ctx?.models?.utility === "function");
  define("models.list", typeof ctx?.models?.list === "function");
  define("models.cancel", typeof ctx?.models?.cancel === "function");
  define("bus.subscribe", typeof ctx?.bus?.subscribe === "function");
  define("bus.request", typeof ctx?.bus?.request === "function");
  define("inputBanner.set", typeof ctx?.inputBanner?.set === "function");
  define("inputBanner.dismiss", typeof ctx?.inputBanner?.dismiss === "function");
  define("tools.register", typeof ctx?.tools?.register === "function");
  define("resources.read", typeof ctx?.resources?.read === "function");
  define("clipboard.writeText", typeof ctx?.clipboard?.writeText === "function");

  return {
    /** 功能是否存在（typeof 探测） */
    has: (name) => table.get(name)?.feature === true,
    /** 授权状态 ok | denied | unsupported | unknown */
    auth: (name) => table.get(name)?.auth ?? "unknown",
    set,
    /** 受保护调用包装：成功记 ok；按错误信息记 denied/unsupported/unknown；异常原样抛出。 */
    async call(name, fn) {
      try {
        const v = await fn();
        set(name, "ok");
        return v;
      } catch (err) {
        const msg = String(err?.code ?? "") + " " + String(err?.message ?? err);
        if (/denied|permission|unauthor|forbidden|EACCES|not.?granted/i.test(msg)) set(name, "denied", err);
        else if (/unsupported|not.?support|unavailable|not.?found|no.?method|obsolete/i.test(msg)) set(name, "unsupported", err);
        else set(name, "unknown", err);
        throw err;
      }
    },
    /** app:capabilities 诊断（拾光记做法，🧪 返回结构）。失败只记录。 */
    async probe() {
      if (!this.has("bus.request")) return null;
      try {
        const res = await this.call("bus.request", () => ctx.bus.request("app:capabilities"));
        set("app:capabilities", "ok");
        return res ?? null;
      } catch {
        return null;
      }
    },
    /** 快照（经 /api/overview 透出给界面） */
    snapshot() {
      const out = {};
      for (const [k, v] of table) out[k] = { feature: v.feature, auth: v.auth, ...(v.note ? { note: v.note } : {}) };
      return out;
    },
  };
}
