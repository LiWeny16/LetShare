// 会话代次（ARCHITECTURE §1 不变量属主表 · 红队第 6 条补入）：
// 「旧异步结果不得覆盖新连接」。任何跨越 await 边界的连接结果，在落地前必须先校验代次。
//
// 为什么存在：colabLib 的可见性处理同一 tick 里可能同时发起 attemptReconnect() 与
// connectToServer()，ConnectionManager 又在 `await provider.connect()` 之后无条件写
// `currentProvider` —— 后完成的旧连接会把新连接顶掉（旧 socket 留着、新 socket 被遗忘），
// 症状与"半开连接永远不重连"同源。

export class SessionEpoch {
  private value = 0;

  get current(): number {
    return this.value;
  }

  /** 开始一个新的连接代次；此后旧代次的异步结果一律作废。 */
  next(): number {
    this.value += 1;
    return this.value;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.value;
  }

  /** 只有仍是当前代次才执行；旧代次结果直接丢弃（返回 null）。 */
  runIfCurrent<T>(epoch: number, fn: () => T): T | null {
    if (!this.isCurrent(epoch)) return null;
    return fn();
  }
}

/**
 * 「当前连接」的唯一写槽：旧代次的异步结果 adopt 一律失败，不可能覆盖新连接。
 * 所有跨 await 边界才能拿到连接对象的调用方（ConnectionManager / colabLib）都必须经此。
 */
export class ConnectionSlot<T> {
  private readonly epoch = new SessionEpoch();
  private current: T | null = null;
  private adoptedEpoch = 0;

  get generation(): number {
    return this.epoch.current;
  }

  get value(): T | null {
    return this.current;
  }

  /** 开始一次新的接管尝试；返回代次，后续 adopt 必须带着它。 */
  begin(): number {
    return this.epoch.next();
  }

  /** 只有当前代次可接管。旧代次返回 false 且不改变现值；调用方负责释放旧资源。 */
  adopt(epoch: number, value: T): boolean {
    if (!this.epoch.isCurrent(epoch)) return false;
    this.current = value;
    this.adoptedEpoch = epoch;
    return true;
  }

  /** 释放当前值并作废所有在途代次（显式 disconnect 必须走这里）。 */
  release(): void {
    this.epoch.next();
    this.current = null;
    this.adoptedEpoch = 0;
  }

  /** 当前值所属代次（0 = 空槽）。 */
  get adoptedGeneration(): number {
    return this.adoptedEpoch;
  }
}
