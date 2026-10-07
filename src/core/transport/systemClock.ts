// 系统 Clock / Rng 的唯一注入边界（X5）。
//
// 全仓只有本文件允许直接调用 Date.now() / setTimeout / clearTimeout / Math.random()：
// 业务与机制代码一律从注入的 Clock / Rng 取时间与随机数，测试因此可以用虚拟时钟与
// 固定种子，不需要真实 sleep，也不会把真实时间当成正确性前提。
//
// tests/coreInjection.test.ts 用静态检查锁住"只有本文件可以直连系统时钟/随机数"。

import type { Clock, Rng } from "./RetrySupervisor";

class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): number {
    return setTimeout(fn, ms) as unknown as number;
  }

  clearTimeout(handle: number): void {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

class SystemRng implements Rng {
  next(): number {
    return Math.random();
  }
}

/** 浏览器/Node 共用的实时时钟。构造一次、全仓注入，禁止在业务代码里直接调用。 */
export const systemClock: Clock = new SystemClock();

/** 同上：实随机源只在本文件出现。 */
export const systemRng: Rng = new SystemRng();
