/**
 * 通话视频采集与约束：分辨率/帧率档位、码率上限、编码器优先、背景模糊、
 * 自适应降级 —— 全部用浏览器原生能力（零体积），照抄 audioCapture.ts 的
 * "显式约束 + 首选设备 + 失败降级" 模式。
 *
 * 背景模糊（backgroundBlur）为 Chromium 118+ 桌面扩展约束；编码器偏好
 * （setCodecPreferences）与码率上限（sender.setParameters）在协商侧应用，
 * 见 callSession.ts。
 */

/** 视频分辨率/帧率档位（默认 720p30 = 现状值） */
export type VideoQualitySetting = "480p30" | "720p30" | "1080p30" | "720p60" | "1080p60";
/** 视频码率上限档位（kbps；auto=不设上限，浏览器内置拥塞控制自适应） */
export type VideoBitrateSetting = "auto" | "2000" | "1500" | "1000" | "750" | "500";
/** 视频编码器优先次序（协商前经 setCodecPreferences 生效；auto=浏览器自动挑） */
export type VideoCodecPrioritySetting = "auto" | "h264" | "vp8" | "vp9" | "av1";
/** 网络恶化时浏览器降级策略（约束 + 通话中 applyConstraints 可热更新） */
export type VideoDegradationSetting = "balanced" | "maintain-framerate" | "maintain-resolution";
/** 背景处理：off=原画 / blur=背景模糊（Chromium 扩展约束，不支持时降级链去掉） */
export type VideoBackgroundSetting = "off" | "blur";

export const VIDEO_QUALITY_TABLE: Record<VideoQualitySetting, { width: number; height: number; frameRate: number }> = {
  "480p30": { width: 854, height: 480, frameRate: 30 },
  "720p30": { width: 1280, height: 720, frameRate: 30 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30 },
  "720p60": { width: 1280, height: 720, frameRate: 60 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60 },
};

/** 档位下拉展示顺序（默认档放首位） */
export const VIDEO_QUALITY_OPTIONS: VideoQualitySetting[] = ["720p30", "1080p30", "480p30", "720p60", "1080p60"];
export const VIDEO_BITRATE_OPTIONS: VideoBitrateSetting[] = ["auto", "2000", "1500", "1000", "750", "500"];
export const VIDEO_CODEC_OPTIONS: VideoCodecPrioritySetting[] = ["auto", "h264", "vp8", "vp9", "av1"];
export const VIDEO_DEGRADATION_OPTIONS: VideoDegradationSetting[] = ["balanced", "maintain-framerate", "maintain-resolution"];

/** Chromium 扩展视频约束块（lib.dom 未收录 backgroundBlur，spec 未知成员会被拒绝 → 由降级链收回） */
const CHROMIUM_EXT_VIDEO_CONSTRAINTS = { backgroundBlur: true as unknown as boolean };

/**
 * 视频采集约束（扩展 lib.dom 的 MediaTrackConstraints）：
 * degradationPreference / backgroundBlur 为 Chromium 扩展成员，lib.dom 未收录，
 * 但规范与 Chromium 均接受 —— 浏览器侧按约束名识别，不支持的成员被拒绝（降级链处理）。
 */
export type ExtendedVideoConstraints = MediaTrackConstraints & {
  degradationPreference?: VideoDegradationSetting;
  backgroundBlur?: boolean;
};

/** 构建采集视频约束：分辨率/帧率 ideal + 首选摄像头 exact + 降级策略 + 可选背景模糊。 */
export function buildVideoConstraints(opts: {
  deviceId?: string;
  quality: VideoQualitySetting;
  degradation: VideoDegradationSetting;
  background: VideoBackgroundSetting;
}): ExtendedVideoConstraints {
  const q = VIDEO_QUALITY_TABLE[opts.quality];
  return {
    width: { ideal: q.width },
    height: { ideal: q.height },
    frameRate: { ideal: q.frameRate },
    // degradationPreference：网络差时浏览器自动降分辨率/帧率（Discord 同款自适应）
    degradationPreference: opts.degradation,
    ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
    ...(opts.background === "blur" ? CHROMIUM_EXT_VIDEO_CONSTRAINTS : {}),
  };
}

/**
 * 按优先次序重排编码器能力列表（setCodecPreferences 输入）。
 * - 只排序不删除（rtcpFeedback/rtx 附属 codec 必须保留，否则协商失败）
 * - 目标 codec 不在能力列表（浏览器不支持）→ 原样返回，浏览器自动协商
 * - auto → 返回 null，调用方跳过 setCodecPreferences
 * 纯函数。
 */
export function orderVideoCodecs<T extends { mimeType: string }>(priority: VideoCodecPrioritySetting, codecs: readonly T[]): T[] | null {
  if (priority === "auto" || codecs.length === 0) return null;
  const wanted = priority; // h264 / vp8 / vp9 / av1 单值匹配
  const preferred: T[] = [];
  const rest: T[] = [];
  for (const c of codecs) {
    const mt = c.mimeType?.toLowerCase() ?? "";
    if (mt.includes(wanted)) preferred.push(c);
    else rest.push(c);
  }
  return [...preferred, ...rest];
}

/** 枚举摄像头（label 为空 = 浏览器尚未授予摄像头权限，仍返回列表）。 */
export async function listVideoDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

export type VideoCaptureOpts = {
  deviceId?: string;
  quality: VideoQualitySetting;
  degradation: VideoDegradationSetting;
  background: VideoBackgroundSetting;
};

/**
 * 视频约束降级链（逐级去掉可能不被支持的高级约束，最多 4 级）：
 *   full → no-blur（非 Chromium/无 ML 分割）→ no-device（设备已拔出）→ fallback-720p（各浏览器均支持）
 * 纯函数：返回 (label, constraints) 列表，采集侧逐级尝试。
 */
export function buildVideoConstraintAttempts(opts: VideoCaptureOpts): Array<{ label: string; constraints: ExtendedVideoConstraints }> {
  const attempts: Array<{ label: string; constraints: ExtendedVideoConstraints }> = [
    { label: "full", constraints: buildVideoConstraints(opts) },
  ];
  if (opts.background === "blur") {
    attempts.push({ label: "no-blur", constraints: buildVideoConstraints({ ...opts, background: "off" }) });
  }
  if (opts.deviceId) {
    attempts.push({
      label: "no-device",
      constraints: buildVideoConstraints({ deviceId: undefined, quality: opts.quality, degradation: opts.degradation, background: "off" }),
    });
  }
  attempts.push({ label: "fallback-720p", constraints: { width: { ideal: 1280 }, height: { ideal: 720 } } });
  return attempts;
}

/**
 * 采集视频轨（换摄像头/背景/质量档用；通话发起走 share.tsx 的合并采集）。
 * 降级链见 buildVideoConstraintAttempts。
 * 成功后给视频轨设 contentHint="motion"（视频通话画面随人物运动，编码器选运动优先）。
 * 调用方负责停止不再使用的旧轨。
 */
export async function acquireCallVideo(opts: VideoCaptureOpts): Promise<MediaStream> {
  const attempts = buildVideoConstraintAttempts(opts);
  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: attempt.constraints });
      const track = stream.getVideoTracks()[0];
      if (track && "contentHint" in track) track.contentHint = "motion";
      if (attempt.label !== "full") {
        console.warn(`[Call] 视频采集经降级链生效（${attempt.label}）`);
      }
      return stream;
    } catch (err) {
      lastErr = err;
      console.warn(`[Call] 视频采集 ${attempt.label} 失败，尝试下一级:`, String((err as Error)?.name ?? err));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("video capture failed");
}