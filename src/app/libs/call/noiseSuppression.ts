/**
 * 端侧实验室降噪管线：WebAudio + AudioWorklet + WASM 模型（RNNoise / GTCRN）。
 *
 * 链路：
 *   rawStream（麦克风原始流）→ MediaStreamAudioSourceNode → Rnnoise/GtcrnWorkletNode
 *   → MediaStreamAudioDestinationNode → dest.stream（降噪后流，交给通话会话发送）
 *
 * 约束与注意：
 *  - RNNoise/GTCRN worklet 模型假定 48kHz 采样率：AudioContext 显式 sampleRate: 48000
 *  - wasm/worklet 资源用 Vite 静态导入放模块顶部（构建期解析）。本项目 vite.config 的
 *    assetsInlineLimit 为 4MB，而这些资源只有 100KB 量级：必须带 &no-inline 后缀强制
 *    以真实文件输出到 docs/static/，否则会被 base64 内联进 JS —— AudioWorklet.addModule
 *    对 data: URL 的支持在部分浏览器不可靠
 *  - 原始流的生命周期由本管线接管（stop() 时停其轨释放麦克风）；返回的 processed 流
 *    的轨由调用方（通话会话）负责停止
 *  - 单例持有至多一张活跃图；process() 幂等（先 stop() 旧图再建新图）
 */

import {
  loadRnnoise,
  loadGtcrn,
  RnnoiseWorkletNode,
  GtcrnWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
// 静态 ?url 导入放模块顶部：Vite 构建期解析为产物资源 URL（&no-inline 强制真实文件输出，防 base64 内联）
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url&no-inline";
import gtcrnWorkletUrl from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url&no-inline";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url&no-inline";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&no-inline";
import gtcrnWasmUrl from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url&no-inline";

/** 降噪算法：rnnoise=RNNoise（成熟/轻量），gtcrn=GTCRN（实验室新算法） */
export type NsAlgorithm = "rnnoise" | "gtcrn";

/**
 * 单张降噪图：持有一条 rawStream → worklet → dest 链路。
 * process()/stop() 均幂等；同一时刻只有一次通话，单例一张图足够。
 */
export class NoiseSuppressPipeline {
  /** AudioContext（显式 48kHz：worklet 模型按该采样率设计） */
  private ctx: AudioContext | null = null;
  /** 原始流挂到 WebAudio 图的源节点 */
  private source: MediaStreamAudioSourceNode | null = null;
  /** 降噪 worklet 节点（Rnnoise/Gtcrn 二选一） */
  private node: RnnoiseWorkletNode | GtcrnWorkletNode | null = null;
  /** 处理后流输出节点（dest.stream 即返回给调用方的 processed 流） */
  private dest: MediaStreamAudioDestinationNode | null = null;
  /** 原始流引用：stop() 时停其轨释放麦克风（原始流保持存活持续喂图） */
  private rawStream: MediaStream | null = null;

  /** 是否已有活跃降噪图 */
  get isEnabled(): boolean {
    return this.ctx !== null;
  }

  /**
   * 处理原始麦克风流，返回经端侧模型降噪后的流。
   * - 幂等：若已有活跃图先 stop() 再重建 —— 重建期间正在发送的旧 processed 轨会
   *   短暂无声（wasm 加载 + addModule 约 1s），换麦/换算法的通话中重建场景可接受；
   *   先停后建保证不残留旧图泄漏。调用方应先采好新流再调 process()（重建前后
   *   新流采集不受旧图影响），把无声窗口压到最小
   * - rawStream 保持存活（调用方在 stop() 前不得 stop 其轨），作为图输入持续喂图
   */
  async process(rawStream: MediaStream, algo: NsAlgorithm): Promise<MediaStream> {
    if (this.isEnabled) this.stop();
    // AudioContext 显式 48kHz：RNNoise/GTCRN worklet 模型假定 48kHz 采样率
    const ctx = new AudioContext({ sampleRate: 48000 });
    try {
      // 自动播放策略可能让新 ctx 处于 suspended：恢复失败按建图失败处理（catch 统一释放）
      if (ctx.state === "suspended") await ctx.resume();
      let wasmBinary: ArrayBuffer;
      let workletUrl: string;
      if (algo === "rnnoise") {
        // loadRnnoise 内部做 SIMD 特性探测：支持则取 simd wasm，否则取普通 wasm
        wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
        workletUrl = rnnoiseWorkletUrl;
      } else {
        wasmBinary = await loadGtcrn({ url: gtcrnWasmUrl });
        workletUrl = gtcrnWorkletUrl;
      }
      await ctx.audioWorklet.addModule(workletUrl);
      const node = algo === "rnnoise"
        ? new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
        : new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary });
      const source = ctx.createMediaStreamSource(rawStream);
      const dest = ctx.createMediaStreamDestination();
      source.connect(node);
      node.connect(dest);
      this.ctx = ctx;
      this.source = source;
      this.node = node;
      this.dest = dest;
      this.rawStream = rawStream;
      return dest.stream;
    } catch (err) {
      // 建图失败：立即释放半成品 ctx，不留泄漏；错误上抛由调用方回退浏览器降噪
      void ctx.close().catch(() => undefined);
      throw err;
    }
  }

  /** 停止并释放全部图资源：断链 → node.destroy() → ctx.close() → 停原始流轨。幂等。 */
  stop(): void {
    if (
      this.ctx === null &&
      this.source === null &&
      this.node === null &&
      this.dest === null &&
      this.rawStream === null
    ) {
      return; // 未启用：幂等返回
    }
    try { this.source?.disconnect(); } catch { /* 已断开时忽略 */ }
    try { this.node?.disconnect(); } catch { /* 已断开时忽略 */ }
    try { this.dest?.disconnect(); } catch { /* 已断开时忽略 */ }
    try { this.node?.destroy(); } catch { /* 已销毁时忽略 */ }
    void this.ctx?.close().catch(() => { /* 已关闭时忽略 */ });
    // 原始流由本管线接管生命周期：停轨释放麦克风（processed 流的轨由通话会话负责停止）
    this.rawStream?.getTracks().forEach((track) => track.stop());
    this.ctx = null;
    this.source = null;
    this.node = null;
    this.dest = null;
    this.rawStream = null;
  }
}

/** 全局单例：同一时刻至多一张活跃降噪图（一次通话一条链路） */
export const nsPipeline = new NoiseSuppressPipeline();
