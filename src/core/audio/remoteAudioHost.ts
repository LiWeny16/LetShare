/**
 * RemoteAudioHost —— 远端音频播放的**唯一权威**（V3 / ARCHITECTURE §4.5）。
 *
 * 持有：①解码 sink 元素（host 自建、恒 muted=true、恒 srcObject 非空，C-11/C-12）
 * ②唯一发声元素 ③RemoteAudioPipeline（经 AudioPipelinePort 注入，core 不依赖具体实现）。
 *
 * **单一写者（P6）**：`muted`/`volume`/`gain`/`srcObject`/`play()` 只在本类内被写。
 * **结构性互斥（C-09）**：pipeline ⇒ 元素 muted ∧ volume=0 且 gain=prefs.volume；
 * element ⇒ gain=0 ∧ pipeline.suspend() 且元素 volume=clamp01(prefs.volume)。
 * **存活看门狗（C-10）**：statechange（即时）+ ≤1000ms 轮询双通道，失效一拍后同 tick 切 element。
 * **不自动切回（反抖动契约）**：ctx 恢复 running 不切回；只在 setStream / setPrefs / unlock 切回。
 */
import { systemClock, type CancelTimer, type Clock } from "./remoteAudioClock";
import {
  clampElementVolume,
  clampSpeakerVolume,
  decide,
  readCtxState,
  type AudioPrefs,
  type AudibleVia,
  type CtxState,
  type Decision,
  type ElementState,
} from "./remoteAudioDecision";
import type {
  AudioPipelinePort,
  PlaybackState,
  RemoteAudioHostInvariants,
  RemoteAudioHostOptions,
  RemoteAudioHostSnapshot,
  RemoteAudioHostState,
  RemoteAudioMediaElement,
} from "./remoteAudioHostTypes";
import { applySinkRouting, audioTrackCount, createDomAudioElement } from "./remoteAudioDom";

/** C-10：探针周期 ≤1000ms。250ms × 确认一拍 ⇒ 最坏 ~500ms 元素接管，留足 1s 预算。 */
export const PROBE_INTERVAL_MS = 250;

export class RemoteAudioHost {
  private stream: MediaStream | null = null;
  private prefs: AudioPrefs = { volume: 1, clarity: true, widen: false };
  private sink: RemoteAudioMediaElement | null = null;
  private output: RemoteAudioMediaElement | null = null;
  /** output 是否 host 自建（自建才由 host remove()；UI 注入的元素 DOM 生命周期归 React）。 */
  private outputOwned = false;
  private cancelProbe: CancelTimer | null = null;
  private cancelStateChange: (() => void) | null = null;
  private notRunningSince: number | null = null;
  private lastFallbackAt: number | null = null;
  private autoplayBlocked = false;
  private playError: string | null = null;
  private playbackState: PlaybackState = "waiting-for-track";
  private designated: AudibleVia = "none";
  private gainCapped = false;
  private disposed = false;
  private readonly listeners = new Set<(state: RemoteAudioHostState) => void>();
  private readonly clock: Clock;
  private readonly makeSink: () => RemoteAudioMediaElement | null;
  private readonly makeOutput: () => RemoteAudioMediaElement | null;

  constructor(private readonly pipeline: AudioPipelinePort, options: RemoteAudioHostOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.makeSink = options.createSinkElement ?? createDomAudioElement;
    this.makeOutput = options.createOutputElement ?? createDomAudioElement;
  }

  /**
   * 唯一状态出口。判据只有 state.audibleVia；其余字段供诊断/降级提示。
   * A3：这里的 audibleVia 是**裁决意图**（宿主决定让谁发声）；诊断里的同名值是**物理推导**
   * （谁真的在响）。两者允许瞬态不一致，不要拿其中一个去“验证”另一个。
   */
  get state(): RemoteAudioHostState {
    return {
      audibleVia: this.designated,
      ctxState: this.ctxState(),
      lastFallbackAt: this.lastFallbackAt,
      autoplayBlocked: this.autoplayBlocked,
      playbackState: this.playbackState,
      playError: this.playError,
      gainCapped: this.gainCapped,
    };
  }

  /**
   * UI 注入唯一发声元素（DOM 生命周期归 React，host 仍是唯一写者）；
   * 未注入时 host 自建兑底，C-08 不依赖调用方自觉。保留 UI 元素位置是为了既有 DOM 侧工具链
   * （tests/e2e/diag-*.mts 的 `querySelector("audio")`）继续测到真实发声元素。
   */
  bindElement(el: RemoteAudioMediaElement | null): void {
    if (this.disposed || el === this.output) return;
    const previous = this.output;
    if (previous) this.releaseElement(previous, this.outputOwned);
    this.output = el;
    this.outputOwned = false;
    if (this.stream) {
      this.ensureElements();
      if (this.output) {
        this.output.srcObject = this.stream;
        this.reconcile("bindElement");
        this.ensurePlaying();
      }
    }
    this.emit();
  }

  /** 绑定/解绑远端音频流（幂等 P8）。null = 无内容可播。 */
  setStream(stream: MediaStream | null): void {
    if (this.disposed || stream === this.stream) return;
    this.stream = stream;
    if (!stream) {
      this.teardownStream();
      return;
    }
    this.ensureElements();
    this.bindStream(stream);
    this.pipeline.attach(stream, { volume: this.prefs.volume, clarity: this.prefs.clarity, widen: this.prefs.widen });
    this.watchPipeline();
    this.reconcile("setStream");
    this.ensurePlaying();
    this.applySinkId();
  }

  /** 热更新偏好。**用户主动改音频设置 = 用户决定**：允许在此切回管线（反抖动契约的显式时机之一）。 */
  setPrefs(prefs: AudioPrefs): void {
    if (this.disposed) return;
    this.prefs = { ...prefs, volume: clampSpeakerVolume(prefs.volume) };
    if (!this.stream) return;
    this.pipeline.update({ clarity: this.prefs.clarity, widen: this.prefs.widen });
    this.reconcile("setPrefs");
    this.applySinkId();
  }

  /**
   * 用户手势内恢复：resume 管线 + play 元素 + 按当前裁决恢复 muted/volume（B1"手势也救不回"的修复点），
   * 成功即清除 autoplayBlocked。手势也是"用户决定"：允许在此切回管线。
   */
  async unlock(): Promise<void> {
    if (this.disposed || !this.stream) return;
    const resumed = await this.pipeline.resume();
    this.reconcile("user-gesture");
    const out = this.output;
    if (out && out.paused) await this.playOutput();
    const healthy = this.designated === "pipeline" ? resumed : out !== null && !out.paused;
    this.setAutoplayBlocked(!healthy, healthy ? null : "手势恢复后通路仍未发声");
  }

  /** 只读不变量断言（C-08/C-09/C-11/C-12 的可执行判据）。 */
  invariants(): RemoteAudioHostInvariants {
    const out = this.output;
    const elementConfiguredAudible = out !== null && !out.muted && out.volume > 0;
    const pipelineRunning = this.pipeline.ctxState === "running" && this.pipeline.getOptions().volume > 0;
    return {
      sink: {
        muted: this.sink ? this.sink.muted : true,
        connected: this.sink ? this.sink.isConnected : false,
        srcObjectSet: this.sink ? this.sink.srcObject !== null : false,
      },
      exclusivity: {
        designated: this.designated,
        elementConfiguredAudible,
        pipelineRunning,
        bothAudible: elementConfiguredAudible && pipelineRunning,
      },
    };
  }

  /**
   * 诊断快照（window.__ls.dump 的 playback 段，D6）。只读，无副作用。
   * A1：发声元素（output）与解码 sink **分开命名**上报 —— 旧的 `elements: [sink, output]` 数组让下游
   * 取 `[0]` 拿到的恒是恒静音的 sink（会说谎的诊断）；现在结构上不存在“第 0 个元素”这种取法。
   */
  snapshot(): RemoteAudioHostSnapshot {
    const out = this.output;
    return {
      output: out
        ? { muted: out.muted, volume: out.volume, paused: out.paused, readyState: out.readyState, audioTracks: audioTrackCount(out.srcObject) }
        : null,
      sink: this.sink ? { muted: this.sink.muted, connected: this.sink.isConnected, srcObjectSet: this.sink.srcObject !== null } : null,
      pipeline: {
        active: this.pipeline.ctxState === "running",
        ctxState: this.pipeline.ctxState,
        volume: this.pipeline.getOptions().volume,
      },
      playback: {
        state: this.playbackState,
        error: this.playError,
        autoplayBlocked: this.autoplayBlocked,
        lastFallbackAt: this.lastFallbackAt,
        audibleVia: this.designated, // A3：裁决意图原样透传（≠ 物理推导，允许瞬态不一致）
        gainCapped: this.gainCapped, // A2：>100% 音量回落元素通路被钳到 100% —— 必须可诊断，不许静默
      },
    };
  }

  /** 状态订阅（UI 降级 chip 用）。返回取消函数。 */
  subscribe(listener: (state: RemoteAudioHostState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 释放全部资源（幂等）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWatching();
    this.pipeline.detach();
    this.releaseElement(this.sink, true);
    this.releaseElement(this.output, this.outputOwned);
    this.sink = null;
    this.output = null;
    this.outputOwned = false;
    this.stream = null;
    this.designated = "none";
    this.listeners.clear();
  }

  // ─── 内部：裁决与互斥 ────────────────────────────────────────────

  private ctxState(): CtxState {
    return readCtxState(this.pipeline.ctxState);
  }

  private elementState(): ElementState {
    const out = this.output;
    if (!this.stream || !out) return "absent";
    if (!out.paused) return "ready";
    if (this.playError !== null) return "blocked";
    return out.error ? "error" : "paused";
  }

  /** 全部状态跃迁的唯一入口：纯函数裁决 → 结构性互斥 → 事件（P3）。 */
  private reconcile(reason: string): void {
    const decision = decide(this.ctxState(), this.elementState(), this.prefs);
    this.designated = decision.audibleVia;
    this.gainCapped = decision.gainCapped;
    this.applyDecision(decision);
    console.log(`[RemoteAudioHost] audibleVia=${decision.audibleVia} reason=${decision.reason} trigger=${reason}`);
    this.emit();
  }

  /** 结构性互斥（C-09）：非指定通路必须被静音；gain 是裁决的纯函数。 */
  private applyDecision(decision: Decision): void {
    if (this.sink) {
      this.sink.muted = true;
      this.sink.volume = 0;
    }
    const out = this.output;
    if (!out) return;
    if (decision.audibleVia === "pipeline") {
      out.muted = true;
      out.volume = 0;
      this.pipeline.update({ volume: this.prefs.volume });
      return;
    }
    this.pipeline.update({ volume: 0 });
    this.pipeline.suspend();
    if (decision.audibleVia === "element") {
      out.muted = false;
      out.volume = clampElementVolume(this.prefs.volume);
      return;
    }
    out.muted = true;
    out.volume = 0;
  }

  // ─── 内部：元素与播放 ────────────────────────────────────────────

  /** 解绑远端流：清 srcObject、拆管线、停看门狗；元素保留（下次 setStream 幂等复用）。 */
  private teardownStream(): void {
    this.stopWatching();
    this.pipeline.detach();
    if (this.sink) this.sink.srcObject = null;
    if (this.output) this.output.srcObject = null;
    this.designated = "none";
    this.playbackState = "waiting-for-track";
    this.playError = null;
    this.emit();
  }

  private ensureElements(): void {
    this.sink ??= this.makeSink();
    if (!this.output) {
      this.output = this.makeOutput();
      this.outputOwned = this.output !== null;
    }
  }

  private bindStream(stream: MediaStream): void {
    if (this.sink) this.sink.srcObject = stream;
    if (this.output) this.output.srcObject = stream;
  }

  /** 元素始终 play：①解码连续性（C-12）②playbackState 上报。失败必须可见（D5 禁静默吞）。 */
  private ensurePlaying(): void {
    const out = this.output;
    if (!out || !out.paused) return;
    void this.playOutput();
  }

  private async playOutput(): Promise<void> {
    const out = this.output;
    if (!out) return;
    this.playbackState = "starting";
    this.playError = null;
    try {
      await out.play();
    } catch (err) {
      this.playbackState = "blocked";
      this.playError = err instanceof Error ? err.message : String(err);
      this.setAutoplayBlocked(true, this.playError);
      return;
    }
    if (this.disposed) return;
    this.playbackState = "playing";
    this.setAutoplayBlocked(false, null);
  }

  /** D5 可见降级的唯一收口：play()/resume() 被拒 → true；恢复 → false。禁止静默吞（X4）。 */
  private setAutoplayBlocked(blocked: boolean, detail: string | null): void {
    if (blocked === this.autoplayBlocked) {
      if (blocked) console.warn(`[RemoteAudioHost] 自动播放被拒: ${detail ?? "unknown"}`);
      this.emit();
      return;
    }
    this.autoplayBlocked = blocked;
    if (blocked) console.warn(`[RemoteAudioHost] 自动播放被拒，进入可见降级: ${detail ?? "unknown"}`);
    else console.log("[RemoteAudioHost] 发声已恢复，退出降级");
    this.emit();
  }

  private releaseElement(el: RemoteAudioMediaElement | null, owned: boolean): void {
    if (!el) return;
    el.srcObject = null;
    if (owned) el.remove();
  }

  private applySinkId(): void {
    const sinkId = this.prefs.sinkId;
    if (sinkId) applySinkRouting(this.pipeline, this.output, this.designated === "pipeline", sinkId);
  }

  // ─── 内部：存活看门狗（C-10）────────────────────────────────────

  private watchPipeline(): void {
    this.stopWatching();
    this.notRunningSince = null;
    this.cancelStateChange = this.pipeline.onStateChange(() => this.onProbe("statechange"));
    this.cancelProbe = this.clock.setInterval(() => this.onProbe("poll"), PROBE_INTERVAL_MS);
  }

  private stopWatching(): void {
    this.cancelStateChange?.();
    this.cancelStateChange = null;
    this.cancelProbe?.();
    this.cancelProbe = null;
    this.notRunningSince = null;
  }

  /** 双通道探针：statechange 即时接管；poll 判定失效持续一个探针周期后同 tick 接管。 */
  private onProbe(channel: "statechange" | "poll"): void {
    if (this.disposed || !this.stream) return;
    if (this.ctxState() === "running") {
      this.notRunningSince = null;
      return;
    }
    const now = this.clock.now();
    const since = this.notRunningSince ?? now;
    this.notRunningSince = since;
    if (this.designated !== "pipeline") return;
    if (channel === "statechange" || now - since >= PROBE_INTERVAL_MS) {
      this.fallbackToElement(channel);
    }
  }

  /** C-10：同 tick 元素接管（muted=false ∧ volume>0 ∧ play()），记录 lastFallbackAt。
   *  转移仍走 reconcile（纯函数 decide 在 ctx 失效时必然给出 element，不写死枚举）。 */
  private fallbackToElement(channel: string): void {
    this.lastFallbackAt = this.clock.now();
    console.warn(`[RemoteAudioHost] 管线失效(${channel})，元素通路同 tick 接管`);
    this.reconcile("pipeline-lost");
    this.ensurePlaying();
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn("[RemoteAudioHost] 状态订阅者抛错，已隔离:", err);
      }
    }
  }
}
