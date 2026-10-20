/**
 * 远端音频发声通路裁决（V3 · 远端音频播放权威）。
 *
 * 为什么存在：远端音频历史上有 3 个可能的主人（会话 sink / UI <audio> / Web Audio 管线），
 * 靠"谁先声明接管"协商且声明后永不复查（DIVERGENCE.md F12 / F17）→ 线上双声（B2）与永久静音（B1）。
 * 本模块只回答一个问题：**此刻该由谁发声**。它必须是纯函数（可穷举、可对拍、可回归），
 * 一切 DOM / AudioContext 写操作都在 RemoteAudioHost 内部（单一写者，P6）。
 *
 * 契约（CONFORMANCE.md C-08/C-09）：
 *  - C-08：只要存在可播放内容（elementState !== "absent"），裁决永不为 "none" —— 任何时刻恰有一条通路被指定。
 *  - C-09：被指定之外的另一条通路必须被结构性静音（元素：muted ∧ volume=0；管线：gain=0 ∧ suspend）。
 */

/** 发声通路：唯一状态枚举。"none" 仅表示"无内容可播"，不代表"两条通路都坏了"。 */
export type AudibleVia = "pipeline" | "element" | "none";

/** AudioContext 状态域：含 iOS 的 interrupted 与"无管线"的 n/a。 */
export type CtxState = "running" | "suspended" | "interrupted" | "closed" | "n/a";

/**
 * 元素通路状态：
 *  - ready:    正在播放
 *  - paused:   已绑定流但未在播（尚未 play / play 在途）
 *  - blocked:  play() 被自动播放策略拒绝（D5 可见降级）
 *  - error:    元素媒体错误（decode 失败等）
 *  - absent:   元素通路不存在（无元素或无流）
 */
export type ElementState = "ready" | "paused" | "blocked" | "error" | "absent";

/** 播放偏好。volume 0..2（>1 只能经管线增益；元素路径硬钳 0..1）。 */
export type AudioPrefs = {
  volume: number;
  clarity: boolean;
  widen: boolean;
  sinkId?: string | undefined;
};

/** 裁决结果。reason 供事件/诊断（P3/P7：跃迁必须带原因）；gainCapped = 用户音量 >1 但管线不可用。 */
export type Decision = {
  audibleVia: AudibleVia;
  reason: "no-content" | "pipeline-live" | "pipeline-down";
  gainCapped: boolean;
};

/** 增益音量上限（>1 = Web Audio 增益增强）。纯函数。 */
export const SPEAKER_VOLUME_MAX = 2;

/** 增益音量钳制 0..2（非法值回退 1 = 100%）。纯函数。 */
export function clampSpeakerVolume(v: number): number {
  return Math.min(SPEAKER_VOLUME_MAX, Math.max(0, Number.isFinite(v) ? v : 1));
}

/** 元素音量钳制 0..1（HTMLMediaElement.volume 的硬约束）。纯函数。 */
export function clampElementVolume(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));
}

/** AudioContext.state（或无管线 null）→ 决策域。纯函数。 */
export function readCtxState(state: AudioContextState | null): CtxState {
  return state === null ? "n/a" : state;
}

/** 原始偏好输入（UI 直接把 settingsStore 的值丢进来，不做类型假设）。 */
export type RawAudioPrefsInput = {
  volume: unknown;
  clarity: unknown;
  widen: unknown;
  sinkId: unknown;
};

/** 任意原始输入 → 合法 AudioPrefs。纯函数（默认值 + 钳制集中在此，杜绝两处各写一份）。 */
export function toAudioPrefs(raw: RawAudioPrefsInput): AudioPrefs {
  return {
    volume: clampSpeakerVolume(typeof raw.volume === "number" ? raw.volume : 1),
    clarity: raw.clarity !== false,
    widen: raw.widen === true,
    sinkId: typeof raw.sinkId === "string" && raw.sinkId.length > 0 ? raw.sinkId : undefined,
  };
}

/**
 * 转移函数（**纯函数**：只读参数、不触 DOM/时钟/全局、同一输入恒等输出）。
 *
 * 规则（顺序即优先级）：
 *  1. 元素通路不存在（无内容）→ "none"：没有任何内容可播，不是"两条通路都坏"。
 *  2. ctxState === "running" → "pipeline"：管线活着时优先（增益/清晰度/展宽只在管线里有）。
 *  3. 其余（suspended / interrupted / closed / n/a）→ "element"：C-10 的回退方向，任何时刻至少一条通路被指定。
 */
export function decide(ctxState: CtxState, elementState: ElementState, prefs: AudioPrefs): Decision {
  if (elementState === "absent") {
    return { audibleVia: "none", reason: "no-content", gainCapped: false };
  }
  if (ctxState === "running") {
    return { audibleVia: "pipeline", reason: "pipeline-live", gainCapped: false };
  }
  return { audibleVia: "element", reason: "pipeline-down", gainCapped: clampSpeakerVolume(prefs.volume) > 1 };
}
