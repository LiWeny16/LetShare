// 「服务端连接存活」探测的接入件：把 LivenessMonitor 的判定接到重连上。
//
// 语义（全仓唯一属主）：
//   * 探测帧 = 复用服务端既有 `unsubscribe` + `event=liveness:probe`（见 livenessProbe.ts）；
//   * **任何下行帧都算服务端存活**（回执 / 业务消息 / 错误都算）—— 探测只是"制造下行"；
//   * probeTimeoutMs 内零下行 → 半开 → onDead（接入方必须经 RetrySupervisor 重连）。
//
// 既有 presenceProbe（`to: id` 的对端探活）不承担本不变量：它问的是"别的用户在线否"，
// 房间里没人时根本不发探测，且它的结论是"把对端从列表里移除"而不是"重连服务端"。
// 两者只共享同一个事实来源 —— `noteInbound()`，因此不存在两份"是否存活"的判定（X2）。

import type { Clock } from "./RetrySupervisor";
import { LivenessMonitor } from "./LivenessMonitor";
import type { LivenessProbeFrame } from "./livenessProbe";
import { buildLivenessProbe } from "./livenessProbe";
import type { LivenessState } from "./LivenessMonitor";

export interface ServerLivenessOptions {
  clock: Clock;
  /** 两次探测的空闲间隔。 */
  probeIntervalMs: number;
  /** 单次探测的应答窗口（零下行即判定半开）。 */
  probeTimeoutMs: number;
  /** 发出一帧原始 WS 消息（序列化与传输由接入方负责）。 */
  send: (frame: LivenessProbeFrame) => void;
  /** 探测所用频道：普通房间号；meeting 直连（transportOnly）为空。 */
  channel: () => string | null;
  /** 半开判定：必须触发重连（经 RetrySupervisor），不得静默。 */
  onDead: (reason: string) => void;
}

export class ServerLiveness {
  private readonly monitor: LivenessMonitor;
  private readonly opts: ServerLivenessOptions;
  private started = false;

  constructor(opts: ServerLivenessOptions) {
    this.opts = opts;
    this.monitor = new LivenessMonitor({
      clock: opts.clock,
      probeIntervalMs: opts.probeIntervalMs,
      probeTimeoutMs: opts.probeTimeoutMs,
    });
  }

  get state(): LivenessState {
    return this.monitor.state;
  }

  start(): void {
    this.started = true;
    this.monitor.start({
      sendProbe: (probeId) => {
        this.opts.send(buildLivenessProbe(this.opts.channel(), probeId, this.opts.clock.now()));
      },
      onDead: (reason) => this.opts.onDead(reason),
    });
  }

  stop(reason: string): void {
    this.started = false;
    this.monitor.stop(reason);
  }

  /** 任意下行帧都算存活；停用后不再影响状态。 */
  noteInbound(): void {
    if (!this.started) return;
    this.monitor.noteInbound();
  }
}
