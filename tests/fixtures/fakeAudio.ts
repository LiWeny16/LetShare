/**
 * V3 · RemoteAudioHost 单测的假元素 / 假管线 / 虚拟时钟（零 DOM、零真实 sleep）。
 *
 * 为什么独立成文件：C-08/C-09/C-10/C-11/C-12、A1（诊断不许说谎）、A2（gainCapped）等多组断言
 * 共用同一套构造器，避免每个测试文件各写一份（重复实现会漂移）；同时让 tests/remoteAudioHost.test.ts
 * 保持在 STANDARDS 的单文件 ≤400 行内。
 *
 * 假元素的 play() 同步把 paused 置 false（模拟"已在播"），reject 行为模拟自动播放被拒（D5）。
 */
import type { Clock } from "../../src/core/audio/remoteAudioClock";
import { RemoteAudioHost, type AudioPipelinePort, type RemoteAudioMediaElement } from "../../src/core/audio/remoteAudioHost";

// ─── 假元素 / 假管线 / 虚拟时钟 ────────────────────────────────────

export type FakeElement = Omit<RemoteAudioMediaElement, "paused" | "isConnected"> & {
  paused: boolean;
  isConnected: boolean;
  playCalls: number;
  behavior: "resolve" | "reject";
};

export function makeElement(behavior: "resolve" | "reject" = "resolve", paused = true): FakeElement {
  const el: FakeElement = {
    muted: false,
    volume: 1,
    srcObject: null,
    paused,
    readyState: 0,
    error: null,
    isConnected: true,
    playCalls: 0,
    behavior,
    play() {
      el.playCalls += 1;
      if (el.behavior === "reject") return Promise.reject(new Error("play() blocked by autoplay policy"));
      el.paused = false;
      return Promise.resolve();
    },
    remove() {
      el.isConnected = false;
    },
  };
  return el;
}

export type FakePipeline = AudioPipelinePort & {
  ctx: AudioContextState | null;
  attachCalls: number;
  detachCalls: number;
  suspendCalls: number;
  resumeCalls: number;
  updates: Array<{ volume?: number; clarity?: boolean; widen?: boolean }>;
  listeners: Array<(state: AudioContextState) => void>;
  resumeResult: boolean;
  emit(): void;
};

export function makePipeline(ctx: AudioContextState | null = "running", resumeResult = true): FakePipeline {
  const pipeline: FakePipeline = {
    ctx,
    attachCalls: 0,
    detachCalls: 0,
    suspendCalls: 0,
    resumeCalls: 0,
    updates: [],
    listeners: [],
    resumeResult,
    get ctxState() {
      return pipeline.ctx;
    },
    attach() {
      pipeline.attachCalls += 1;
      return true;
    },
    update(opts) {
      pipeline.updates.push(opts);
    },
    async resume() {
      pipeline.resumeCalls += 1;
      if (pipeline.resumeResult) pipeline.ctx = "running";
      return pipeline.resumeResult;
    },
    suspend() {
      pipeline.suspendCalls += 1;
    },
    detach() {
      pipeline.detachCalls += 1;
    },
    async setSinkId() {
      return true;
    },
    getOptions() {
      return { volume: 1, clarity: true, widen: false };
    },
    onStateChange(listener) {
      pipeline.listeners.push(listener);
      return () => {
        pipeline.listeners = pipeline.listeners.filter((fn) => fn !== listener);
      };
    },
    emit() {
      for (const listener of pipeline.listeners) listener(pipeline.ctx ?? "closed");
    },
  };
  return pipeline;
}

export function makeFakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { fn: () => void; intervalMs: number; nextAt: number }>();
  const clock: Clock = {
    now: () => now,
    setInterval(fn: () => void, intervalMs: number) {
      const id = ++seq;
      timers.set(id, { fn, intervalMs, nextAt: now + intervalMs });
      return () => {
        timers.delete(id);
      };
    },
  };
  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      const due = Array.from(timers.values()).filter((t) => t.nextAt <= target).sort((a, b) => a.nextAt - b.nextAt)[0];
      if (!due) break;
      now = due.nextAt;
      due.nextAt += due.intervalMs;
      due.fn();
    }
    now = target;
  };
  return { clock, advance };
}

export function makeStream(audioTracks = 1): MediaStream {
  const tracks = Array.from({ length: audioTracks }, (_unused, index) => ({ id: `audio-${index}`, kind: "audio" }));
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
    addTrack: () => undefined,
  } as unknown as MediaStream;
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

export function makeHost(pipeline: FakePipeline, clock: Clock, output: FakeElement = makeElement(), sink = makeElement()) {
  return {
    host: new RemoteAudioHost(pipeline, {
      clock,
      createSinkElement: () => sink,
      createOutputElement: () => output,
    }),
    sink,
    output,
  };
}
