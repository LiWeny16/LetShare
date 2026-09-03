/**
 * 远端音频播放管线（Web Audio）单测：
 *  - clampSpeakerVolume 钳制
 *  - 注入 fake AudioContext：建图顺序/节点类型/音量/开关拓扑重建/多声道旁路
 *  - 无 AudioContext 环境 attach 返回 false（元素路径兜底不崩）
 *
 * 运行：node --import tsx --test tests/remoteAudioPipeline.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  RemoteAudioPipeline,
  clampSpeakerVolume,
  SPEAKER_VOLUME_MAX,
} from "../src/app/libs/call/remoteAudioPipeline";

// ─── Fake AudioContext / 节点 ───────────────────────────────────────

type FakeNode = {
  kind: string;
  param?: Record<string, { value: number }>;
  connections: FakeNode[];
  disconnectCalls: number;
};

function makeNode(kind: string, params: Record<string, number> = {}): FakeNode & AudioNode {
  const node: FakeNode = {
    kind,
    param: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { value: v }])),
    connections: [],
    disconnectCalls: 0,
  };
  return Object.assign(node, {
    // AudioParam 统一提供（管线会写 frequency/gain/Q/delayTime/threshold 等）
    frequency: { value: 0 },
    gain: { value: 0 },
    Q: { value: 0 },
    delayTime: { value: 0 },
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    connect: (target: FakeNode & AudioNode) => { node.connections.push(target); },
    disconnect: () => { node.disconnectCalls += 1; },
    channelCount: 1,
    channelCountMode: "max",
  }) as unknown as FakeNode & AudioNode;
}

function makeFakeCtx(opts: { channelCount?: number; suspended?: boolean } = {}) {
  const nodes: (FakeNode & AudioNode)[] = [];
  let source: (FakeNode & AudioNode) | null = null;
  const ctx = {
    state: opts.suspended ? "suspended" : "running",
    destination: makeNode("destination"),
    resumeCalls: 0,
    closeCalls: 0,
    async resume() { this.resumeCalls += 1; this.state = "running"; },
    async close() { this.closeCalls += 1; },
    createMediaStreamSource() {
      source = makeNode("source");
      source.channelCount = opts.channelCount ?? 1;
      nodes.push(source);
      return source;
    },
    createGain: () => { const n = makeNode("gain"); nodes.push(n); return n; },
    createBiquadFilter: () => { const n = makeNode("biquad"); nodes.push(n); return n; },
    createChannelSplitter: () => { const n = makeNode("splitter"); nodes.push(n); return n; },
    createDelay: () => { const n = makeNode("delay", { delayTime: 0 }); nodes.push(n); return n; },
    createChannelMerger: () => { const n = makeNode("merger"); nodes.push(n); return n; },
    createDynamicsCompressor: () => { const n = makeNode("compressor"); nodes.push(n); return n; },
  };
  return { ctx, get source() { return source; }, nodes };
}

function makeFakeStream(): MediaStream {
  return { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
}

/** 以 source 为根的连接图遍历（不含 source 自身），返回按链序排列的节点 kind。 */
function chainKinds(source: FakeNode & AudioNode): string[] {
  const out: string[] = [];
  const walk = (n: FakeNode & AudioNode): void => {
    for (const c of n.connections) {
      out.push(c.kind);
      walk(c);
    }
  };
  walk(source);
  return out;
}

// ─── Tests ──────────────────────────────────────────────────────────

test("clampSpeakerVolume: 0..2 钳制，非法值回退 1", () => {
  assert.equal(SPEAKER_VOLUME_MAX, 2);
  assert.equal(clampSpeakerVolume(1.5), 1.5);      // >100% 合法
  assert.equal(clampSpeakerVolume(2.5), 2);         // 超上限钳制
  assert.equal(clampSpeakerVolume(-1), 0);
  assert.equal(clampSpeakerVolume(Number.NaN), 1);
  assert.equal(clampSpeakerVolume(Number.POSITIVE_INFINITY), 1); // 非有限数 = 非法 → 回退 1
});

test("管线建图: clarity on + widen off → source→highpass→shelf→gain→comp→upmix(双声道)→dest", () => {
  const fake = makeFakeCtx();
  const pipeline = new RemoteAudioPipeline(() => fake.ctx as unknown as AudioContext);
  assert.equal(pipeline.attach(makeFakeStream(), { volume: 1.2, clarity: true, widen: false }), true);
  assert.equal(pipeline.isActive, true);

  const kinds = chainKinds(fake.source!);
  // [highpass, shelf, gain(volume), compressor, upmix(gain, 双声道), destination]
  assert.deepEqual(kinds, ["biquad", "biquad", "gain", "compressor", "gain", "destination"]);
  // 滤波参数
  const biquads = fake.nodes.filter((n) => n.kind === "biquad");
  assert.equal(biquads[0]!.frequency.value, 100);   // 高通 100Hz
  assert.equal(biquads[1]!.frequency.value, 2800);  // 搁架 2.8k
  assert.equal(biquads[1]!.gain.value, 3);          // +3dB
  // 音量 1.2 → gain
  const gain = fake.nodes.find((n) => n.kind === "gain")!;
  assert.equal(gain.gain.value, 1.2);
  // 末端强制双声道上混（消灭"只有左声道"）：compressor 下游的 gain 节点显式 2 声道输出
  const comp = fake.nodes.find((n) => n.kind === "compressor")!;
  const upmix = (comp as unknown as { connections: (FakeNode & AudioNode)[] }).connections[0]!;
  assert.equal(upmix.kind, "gain");
  assert.equal(upmix.channelCount, 2, "末端上混节点须强制双声道");
  assert.equal(upmix.channelCountMode, "explicit", "双声道上混须为 explicit");
  pipeline.detach();
  assert.equal(pipeline.isActive, false);
});

test("管线建图: widen on + 单声道 → 展宽子图（L 干声 / R 延迟）插入 gain 前，双端都有信号源", () => {
  const fake = makeFakeCtx({ channelCount: 1 });
  const pipeline = new RemoteAudioPipeline(() => fake.ctx as unknown as AudioContext);
  assert.equal(pipeline.attach(makeFakeStream(), { volume: 1, clarity: false, widen: true }), true);

  const kinds = chainKinds(fake.source!);
  // clarity off → source 直连 shelf（biquad）；widen on → shelf→splitter，merger → gain → comp → upmix → dest
  assert.ok(kinds.includes("splitter") && kinds.includes("delay") && kinds.includes("merger"));
  assert.equal(kinds.at(-1), "destination");
  const delay = fake.nodes.find((n) => n.kind === "delay")!;
  assert.ok(delay.delayTime.value > 0, "Haas 延迟应 >0（15ms）");
  // 展宽双路都有信号源：merger 两个输入分别接到 干声(L) 与 delay(R)，杜绝"只有左声道"
  const merger = fake.nodes.find((n) => n.kind === "merger")!;
  const mConn = (merger as unknown as { connections: unknown }).connections;
  void mConn; // merger 是被连接对象，输入侧由 splitter/delay 主动 connect
  const splitter = fake.nodes.find((n) => n.kind === "splitter")!;
  const splitterOuts = (splitter as unknown as { connections: (FakeNode & AudioNode)[] }).connections;
  assert.ok(splitterOuts.some((n) => n.kind === "merger"), "splitter 干声路须接 merger(左)");
  assert.ok(splitterOuts.some((n) => n.kind === "delay"), "splitter 须接 delay(右路)");
  pipeline.detach();
});

test("管线建图: widen on + 多声道（stereo）→ 自动旁路展宽，不产生 splitter/merger", () => {
  const fake = makeFakeCtx({ channelCount: 2 });
  const pipeline = new RemoteAudioPipeline(() => fake.ctx as unknown as AudioContext);
  assert.equal(pipeline.attach(makeFakeStream(), { volume: 1, clarity: true, widen: true }), true);

  const kinds = chainKinds(fake.source!);
  assert.ok(!kinds.includes("splitter"), "多声道流不应走 Haas 展宽");
  assert.ok(!kinds.includes("merger"));
  pipeline.detach();
});

test("拓扑切换: update({widen:true}) 重建图为展宽拓扑；音量热更即时生效", () => {
  const fake = makeFakeCtx({ channelCount: 1 });
  const pipeline = new RemoteAudioPipeline(() => fake.ctx as unknown as AudioContext);
  pipeline.attach(makeFakeStream(), { volume: 1, clarity: true, widen: false });
  assert.ok(!chainKinds(fake.source!).includes("splitter"));

  pipeline.update({ widen: true, volume: 1.8 });
  assert.ok(chainKinds(fake.source!).includes("splitter"), "开启展宽应重建图");
  // 音量热更即时生效（无需重建）
  const gain = fake.nodes.find((n) => n.kind === "gain")!;
  assert.equal(gain.gain.value, 1.8);
  pipeline.detach();
});

test("无 AudioContext 环境: attach 返回 false 不抛（元素路径兜底）", () => {
  // 不注入工厂 → 默认工厂在 Node（window undefined）返回 null
  const pipeline = new RemoteAudioPipeline(() => null);
  assert.equal(pipeline.attach(makeFakeStream()), false);
  assert.equal(pipeline.isActive, false);
  pipeline.update({ volume: 2 }); // 无图时 no-op 不抛
  pipeline.detach();
});

test("suspended ctx: attach 时补 resume（自动播放策略兜底）", () => {
  const { ctx } = makeFakeCtx({ suspended: true });
  const pipeline = new RemoteAudioPipeline(() => ctx as unknown as AudioContext);
  pipeline.attach(makeFakeStream());
  assert.ok((ctx as unknown as { resumeCalls: number }).resumeCalls >= 1);
  pipeline.detach();
});