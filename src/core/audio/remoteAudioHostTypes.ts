/**
 * RemoteAudioHost 的公开类型域（V3）。类型与实现分离，便于单测用假元素/假管线/假时钟
 * 在无 DOM 环境下穷举裁决（C-08 属性测试），也便于 diagnostics 结构化复用同一份快照。
 */

import type { Clock } from "./remoteAudioClock";
import type { AudibleVia, CtxState } from "./remoteAudioDecision";

/** host 需要的管线能力端口；生产注入 RemoteAudioPipeline，单测注入假管线。 */
export type AudioPipelinePort = {
  attach(stream: MediaStream, opts: { volume: number; clarity: boolean; widen: boolean }): boolean;
  update(opts: { volume?: number; clarity?: boolean; widen?: boolean }): void;
  /** resolve(true) = ctx 已 running；失败 resolve(false) 并自行 warn（禁止静默吞）。 */
  resume(): Promise<boolean>;
  suspend(): void;
  detach(): void;
  setSinkId(deviceId: string): Promise<boolean>;
  readonly ctxState: AudioContextState | null;
  getOptions(): { volume: number; clarity: boolean; widen: boolean };
  onStateChange(listener: (state: AudioContextState) => void): () => void;
};

/** host 接触的最小元素面（HTMLAudioElement 天然满足；单测用假元素即可，无需 DOM）。 */
export type RemoteAudioMediaElement = {
  muted: boolean;
  volume: number;
  srcObject: MediaProvider | null;
  readonly paused: boolean;
  readonly readyState: number;
  readonly error: unknown;
  play(): Promise<void>;
  remove(): void;
  readonly isConnected: boolean;
  setSinkId?: (deviceId: string) => Promise<void>;
};

export type PlaybackState = "waiting-for-track" | "starting" | "playing" | "blocked";

export type RemoteAudioHostState = {
  /**
   * **裁决意图**（不是物理事实）：宿主决定让谁发声，唯一判据。
   *
   * 与 `diagnostics.PlaybackDump.audibleVia.derived`（**物理推导**：由发声元素/管线的真实布尔算出
   * “此刻谁真的在响”）是**同名异义的两个值**，刻意并存、不合并：两者允许瞬态不一致
   * （ctx 刚死、看门狗还没响的那一拍里，本值 = pipeline 而推导 = none），这个不一致本身就是诊断线索。
   * 读诊断时请分清「宿主想让谁响」（本值 / dump 的 `.decision`）与「现在真的谁在响」（dump 的 `.derived`）。
   */
  readonly audibleVia: AudibleVia;
  readonly ctxState: CtxState;
  readonly lastFallbackAt: number | null;
  readonly autoplayBlocked: boolean;
  readonly playbackState: PlaybackState;
  readonly playError: string | null;
  /**
   * 用户音量 >1 但管线不可用：元素路径只能到 100%（可见的降级信号）。
   * A2：已暴露到 `window.__ls.dump().playback.gainCapped`，禁止只留在内存里静默钳制。
   */
  readonly gainCapped: boolean;
};

export type RemoteAudioHostInvariants = {
  /** C-11/C-12：解码 sink 永远不参与发声，且始终在 DOM 里、srcObject 非空。 */
  sink: RemoteAudioSinkSnapshot;
  /** C-08/C-09：恰一条通路被指定；另一条被结构性静音。 */
  exclusivity: {
    designated: AudibleVia;
    elementConfiguredAudible: boolean;
    pipelineRunning: boolean;
    bothAudible: boolean;
  };
};

/** 元素的只读播放面（dump 原样输出；audioTracks=null 表示无可读取的 MediaStream）。 */
export type RemoteAudioElementSnapshot = {
  muted: boolean;
  volume: number;
  paused: boolean;
  readyState: number;
  audioTracks: number | null;
};

/** 解码 sink 判据面（C-11/C-12）：恒静音、恒在 DOM、srcObject 非空；它永不发声。 */
export type RemoteAudioSinkSnapshot = { muted: boolean; connected: boolean; srcObjectSet: boolean };

/** 与 diagnostics 的 buildPlaybackDump 输入同构（单一快照来源，D6 不另造一套）。 */
export type RemoteAudioHostSnapshot = {
  /**
   * **唯一发声元素**（= host 的 output；`audibleVia === "element"` 指向的就是它）。
   * A1：解码 sink 永不发声，单独放 `sink` 键 —— 不再有 `elements` 数组，
   * 结构上杜绝“取第 0 个元素”把恒静音的 sink 当成发声元素上报的说谎式诊断。
   */
  output: RemoteAudioElementSnapshot | null;
  /** 解码 sink（C-11/C-12 断言对象）。 */
  sink: RemoteAudioSinkSnapshot | null;
  pipeline: { active: boolean; ctxState: string | null; volume: number } | null;
  playback: {
    state: string;
    error: string | null;
    autoplayBlocked: boolean;
    lastFallbackAt: number | null;
    /** 裁决意图（= 本文件 RemoteAudioHostState.audibleVia）：见那里的同名异义说明（A3）。 */
    audibleVia: AudibleVia;
    /** A2：用户音量 >1 但走元素通路，增益被钳到 100%。 */
    gainCapped: boolean;
  };
};

export type RemoteAudioHostOptions = {
  clock?: Clock | undefined;
  createSinkElement?: (() => RemoteAudioMediaElement | null) | undefined;
  createOutputElement?: (() => RemoteAudioMediaElement | null) | undefined;
};
