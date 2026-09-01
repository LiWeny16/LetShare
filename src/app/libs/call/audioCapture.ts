/**
 * 通话音频采集：显式 3A 约束 + 首选麦克风 + 输入电平计量 + 远端说话检测。
 *
 * 背景：此前通话用 getUserMedia({ audio: true }) 走浏览器默认（无设备选择、
 * 无显式处理开关），远端偶发"声音很小"。此处显式声明回声消除/噪声抑制/
 * 自动增益（3A），并支持按设置选择首选麦克风、设置 track.contentHint
 * 引导 Opus 编码模式选择。
 */

/** 音频内容倾向：speech=人声优化（默认），music=音乐模式（Opus 编码随之切换） */
export type AudioContentHint = "speech" | "music";

/** 通话音频基础约束：3A 显式声明，不依赖浏览器默认值 */
export const BASE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,   // 3A 之一：回声消除（显式声明，不依赖浏览器默认）
  noiseSuppression: true,   // 3A 之一：噪声抑制
  autoGainControl: true,    // 3A 之一：自动增益（治"远场麦声音小"）
  sampleRate: { ideal: 48000 },
};

/** 3A 微调项：回声消除引擎选择 + 噪声抑制开关（缺省 = 基础约束行为） */
export type AudioAecOptions = {
  /** 回声消除引擎：browser=浏览器 AEC3（默认），system=OS 级 AEC（不支持的浏览器按 spec 忽略该约束） */
  echoCancelType?: "browser" | "system";
  /** 浏览器噪声抑制开关（false = 保真/音乐场景） */
  noiseSuppression?: boolean;
};

/** 合并首选麦克风 + 3A 微调项的完整音频约束（preferredMicId/opts 均可省略，向后兼容单参调用） */
export function mergedAudioConstraints(preferredMicId?: string, opts?: AudioAecOptions): MediaTrackConstraints {
  return {
    echoCancellation: true,   // 3A 之一：回声消除常开（引擎由 echoCancelType 细分）
    autoGainControl: true,    // 3A 之一：自动增益常开（治"远场麦声音小"）
    noiseSuppression: opts?.noiseSuppression ?? true, // 3A 之一：噪声抑制可关（音乐保真/端侧 RNNoise 预留）
    sampleRate: { ideal: 48000 },
    ...(preferredMicId ? { deviceId: { exact: preferredMicId } } : {}),
    // echoCancellationType 为 Chromium 扩展约束（lib.dom 未收录）：不支持的浏览器按 spec 忽略未知约束 → 安全
    ...(opts?.echoCancelType === "system" ? { echoCancellationType: "system" as const } : {}),
  };
}

/**
 * 枚举音频设备，按 input/output 分组。
 * label 为空时表示浏览器尚未授予麦克风权限（正常现象），仍返回列表。
 */
export async function listAudioDevices(): Promise<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: devices.filter((d) => d.kind === "audioinput"),
    speakers: devices.filter((d) => d.kind === "audiooutput"),
  };
}

/**
 * 采集通话音频（纯音频路径）。
 * - 有首选麦克风：deviceId exact 采集；失败（设备已拔出等）→ 降级系统默认重试一次
 * - 成功后给每个音频 track 设 contentHint（提升 Opus 编码模式选择）
 * - opts（回声消除引擎/降噪开关）在主路径与降级路径同样生效
 * 调用方负责停止返回 stream 的 tracks。
 */
export async function acquireCallAudio(
  preferredMicId?: string,
  contentHint: AudioContentHint = "speech",
  opts?: AudioAecOptions,
): Promise<MediaStream> {
  if (preferredMicId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: mergedAudioConstraints(preferredMicId, opts) });
      applyContentHint(stream, contentHint);
      return stream;
    } catch (err) {
      console.warn("[Call] 首选麦克风采集失败（可能已拔出），降级为系统默认重试:", err);
    }
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: mergedAudioConstraints(undefined, opts) });
  applyContentHint(stream, contentHint);
  return stream;
}

/** 给流内所有音频 track 设置 contentHint。 */
function applyContentHint(stream: MediaStream, contentHint: AudioContentHint): void {
  for (const track of stream.getAudioTracks()) {
    track.contentHint = contentHint;
  }
}

/**
 * 创建麦克风输入电平计量器：AudioContext + AnalyserNode(fftSize=512) 每帧算 RMS，
 * 归一到 0..1 回调 onLevel（level*4 clamp，覆盖正常说话的动态范围）。
 * 返回清理函数：取消 rAF、断开节点、关闭 AudioContext。
 */
export function createInputLevelMeter(stream: MediaStream, onLevel: (level01: number) => void): () => void {
  const ctx = new AudioContext();
  // AudioContext 可能处于 suspended（自动播放策略等）：尝试 resume，失败不抛
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { /* resume 失败不影响计量 */ });
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  let rafId = 0;
  const tick = (): void => {
    // 先排下一帧再算本次：onLevel 内触发清理时 rafId 仍指向未来帧，cancel 才有效
    rafId = requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // 原始 RMS 多落在 0..0.25，*4 拉满动态范围后 clamp 到 0..1
    onLevel(Math.min(1, rms * 4));
  };
  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      // 节点已断开时忽略
    }
    void ctx.close().catch(() => { /* 已关闭时忽略 */ });
  };
}

/** 远端说话检测器句柄：setStream 切换/清除检测目标流，stop 释放全部资源（均幂等）。 */
export type RemoteSpeakingDetector = {
  setStream(s: MediaStream | null): void;
  stop(): void;
};

/** 说话判定阈值：RMS 高于 ON 开启、低于 OFF 关闭（中间滞回，避免临界抖动） */
const SPEAKING_RMS_ON = 0.025;
const SPEAKING_RMS_OFF = 0.012;
/** 采样周期（毫秒）：~120ms 足够捕捉人声包络，CPU 开销可忽略 */
const SPEAKING_TICK_MS = 120;

/**
 * 远端说话检测：AnalyserNode RMS + 滞回，仅状态翻转时回调；不碰媒体数据内容。
 * - 惰性创建 AudioContext（首次 setStream 带有效流时），默认采样率即可
 * - AnalyserNode(fftSize=512) + setInterval(~120ms) 算时域 RMS
 * - 滞回：RMS > 0.025 开、< 0.012 关，中间保持原状态；只在翻转时调 onSpeaking
 * - setStream：旧 source disconnect、新 source connect（stream 变化/挂断传 null，
 *   传 null 时同时清定时器并复位说话状态——若此前在说话会回调一次 false）
 * - stop：clearInterval、close ctx、清引用；幂等
 */
export function createRemoteSpeakingDetector(onSpeaking: (speaking: boolean) => void): RemoteSpeakingDetector {
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  // 显式标注 ArrayBuffer 变体：WebAudio API（getFloatTimeDomainData）要求非 SharedArrayBuffer 缓冲
  let buf: Float32Array<ArrayBuffer> | null = null;
  let speaking = false;

  /** 拆除当前检测图（断开 source/analyser），不动 AudioContext 与定时器。 */
  const teardownGraph = (): void => {
    if (source) {
      try { source.disconnect(); } catch { /* 已断开时忽略 */ }
      source = null;
    }
    if (analyser) {
      try { analyser.disconnect(); } catch { /* 已断开时忽略 */ }
      analyser = null;
    }
    buf = null;
  };

  /** 复位说话状态（翻转到关时回调一次，保证 UI 环熄灭）。 */
  const resetSpeaking = (): void => {
    if (speaking) {
      speaking = false;
      onSpeaking(false);
    }
  };

  const evaluate = (): void => {
    if (!analyser || !buf) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // 滞回：开态需跌破 OFF 才关，关态需越过 ON 才开
    const next = speaking ? rms > SPEAKING_RMS_OFF : rms > SPEAKING_RMS_ON;
    if (next !== speaking) {
      speaking = next;
      onSpeaking(speaking);
    }
  };

  return {
    setStream(stream) {
      teardownGraph();
      if (!stream || stream.getAudioTracks().length === 0) {
        // 空流/挂断：停定时器 + 复位说话状态（环熄灭）
        if (timer != null) {
          clearInterval(timer);
          timer = null;
        }
        resetSpeaking();
        return;
      }
      if (!ctx) {
        ctx = new AudioContext();
        // AudioContext 可能处于 suspended（自动播放策略等）：尝试 resume，失败不抛
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => { /* resume 失败不影响检测 */ });
        }
      }
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      if (timer == null) timer = setInterval(evaluate, SPEAKING_TICK_MS);
    },
    stop() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      teardownGraph();
      resetSpeaking();
      if (ctx) {
        void ctx.close().catch(() => { /* 已关闭时忽略 */ });
        ctx = null;
      }
    },
  };
}
