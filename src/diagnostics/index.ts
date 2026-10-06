/**
 * 会议侧诊断出口（window.__ls.dump）。
 *
 * 为什么存在：上一次线上断连只能让用户手动打开浏览器控制台粘代码排查；
 * V0 的目标是让「播放/订阅/连接」状态可以被一行命令取回，且生产环境无需开关。
 * 本模块只汇聚各模块的公开只读状态：不写任何业务状态、不改变任何控制流。
 */

/** 单条远端轨道的快照。kind 取自 MediaStreamTrack；source 保留会议层语义（screen=共享屏幕）。 */
type MeetingTrackDump = {
  uniqId: string;
  kind: "audio" | "video";
  source: "audio" | "video" | "screen";
  trackId: string | null;
  readyState: string | null;
  muted: boolean | null;
  enabled: boolean | null;
};

export type MeetingDump = {
  roomId: string | null;
  stage: string;
  remoteTracks: MeetingTrackDump[];
  subscribers: Array<{ publisherId: string; connectionState: string }>;
  publishPcState: string | null;
};

export type PlaybackDump = {
  audioElements: Array<{ muted: boolean; volume: number; paused: boolean; readyState: number; audioTracks: number | null }>;
  /** 单一枚举只表达一条通路；双声取证看 pipelineActive 与 elementAudible 两个原始布尔值。 */
  audibleVia: "pipeline" | "element" | "none" | "unknown";
  ctxState: string | null;
  pipelineActive: boolean | null;
  elementAudible: boolean | null;
};

export type ConnectionDump = {
  phaseOrState: string | null;
  reconnectAttempt: number | null;
};

export type LSDump = {
  meeting: MeetingDump;
  playback: PlaybackDump;
  connection: ConnectionDump;
};

export type DiagnosticsProvider = {
  meeting?: () => MeetingDump | null;
  playback?: () => PlaybackDump | null;
  connection?: () => ConnectionDump | null;
};

export type PlaybackDumpInput = {
  /** 元素快照即 dump 原样输出；audioTracks=null 表示无可读取的 MediaStream。 */
  elements: PlaybackDump["audioElements"];
  pipeline: { active: boolean; ctxState: string | null; volume: number } | null;
};

const providers = new Set<DiagnosticsProvider>();

/** 注册只读快照提供者；返回注销函数。提供者必须无副作用，dump 只是读取。 */
export function registerDiagnosticsProvider(provider: DiagnosticsProvider): () => void {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
}

/** 幂等、无副作用、不 throw：任何提供者抛错都只降级为 warn，不阻断其余字段。 */
export function dump(): LSDump {
  const result: LSDump = {
    meeting: { roomId: null, stage: "unknown", remoteTracks: [], subscribers: [], publishPcState: null },
    playback: { audioElements: [], audibleVia: "unknown", ctxState: null, pipelineActive: null, elementAudible: null },
    connection: { phaseOrState: null, reconnectAttempt: null },
  };
  const filled = { meeting: false, playback: false, connection: false };
  for (const provider of Array.from(providers)) {
    if (!filled.meeting && provider.meeting) {
      const meeting = safeCall("meeting", provider.meeting);
      if (meeting) {
        result.meeting = meeting;
        filled.meeting = true;
      }
    }
    if (!filled.playback && provider.playback) {
      const playback = safeCall("playback", provider.playback);
      if (playback) {
        result.playback = playback;
        filled.playback = true;
      }
    }
    if (!filled.connection && provider.connection) {
      const connection = safeCall("connection", provider.connection);
      if (connection) {
        result.connection = connection;
        filled.connection = true;
      }
    }
  }
  return result;
}

/** 挂载 window.__ls（生产可用、无开关）。可重复调用。 */
export function installDiagnostics(): void {
  if (typeof window === "undefined") return;
  window.__ls = { dump };
}

/** 由原始播放快照推导 dump 字段；纯函数，供 dump 与单测共用。 */
export function buildPlaybackDump(input: PlaybackDumpInput): PlaybackDump {
  const elementAudible = input.elements.some(
    (el) => el.audioTracks !== null && el.audioTracks > 0 && !el.muted && el.volume > 0 && !el.paused,
  );
  const pipelineAudible = input.pipeline !== null && input.pipeline.active && input.pipeline.volume > 0;
  return {
    audioElements: input.elements.map((el) => ({ ...el })),
    audibleVia: deriveAudibleVia(elementAudible, pipelineAudible, input.pipeline !== null || input.elements.length > 0),
    ctxState: input.pipeline ? input.pipeline.ctxState : null,
    pipelineActive: input.pipeline ? input.pipeline.active : null,
    elementAudible: input.elements.length > 0 ? elementAudible : null,
  };
}

function deriveAudibleVia(elementAudible: boolean, pipelineAudible: boolean, observable: boolean): PlaybackDump["audibleVia"] {
  // 两条通路同时可发声 = 双声事故（B2）；枚举只保留一条，双声由两个原始布尔值暴露。
  if (pipelineAudible) return "pipeline";
  if (elementAudible) return "element";
  return observable ? "none" : "unknown";
}

function safeCall<T>(section: string, fn: () => T | null): T | null {
  try {
    return fn();
  } catch (err) {
    console.warn(`[diagnostics] ${section} 快照读取失败，本段降级为空:`, err);
    return null;
  }
}

declare global {
  interface Window {
    __ls?: { dump: () => LSDump };
  }
}
