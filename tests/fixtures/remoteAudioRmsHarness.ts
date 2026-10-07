/**
 * 真机可听性验收（C-12 / 红队第 8 条）的浏览器侧 harness。
 *
 * 为什么必须真机：本项目历史上"模拟状态断言"证明不了声音真的存在（B1 的教训：状态看着正常、
 * 实际全哑）。这里用**真实**浏览器 + **真实** Web Audio：振荡器 → MediaStreamAudioDestinationNode
 * = 一条真流 → RemoteAudioHost（真 <audio> 元素 / 真 RemoteAudioPipeline）→ 发声路径上挂
 * AnalyserNode 采 RMS。
 *
 * 两条通路的发声路径 tap（实测结论，勿凭直觉改）：
 *  - 管线：RemoteAudioPipeline.tapOutput()（进 destination 之前的节点）。**能**反映 gain：
 *    gain=0 时采样必须为 0 —— 这是"静音必须真静音"的真机负控。
 *  - 元素：HTMLMediaElement.captureStream() → MediaStreamSource。能证明元素在解码并输出音频
 *    信号（无流负控 = 0）。已实测：Chromium 的 createMediaElementSource 对 srcObject 型元素恒 0
 *    （不可用作 tap）；captureStream 不反映 muted/volume（muted 后仍采到信号）——
 *    因此"用户耳朵处电平"由 host 的结构性互斥（muted/volume 单一写者）+ 单测保证，本文件不伪装。
 *
 * 由 tests/remoteAudioAudible.test.ts 经 esbuild 打包后注入 Playwright 页面执行。
 */
import { RemoteAudioHost } from "../../src/core/audio/remoteAudioHost";
import { RemoteAudioPipeline } from "../../src/core/audio/remoteAudioPipeline";

const liveContexts: AudioContext[] = [];
const liveHosts: RemoteAudioHost[] = [];

/** 音频设备/图预热：实测全新 AudioContext 首 ~500ms AnalyserNode 恒 0，必须先等再采。 */
const WARMUP_MS = 800;

function warmUp(ms = WARMUP_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAudioElement(): HTMLAudioElement {
  const el = document.createElement("audio");
  el.autoplay = true;
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
}

/** 真流：440Hz 正弦（幅度可调）经 MediaStreamAudioDestinationNode 输出；幅度 0 = 静默负控源。 */
function makeOscillatorStream(amplitude = 0.5): MediaStream {
  const ctx = new AudioContext();
  liveContexts.push(ctx);
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const gain = ctx.createGain();
  gain.gain.value = amplitude;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  return dest.stream;
}

/** 采 N 帧时域 RMS 取最大值（真实 AnalyserNode 数据，非模拟）。 */
async function sampleRms(analyser: AnalyserNode, frames = 25): Promise<number> {
  const buf = new Float32Array(analyser.fftSize);
  let max = 0;
  for (let i = 0; i < frames; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let j = 0; j < buf.length; j += 1) sum += buf[j] * buf[j];
    max = Math.max(max, Math.sqrt(sum / buf.length));
  }
  return max;
}

export type RmsResult = {
  maxRms: number;
  negativeRms: number;
  audibleVia: string;
  element: { muted: boolean; volume: number; paused: boolean };
  ctxState: string | null;
};

function elementView(el: HTMLAudioElement): { muted: boolean; volume: number; paused: boolean } {
  return { muted: el.muted, volume: el.volume, paused: el.paused };
}

/** 元素通路：tap = 发声元素的 captureStream（必须在绑流后 capture，实测顺序敏感）；
 *  负控 = 同一 tap 在源轨 stop() 后必须采到 0。 */
export async function runElementPath(): Promise<RmsResult> {
  const output = createAudioElement();
  const host = new RemoteAudioHost(new RemoteAudioPipeline(() => null), {
    createSinkElement: createAudioElement,
    createOutputElement: () => output,
  });
  liveHosts.push(host);
  const stream = makeOscillatorStream(0.5);
  host.setStream(stream);
  if (output.paused) await output.play();
  const tapCtx = new AudioContext();
  liveContexts.push(tapCtx);
  await tapCtx.resume();
  const captured = output.captureStream();
  const source = tapCtx.createMediaStreamSource(captured);
  const analyser = tapCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  analyser.connect(tapCtx.destination);
  await warmUp();
  const maxRms = await sampleRms(analyser);
  // 负控：源轨 stop → 发声路径必须真的静音（证明 tap 反映信号有无，不是常数）
  for (const track of stream.getAudioTracks()) track.stop();
  await warmUp(400);
  const negativeRms = await sampleRms(analyser, 10);
  return {
    maxRms,
    negativeRms,
    audibleVia: host.state.audibleVia,
    element: elementView(output),
    ctxState: null,
  };
}

/** 管线通路：tap = RemoteAudioPipeline.tapOutput()；负控 = gain=0 后同一 tap 必须采到 0。 */
export async function runPipelinePath(): Promise<RmsResult> {
  const pipeline = new RemoteAudioPipeline();
  const output = createAudioElement();
  const host = new RemoteAudioHost(pipeline, {
    createSinkElement: createAudioElement,
    createOutputElement: () => output,
  });
  liveHosts.push(host);
  host.setStream(makeOscillatorStream());
  if (pipeline.ctxState !== "running") await host.unlock(); // 自动播放策略下补一次恢复
  await warmUp();
  const tap = pipeline.tapOutput();
  if (!tap) throw new Error("管线未建图，无法在发声路径上采样");
  const maxRms = await sampleRms(tap.analyser);
  host.setPrefs({ volume: 0, clarity: true, widen: false }); // gain=0：发声路径必须真的静音
  await warmUp(300);
  const negativeRms = await sampleRms(tap.analyser, 10);
  host.setPrefs({ volume: 1, clarity: true, widen: false });
  return {
    maxRms,
    negativeRms,
    audibleVia: host.state.audibleVia,
    element: elementView(output),
    ctxState: pipeline.ctxState,
  };
}

(globalThis as unknown as { __rmsHarness: unknown }).__rmsHarness = {
  runElementPath,
  runPipelinePath,
  cleanup: () => {
    for (const host of liveHosts) host.dispose();
    for (const ctx of liveContexts) void ctx.close();
  },
};
