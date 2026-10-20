/**
 * 可注入时钟（V3 存活看门狗用）。
 *
 * 为什么存在：C-10 要求"ctxState 变为非 running 后 ≤1s 内元素自动接管"，该不变量必须
 * 能用虚拟时钟推进来断言（X5：不得把真实时间当正确性前提）。裸 setInterval 只允许出现在
 * 本模块的 systemClock 里，其余代码一律拿注入的 Clock。
 */

/** 时钟句柄的取消函数（避免 Node/浏览器 setInterval 返回类型差异泄漏到业务代码）。 */
export type CancelTimer = () => void;

export type Clock = {
  /** 毫秒时间戳；单测注入虚拟时钟推进，禁真实 sleep。 */
  now(): number;
  /** 周期任务（看门狗探针）。返回取消函数；intervalMs ≤ 1000 是 C-10 的硬要求。 */
  setInterval(handler: () => void, intervalMs: number): CancelTimer;
};

/** 生产时钟：全局 setInterval（浏览器返回 number、Node 返回 Timeout，故以取消闭包封装）。 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval: (handler: () => void, intervalMs: number): CancelTimer => {
    const handle = globalThis.setInterval(handler, intervalMs);
    return () => {
      globalThis.clearInterval(handle);
    };
  },
};
