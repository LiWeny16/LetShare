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

/** 裁决域（= core/audio/remoteAudioDecision.AudibleVia）：宿主决定让谁发声。 */
export type DecisionAudibleVia = "pipeline" | "element" | "none";

/** 物理推导域 = 裁决域 + "unknown”（无可观察对象时无法推导）。 */
export type DerivedAudibleVia = DecisionAudibleVia | "unknown";

/** 元素的只读播放面（dump 原样输出；audioTracks=null 表示无可读取的 MediaStream）。 */
export type PlaybackElementDump = {
  muted: boolean;
  volume: number;
  paused: boolean;
  readyState: number;
  audioTracks: number | null;
};

/** 解码 sink 判据面（C-11/C-12）：恒静音、恒在 DOM、srcObject 非空；它永不发声。 */
export type PlaybackSinkDump = { muted: boolean; connected: boolean; srcObjectSet: boolean };

export type PlaybackDump = {
  /**
   * A1：**唯一发声元素**（= RemoteAudioHost 的 output；`audibleVia.decision === "element"` 指向的就是它）。
   * muted/volume/paused/readyState **只描述发声元素** —— 解码 sink 永不发声，不进此键。
   * 旧实现用 `elements: [sink, output]` 数组，下游取 `[0]` 拿到的是恒静音的 sink，诊断会说谎。
   */
  outputElement: PlaybackElementDump | null;
  /** 解码 sink（C-11/C-12 的断言对象）：显式命名，绝不与发声元素同列。null = 未建。 */
  sink: PlaybackSinkDump | null;
  /**
   * 发声通路的两个视角（A3：同名异义拆成命名空间，禁止当成同一个值读）：
   *  - `derived`  = **物理推导**：由发声元素/管线的真实布尔算出「此刻谁真的在响」（本文件 deriveAudibleVia）
   *  - `decision` = **裁决意图**：RemoteAudioHost.state.audibleVia 原样透传（宿主决定让谁发声）
   * 两者**允许瞬态不一致**（ctx 刚死、看门狗未响的那一拍：decision=pipeline 而 derived=none），
   * 这个不一致本身就是诊断线索（物理上已没人响，宿主还没裁决）。无 host 的调用方 decision=null。
   * 键名 `audibleVia` 保留自 CONFORMANCE C-23 点名的字段。
   */
  audibleVia: {
    /** 物理推导：此刻谁真的在响（看真实布尔，不看宿主意图）。 */
    derived: DerivedAudibleVia;
    /** 裁决意图：宿主决定让谁发声（host.state.audibleVia，非物理事实）。 */
    decision: DecisionAudibleVia | null;
  };
  ctxState: string | null;
  /** 管线“正在发声”（AudioContext running），不是旧的 isActive（ctx≠null）假象（F17）。 */
  pipelineActive: boolean | null;
  /** 双声（B2）取证的第二个原始布尔：与 pipelineActive 同时为 true = 双声事故。 */
  elementAudible: boolean | null;
  /** V3：播放状态（RemoteAudioHost 单一写者；原 callSfuSession.remoteAudioPlaybackState 的新家）。 */
  playbackState: string | null;
  playError: string | null;
  /** D5 可见降级：自动播放被拒（UI 据此常驻琥珀 chip）。 */
  autoplayBlocked: boolean | null;
  /** C-10：管线失效后元素接管的时间戳（毫秒）；从未回退为 null。 */
  lastFallbackAt: number | null;
  /**
   * A2：用户音量 >1 但走元素通路，增益被静默钳到 100%（可见降级，与 C-12b 同精神）。
   * `gainCapped === true` 且 `audibleVia.decision === "element"` ⇒ “我的 >100% 音量当前没生效”。无 host 为 null。
   */
  gainCapped: boolean | null;
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
  /** 发声元素（唯一可能发声的那个）。A1：禁止再用“元素列表第 0 个”取值（那是恒静音的 sink）。null = 尚无元素。 */
  output: PlaybackElementDump | null;
  /** 解码 sink（C-11/C-12）。null = 未建。 */
  sink: PlaybackSinkDump | null;
  pipeline: { active: boolean; ctxState: string | null; volume: number } | null;
  /** host 播放状态（可选；无 host 的调用方留空，字段降级为 null）。 */
  playback?:
    | {
        state: string;
        error: string | null;
        autoplayBlocked: boolean;
        lastFallbackAt: number | null;
        /** 裁决意图（RemoteAudioHost.state.audibleVia 原样透传，A3）。 */
        audibleVia: DecisionAudibleVia;
        /** A2：>100% 音量在元素通路被钳到 100%。 */
        gainCapped: boolean;
      }
    | null
    | undefined;
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
    playback: {
      outputElement: null,
      sink: null,
      audibleVia: { derived: "unknown", decision: null },
      ctxState: null,
      pipelineActive: null,
      elementAudible: null,
      playbackState: null,
      playError: null,
      autoplayBlocked: null,
      lastFallbackAt: null,
      gainCapped: null,
    },
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

/**
 * 发声元素是否真的在响（A1：只看发声元素 output，不看恒静音的解码 sink）。
 * 纯函数，供 dump 与单测共用。
 */
function elementAudible(el: PlaybackElementDump | null): boolean {
  return (
    el !== null &&
    el.audioTracks !== null &&
    el.audioTracks > 0 &&
    !el.muted &&
    el.volume > 0 &&
    !el.paused
  );
}

/** host 播放字段；无 host 的调用方整体降级为 null，而不是逐个字段伪造（保持“无观测”可见）。 */
function playbackFields(
  playback: PlaybackDumpInput["playback"],
): Pick<PlaybackDump, "playbackState" | "playError" | "autoplayBlocked" | "lastFallbackAt" | "gainCapped"> {
  return {
    playbackState: playback ? playback.state : null,
    playError: playback ? playback.error : null,
    autoplayBlocked: playback ? playback.autoplayBlocked : null,
    lastFallbackAt: playback ? playback.lastFallbackAt : null,
    gainCapped: playback ? playback.gainCapped : null,
  };
}

/** 由原始播放快照推导 dump 字段；纯函数，供 dump 与单测共用。 */
export function buildPlaybackDump(input: PlaybackDumpInput): PlaybackDump {
  // A1：发声判定只认**发声元素**（output）。绝不能取“元素列表第 0 个”：那个位置上是恒静音的 sink，
  // 用它推导会把“正在发声”误判成“全哑”（derived=none），与 muted/volume 说谎是同一个病根。
  const el = input.output;
  const audible = elementAudible(el);
  const pipelineAudible = input.pipeline !== null && input.pipeline.active && input.pipeline.volume > 0;
  return {
    outputElement: el ? { ...el } : null,
    sink: input.sink ? { ...input.sink } : null,
    audibleVia: {
      derived: deriveAudibleVia(audible, pipelineAudible, input.pipeline !== null || el !== null || input.sink !== null),
      decision: input.playback ? input.playback.audibleVia : null,
    },
    ctxState: input.pipeline ? input.pipeline.ctxState : null,
    pipelineActive: input.pipeline ? input.pipeline.active : null,
    elementAudible: el !== null ? audible : null,
    ...playbackFields(input.playback),
  };
}

/**
 * **物理推导**（A3）：只看元素/管线的真实布尔，回答“此刻谁真的在响”。
 * 与 RemoteAudioHost.state.audibleVia（**裁决意图**：宿主决定让谁发声）同名异义、刻意并存：
 * 两者允许瞬态不一致（ctx 刚死、看门狗未响的窗口里裁决=pipeline 而这里=none）。
 * 读法：derived 回答“物理上谁在响”，decision 回答“宿主打算让谁响”，差值即降级窗口。
 */
function deriveAudibleVia(elementIsAudible: boolean, pipelineAudible: boolean, observable: boolean): DerivedAudibleVia {
  // 两条通路同时可发声 = 双声事故（B2）；枚举只保留一条，双声由两个原始布尔值暴露。
  if (pipelineAudible) return "pipeline";
  if (elementIsAudible) return "element";
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
