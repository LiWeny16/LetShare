/**
 * 远端音频播放管线（Web Audio API）：音量 0..200% 增益 + 防爆音 + 语音清晰度 + 空间展宽。
 *
 * 管线（惰性创建，首次远端流到达且处于用户手势之后才建 AudioContext）：
 *   remoteStream → MediaStreamSource
 *     → BiquadFilter highpass 100Hz（去低频轰鸣，微弱）
 *     → BiquadFilter highshelf 2.8kHz +3dB（清晰度增强，可开关）
 *     → [空间展宽 Haas 效应：ChannelSplitter → 右路 DelayNode 15ms → ChannelMerger]（可开关；仅单声道生效）
 *     → GainNode（0..2，>1 = 增益增强）
 *     → DynamicsCompressor（-18dB / 4:1 / 防增益爆音）
 *     → ctx.destination
 *
 * 安全兜底：AudioContext 不可用/创建失败/持续 suspended → attach 返回 false，
 * 调用方回退原 <audio> 元素路径（volum 硬 clamp 0..1，行为 = 3.6.x 现状）。
 *
 * 本模块顶层零浏览器 API 引用（Node 单测可 import）；构造可注入 ctx 工厂便于单测。
 */

export const SPEAKER_VOLUME_MAX = 2;

/** 音量钳制 0..2（>1 = 增益增强；非法值回退 1 = 100%）。纯函数。 */
export function clampSpeakerVolume(v: number): number {
  return Math.min(SPEAKER_VOLUME_MAX, Math.max(0, Number.isFinite(v) ? v : 1));
}

export type RemoteAudioPipelineOptions = {
  /** 播放音量 0..2（1 = 100%；>1 经 GainNode 增益，压缩器防爆音） */
  volume: number;
  /** 清晰度增强：高通 100Hz + 高频搁架 2.8kHz +3dB */
  clarity: boolean;
  /** 空间展宽：Haas 效应（单声道流右路延迟 ~15ms），仅单声道输入生效 */
  widen: boolean;
};

type AudioContextFactory = () => AudioContext | null;

function defaultCtxFactory(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const HAAS_DELAY_SECONDS = 0.015;

export class RemoteAudioPipeline {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private stream: MediaStream | null = null;
  private opts: RemoteAudioPipelineOptions = { volume: 1, clarity: true, widen: false };
  private readonly createCtx: AudioContextFactory;

  constructor(createCtx: AudioContextFactory = defaultCtxFactory) {
    this.createCtx = createCtx;
  }

  /** 已有可用音频图（Web Audio 接管发声）。 */
  get isActive(): boolean {
    return this.ctx !== null;
  }

  /**
   * 挂载远端流：惰性创建 AudioContext 并建图。失败返回 false（调用方回退元素路径）。
   * 同一流重复挂载 → 幂等更新选项。detach 后可用新流再次 attach（图整体重建）。
   */
  attach(stream: MediaStream, opts?: Partial<RemoteAudioPipelineOptions>): boolean {
    if (!stream) return false;
    this.stream = stream;
    if (opts) this.opts = { ...this.opts, ...opts, volume: clampSpeakerVolume(opts.volume ?? this.opts.volume) };
    if (this.ctx && this.source) {
      this.applyConnectionOptions();
      return true;
    }
    const ctx = this.createCtx();
    if (!ctx) return false;
    if (ctx.state === "suspended") void ctx.resume();
    try {
      this.ctx = ctx;
      this.buildGraph(ctx);
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
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
    }
    this.stream = null;
  }

  /** 热更新选项：音量即时生效；clarity/widen 变化 → 对缓存流重建图（幂等，切换产生毫秒级间隙）。 */
  update(opts: Partial<RemoteAudioPipelineOptions>): void {
    this.opts = {
      ...this.opts,
      ...opts,
      volume: clampSpeakerVolume(opts.volume ?? this.opts.volume),
    };
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    if (!this.source) return;
    if (opts.volume !== undefined && this.gain) {
      this.gain.gain.value = this.opts.volume;
    }
    if (opts.clarity !== undefined || opts.widen !== undefined) {
      // 拓扑变化：重建图（source 引用保留，仅重建其后链路）
      const ctx = this.ctx;
      if (ctx) {
        this.rebuildGraph(ctx);
      }
    }
  }

  /** 用户手势时补一次 resume（自动播放策略兜底；生命周期内幂等）。 */
  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** 扬声器选择：Chromium 110+ AudioContext.setSinkId；不支持返回 false（调用方回退元素路径）。 */
  async setSinkId(deviceId: string): Promise<boolean> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<unknown> };
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

  private createNodes(ctx: AudioContext) {
    const source = ctx.createMediaStreamSource(this.stream!);
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

  /** 建图：source → [clarity: highpass+shelf] → [widen] → gain → comp → upmix(强制双声道) → destination。
   *  拓扑按当前 opts 一次性确定：clarity 关 = 跳过滤波节点；widen 关 = 跳过展宽子图。 */
  private buildGraph(ctx: AudioContext): void {
    const { source, highpass, shelf, gain, comp, upmix } = this.createNodes(ctx);
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

  /** 拓扑变化时重建 source 之后的链路（source 保留以免二次消费流问题；旧链先断开）。 */
  private rebuildGraph(ctx: AudioContext): void {
    // 断开旧链路后重建（MediaStreamAudioSourceNode 可反复 connect）
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // ignore
      }
    }
    this.buildGraph(ctx);
  }
}