// 拾遗（shiyi）— HanaAgent v2 应用入口。
// 装载期只做 typeof 探测 + 注册 + unref 定时器；一切受保护调用都在异步 boot() 里 try/catch 降级。

import { PROACTIVE_TICK_MS, PROACTIVE_BOOT_DELAY_MS } from "./lib/config.js";
import { wire } from "./lib/wire.js";

const APP_ID = "shiyi";

export default {
  /** 装载期（§2.3）：typeof 探测 + 注册 + unref 定时器；受保护调用全在异步 boot()。 */
  apply(ctx) {
    const deps = wire(ctx);
    const { caps, settings, threads, engine, banner, mainfeed, hostTools, handoff } = deps;

    const bootPromise = (async () => {
      try {
        await settings.load();
        await threads.recoverInterrupted();
        if (caps.has("bus.subscribe")) {
          try {
            ctx.bus.subscribe(async (event, sessionPath) => {
              const type = event?.type ?? event?.kind;
              if (type === "message_end") await mainfeed.onMessageEnd(event, sessionPath);
              if (type === "turn_start") await banner.onTurnStart(sessionPath);
              if (type === `plugin-v2:${APP_ID}:banner`) await banner.onBannerEvent(event, sessionPath);
            }, { types: ["turn_start", "message_end", `plugin-v2:${APP_ID}:banner`] });
          } catch (err) {
            ctx.logger?.warn?.(`[shiyi] bus.subscribe 失败：${String(err?.message ?? err).slice(0, 80)}`);
          }
        }
        hostTools.register();
        // 路由由宿主扫描 routes/ 顶层自动加载（registerRoutes(app, ctx)），此处不再手动调用。
      } catch (err) {
        ctx.logger?.error?.(`[shiyi] boot 失败：${String(err?.message ?? err).slice(0, 120)}`);
      }
    })();

    // 主动引擎：5 分钟 tick + 启动 90s 首检（unref，不挡退出）
    try {
      const timer = setInterval(() => {
        engine.tick("interval").catch((err) => ctx.logger?.warn?.(`[shiyi] tick：${String(err?.message ?? err).slice(0, 80)}`));
      }, PROACTIVE_TICK_MS);
      timer.unref?.();
      const first = setTimeout(() => {
        engine.tick("boot").catch((err) => ctx.logger?.warn?.(`[shiyi] 首检：${String(err?.message ?? err).slice(0, 80)}`));
      }, PROACTIVE_BOOT_DELAY_MS);
      first.unref?.();
    } catch (err) {
      ctx.logger?.warn?.(`[shiyi] 主动引擎定时器失败：${String(err?.message ?? err).slice(0, 80)}`);
    }

    return { name: APP_ID, caps, boot: () => bootPromise, deps, engine, handoff, thread: threads };
  },
};
