/**
 * 测试用虚拟时钟 / 固定种子随机源（非 *.test.ts，仅供 tests/ 下用例 import）。
 *
 * 全部用例禁止真实 sleep 与真实时间（X5）：时间只由 FakeClock.advanceBy 推进，
 * 随机数只由 FakeRng / ScriptedRng 给出。
 */
import type { Clock, Rng, RetryPolicy } from "../src/core/transport/index";

export interface FakeTimer {
  handle: number;
  dueAt: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private current = 0;
  private seq = 1;
  private readonly timers: FakeTimer[] = [];

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): number {
    const handle = this.seq;
    this.seq += 1;
    this.timers.push({ handle, dueAt: this.current + Math.max(0, ms), fn });
    return handle;
  }

  clearTimeout(handle: number): void {
    const index = this.timers.findIndex((t) => t.handle === handle);
    if (index >= 0) this.timers.splice(index, 1);
  }

  get pendingCount(): number {
    return this.timers.length;
  }

  /** 推进虚拟时间并按到期顺序执行所有到点定时器（含推进过程中新排的）。 */
  advanceBy(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.takeDue(target);
      if (due === null) break;
      this.current = Math.max(this.current, due.dueAt);
      due.fn();
    }
    this.current = target;
  }

  private takeDue(target: number): FakeTimer | null {
    let picked: FakeTimer | null = null;
    for (const timer of this.timers) {
      if (timer.dueAt > target) continue;
      if (picked === null || timer.dueAt < picked.dueAt) picked = timer;
    }
    if (picked !== null) this.clearTimeout(picked.handle);
    return picked;
  }
}

export class FakeRng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? 987654321 : seed;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

export class ScriptedRng implements Rng {
  private readonly values: readonly number[];
  private index = 0;

  constructor(values: readonly number[]) {
    this.values = values;
  }

  next(): number {
    const value = this.values[this.index % this.values.length] ?? 0;
    this.index += 1;
    return value;
  }
}

export function retryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { baseMs: 100, capMs: 800, jitterRatio: 0, maxAttempts: 3, ...overrides };
}

/** 只排空微任务队列，不借用真实定时器。 */
export async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/**
 * 推进虚拟时间。分片推进并在每片后排空微任务：定时器回调里发起的异步结算
 * （attempt 结果 → 重排下一次）必须能在同一段推进内生效，否则测不到收敛。
 */
export async function step(clock: FakeClock, ms: number): Promise<void> {
  const chunk = 100;
  let left = Math.max(0, ms);
  while (left > 0) {
    const delta = Math.min(chunk, left);
    clock.advanceBy(delta);
    await flush();
    left -= delta;
  }
}
