/**
 * 远端音频播放管线（Web Audio API）：音量 0..200% 增益 + 防爆音 + 语音清晰度 + 空间展宽。
 *
 * 管线（惰性创建，首次远端流到达时建 AudioContext）：
 *   remoteStream → MediaStreamSource
 *     → BiquadFilter highpass 100Hz（去低频轰鸣，微弱）
 *     → BiquadFilter highshelf 2.8kHz +3dB（清晰度增强，可开关）
 *     → [空间展宽 Haas 效应：ChannelSplitter → 右路 DelayNode 15ms → ChannelMerger]（可开关；仅单声道生效）
 *     → GainNode（0..2，>1 = 增益增强）
 *     → DynamicsCompressor（-18dB / 4:1 / 防增益爆音）
 *     → upmix（强制双声道）→ ctx.destination
 *
 * V3 语义收紧（B1 永久静音的根因就是旧语义分叉）：
 *  - `attach()` 的返回值 **只表示"音频图已建立"**，绝不表示"正在发声"。旧实现两条分支不对称
 *    （复用已有 ctx 时同步读 ctx.state，resume 是异步的 ⇒ 恒 false；新建分支又 detach），
 *    导致"isActive=true 却没人发声"的假象（DIVERGENCE F17）。现改为**两条分支同一语义**：
 *    建图失败才 detach；suspended 是合法状态，由 RemoteAudioHost 的裁决 + 存活看门狗接管。
 *  - 危险 getter `isActive`（= ctx !== null）已删除，改名 `hasGraph()` 且文档明示 ≠ 发声。
 *  - 发声判定只有一处：`RemoteAudioHost.state.audibleVia`。
 *
 * 本模块顶层零浏览器 API 引用（Node 单测可 import）；构造可注入 ctx 工厂便于单测。
 */
import { clampSpeakerVolume } from "./remoteAudioDecision";

export type RemoteAudioPipelineOptions = {
  /** 播放音量 0..2（1 = 100%；>1 经 GainNode 增益，压缩器防爆音） */
  volume: number;
  /** 清晰度增强：高通 100Hz + 高频搁架 2.8kHz +3dB */
  clarity: boolean;
  /** 空间展宽：Haas 效应（单声道流右路延迟 ~15ms），仅单声道输入生效 */
  widen: boolean;
};
export type AudioContextFactory = () => AudioContext | null;
export type CancelTap = () => void;

function defaultCtxFactory(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const HAAS_DELAY_SECONDS = 0.015;

/** 判定 ctx 是否 running（独立函数避免 TS 属性收窄把 await 后的 state 误钉为 "suspended"）。 */
function isRunning(ctx: AudioContext): boolean {
  return ctx.state === "running";
}

export class RemoteAudioPipeline {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private tail: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private opts: RemoteAudioPipelineOptions = { volume: 1, clarity: true, widen: false };
  private readonly createCtx: AudioContextFactory;

  constructor(createCtx: AudioContextFactory = defaultCtxFactory) {
    this.createCtx = createCtx;
  }

  /** 音频图已建立（≠ 正在发声！发声判定只看 RemoteAudioHost.state.audibleVia）。 */
  hasGraph(): boolean {
    return this.ctx !== null && this.source !== null;
  }

  /** 只读诊断（window.__ls.dump）：AudioContext 状态；未建图为 null。不参与任何播放决策。 */
  get ctxState(): AudioContextState | null {
    return this.ctx ? this.ctx.state : null;
  }

  /**
   * 挂载远端流：惰性创建 AudioContext 并建图。返回值 = 音频图是否已建立（hasGraph）。
   * 同一流重复挂载 → 幂等更新选项；detach 后可用新流再次 attach（图整体重建）。
   * **不做同步 ctx.state 判定**（resume 是异步的，同步读必错；见文件头 F17）。
   */
  attach(stream: MediaStream, opts?: Partial<RemoteAudioPipelineOptions> | undefined): boolean {
    if (!stream) return false;
    const previousStream = this.stream;
    this.stream = stream;
    if (opts) this.opts = { ...this.opts, ...opts, volume: clampSpeakerVolume(opts.volume ?? this.opts.volume) };
    const ctx = this.ctx ?? this.createCtx();
    if (!ctx) return false;
    try {
      this.ctx = ctx;
      if (this.source && previousStream === stream) {
        this.applyConnectionOptions();
      } else {
        // MediaStreamAudioSourceNode 固定消费建图时的音轨；换流必须重新绑定。
        this.rebuildGraph(ctx, stream);
      }
      void this.resume();
      return true;
    } catch (err) {
      console.warn("[RemoteAudioPipeline] 音频管线建图失败，回退元素路径:", err);
      this.detach();
      return false;
    }
  }

  /** 释放音频图与 AudioContext（幂等；通话结束/组件卸载时调用）。 */
  detach(): void {
    this.source = null;
    this.gain = null;
    this.tail = null;
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // close 对已关闭的 ctx 抛 InvalidStateError：幂等拆除必须容忍
      }
      this.ctx = null;
    }
    this.stream = null;
  }

  /** 热更新选项：音量即时生效；clarity/widen 变化 → 对缓存流重建图（幂等，切换产生毫秒级间隙）。 */
  update(opts: Partial<RemoteAudioPipelineOptions> | undefined): void {
    this.opts = {
      ...this.opts,
      ...opts,
      volume: clampSpeakerVolume(opts?.volume ?? this.opts.volume),
    };
    if (!this.source) return;
    if (opts?.volume !== undefined && this.gain) {
      this.gain.gain.value = this.opts.volume;
    }
    if (opts?.clarity !== undefined || opts?.widen !== undefined) {
      const ctx = this.ctx;
      const stream = this.stream;
      if (ctx && stream) this.rebuildGraph(ctx, stream);
    }
  }

  /**
   * 用户手势 / 看门狗恢复时补一次 resume。resolve(true) = ctx 已 running；
   * 失败 resolve(false) 并 warn（D5：禁止静默吞错，调用方据此置 autoplayBlocked）。
   */
  async resume(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    if (ctx.state !== "suspended") return false;
    try {
      await ctx.resume();
    } catch (err) {
      console.warn("[RemoteAudioPipeline] AudioContext.resume 被拒（自动播放策略）:", err);
      return false;
    }
    return isRunning(ctx);
  }

  /** 切元素通路时调用：suspend 保留音频图（可快速切回），gain 由调用方置 0。幂等。 */
  suspend(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    void ctx.suspend().catch((err: unknown) => {
      console.warn("[RemoteAudioPipeline] AudioContext.suspend 失败:", err);
    });
  }

  /** ctx 状态变化订阅（C-10 双通道探针之一）；返回取消函数。未建图时为 no-op。 */
  onStateChange(listener: (state: AudioContextState) => void): CancelTap {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.addEventListener !== "function") return () => undefined;
    const handler = (): void => listener(ctx.state);
    ctx.addEventListener("statechange", handler);
    return () => ctx.removeEventListener("statechange", handler);
  }

  /**
   * 验收/诊断钩子：在管线末端（进 destination 之前的**发声路径**上）挂 AnalyserNode，
   * 用于 C-12 红队第 8 条"真机可听性 RMS > 0"。AnalyserNode 必须同 ctx 创建，故由本方法建。
   * 不改变发声拓扑；返回 analyser 与解绑函数。未建图返回 null。
   */
  tapOutput(): { analyser: AnalyserNode; detach: CancelTap } | null {
    const ctx = this.ctx;
    const tail = this.tail;
    if (!ctx || !tail || typeof ctx.createAnalyser !== "function") return null;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    tail.connect(analyser);
    return {
      analyser,
      detach: () => {
        try {
          tail.disconnect(analyser);
        } catch {
          // 节点已断开时忽略
        }
      },
    };
  }

  /** 扬声器选择：Chromium 110+ AudioContext.setSinkId；不支持返回 false（调用方回退元素路径）。 */
  async setSinkId(deviceId: string): Promise<boolean> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<unknown> }) | null;
    if (!ctx?.setSinkId) return false;
    try {
      await ctx.setSinkId(deviceId);
      return true;
    } catch (err) {
      console.warn("[RemoteAudioPipeline] setSinkId failed:", err);
      return false;
    }
  }

  /** 当前生效选项（调试/单测断言）。 */
  getOptions(): RemoteAudioPipelineOptions {
    return { ...this.opts };
  }

  // ─── 内部 ─────────────────────────────────────────────────────────

  private createNodes(ctx: AudioContext, stream: MediaStream) {
    const source = ctx.createMediaStreamSource(stream);
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 100;
    highpass.Q.value = 0.7;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 2800;
    shelf.gain.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = this.opts.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    // 末端强制双声道上混：单声道流（WebRTC Opus 常为 1 声道）在浏览器默认下
    // 若未被 speakers-upmix 到右声道，会出现"只有左声道"。显式 channelCount=2
    // 保证无论源几声道、展宽开否，最终输出都是真双声道（左右都有声）。
    const upmix = ctx.createGain();
    upmix.gain.value = 1;
    upmix.channelCount = 2;
    upmix.channelCountMode = "explicit";
    return { source, highpass, shelf, gain, comp, upmix };
  }

  /** 建图：source → [clarity: highpass+shelf] → [widen] → gain → comp → upmix(强制双声道) → destination。 */
  private buildGraph(ctx: AudioContext, stream: MediaStream): void {
    const { source, highpass, shelf, gain, comp, upmix } = this.createNodes(ctx, stream);
    this.source = source;
    this.gain = gain;
    if (this.opts.clarity) {
      source.connect(highpass);
      highpass.connect(shelf);
    } else {
      source.connect(shelf);
    }
    const tail: AudioNode =
      this.opts.widen && source.channelCount <= 1 && ctx.createChannelSplitter != null
        ? this.buildWidenSubgraph(ctx, shelf)
        : shelf;
    tail.connect(gain);
    gain.connect(comp);
    comp.connect(upmix);
    upmix.connect(ctx.destination);
    this.tail = upmix;
  }

  /** 空间展宽子图（Haas）：shelf → splitter → 左路直通 merger、右路 delay 15ms merger → merger。 */
  private buildWidenSubgraph(ctx: AudioContext, input: AudioNode): AudioNode {
    const splitter = ctx.createChannelSplitter(2);
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = HAAS_DELAY_SECONDS;
    const merger = ctx.createChannelMerger(2);
    splitter.connect(merger, 0, 0);
    splitter.connect(delay, 0, 0);
    delay.connect(merger, 0, 1);
    input.connect(splitter);
    return merger;
  }

  /** 热更新应用：音量即时生效（拓扑变化走 rebuildGraph）。 */
  private applyConnectionOptions(): void {
    if (this.gain) this.gain.gain.value = this.opts.volume;
  }

  /** 换流/拓扑变化时断开旧 source，再按当前流重建音频图。 */
  private rebuildGraph(ctx: AudioContext, stream: MediaStream): void {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // 节点已断开时忽略
      }
    }
    this.buildGraph(ctx, stream);
  }
}
