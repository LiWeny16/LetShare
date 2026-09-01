/**
 * 通话音频采集：显式 3A 约束 + 首选麦克风 + 输入电平计量。
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

/** 合并首选麦克风的完整音频约束（preferredMicId 为空 → 纯基础约束，供视频合并采集路径复用） */
export function mergedAudioConstraints(preferredMicId?: string): MediaTrackConstraints {
  return {
    ...BASE_AUDIO_CONSTRAINTS,
    ...(preferredMicId ? { deviceId: { exact: preferredMicId } } : {}),
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
 * 调用方负责停止返回 stream 的 tracks。
 */
export async function acquireCallAudio(
  preferredMicId?: string,
  contentHint: AudioContentHint = "speech",
): Promise<MediaStream> {
  if (preferredMicId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: mergedAudioConstraints(preferredMicId) });
      applyContentHint(stream, contentHint);
      return stream;
    } catch (err) {
      console.warn("[Call] 首选麦克风采集失败（可能已拔出），降级为系统默认重试:", err);
    }
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: BASE_AUDIO_CONSTRAINTS });
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
