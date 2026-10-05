/**
 * 生产环境 E2E：证明「僵尸 Participant」回归已修复。
 *
 * 复现的真实故障（修复前）：
 *   - 接通方（bob）的上行发布 PC 因瞬时抖动 failed/closed；
 *   - 服务端 Participant.Close() 在 pc.Close() 返回错误时提前 return，
 *     forgetClosedParticipant 永不执行 → 房间 map 里留下 closed participant；
 *   - bob 重连时 handleMeetingJoin 的幂等判断命中僵尸直接 return，不重建参与者；
 *   - 结果：bob 的发布 offer 被「参与者已关闭」拒绝、订阅被绑到已停摆 fanout，
 *     永远收不到对端音频（单向静音），25s 恢复窗口耗尽后自动挂断。
 *
 * 本测试关闭 bob 的**发布** PC（不是下行订阅 PC —— 那是 AC-009 覆盖的另一种场景），
 * 然后断言：
 *   1. 服务端接受重连并重建参与者（bob 重新 publish，txBytes 继续递增）；
 *   2. bob 的下行音频恢复（rxBytes 继续递增，且远端音频轨 unmuted）；
 *   3. 通话不会在恢复窗口内自动挂断（两端的通话 UI 仍在）。
 *
 * 运行：node --import tsx --test --test-force-exit tests/e2e/call-prod-zombie.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const ROOM = "prode2e";

async function until(desc: string, cond: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting: ${desc}`);
}

test("生产环境：发布 PC 失效后参与者被重建，下行音频恢复且不自动挂断", async (t) => {
  const sentinel = await (await fetch(`${SITE}/version.json`, { cache: "no-store" })).json() as { v: string };
  console.log(`[diag] prod build = ${sentinel.v}`);

  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });
  t.after(async () => { await browser.close(); });

  async function newClient(name: string) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    await ctx.addInitScript((n: string) => {
      localStorage.setItem("ls_debug_stats", "1");
      const s = {
        roomId: "prode2e", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
        customServerUrl: "wss://ecs.letshare.fun/", authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
        ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
      };
      localStorage.setItem("user_settings", JSON.stringify(s));
      (window as unknown as { __clientName: string }).__clientName = n;
      // 捕获所有由本页创建的 PeerConnection，供定向失效注入。
      const captured: RTCPeerConnection[] = [];
      (window as unknown as { __callTestPeerConnections: RTCPeerConnection[] }).__callTestPeerConnections = captured;
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          captured.push(this);
        }
      } as unknown as typeof RTCPeerConnection;
    }, name);
    const page = await ctx.newPage();
    page.on("console", (msg) => console.log(`[${name}] ${msg.text()}`));
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto(`${SITE}/?room=${ROOM}`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 4000));
      const ok = await page.evaluate(() => {
        const hook = (window as unknown as { __LET_SHARE_E2E__?: { getState?: () => { isConnectedToServer?: boolean } } }).__LET_SHARE_E2E__;
        return hook?.getState?.().isConnectedToServer === true;
      }).catch(() => false);
      if (ok) break;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { ctx, page };
  }

  const alice = await newClient("alice");
  const bob = await newClient("bob");

  for (const page of [alice.page, bob.page]) {
    await until("用户卡片出现（发现对方）", async () => {
      return (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1;
    }, 60_000);
  }

  // 发起 + 接听
  await alice.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("语音通话按钮未找到");
    btn.click();
  });
  await until("bob 来电横幅出现", async () => {
    return (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1;
  }, 30_000);
  await bob.page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="接听"]') as HTMLButtonElement | null;
    if (!btn) throw new Error("接听按钮未找到");
    btn.click();
  });

  type Stats = { rxBytes: number; txBytes: number; fullDuplex: boolean; publishState: string | null; subscriberStates: string[]; remoteMuted: boolean[] };
  async function sample(page: import("playwright").Page): Promise<Stats> {
    return page.evaluate(async () => {
      const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
      const getDebug = (window as unknown as { __lsPc?: () => Record<string, unknown> }).__lsPc;
      if (!getStats || !getDebug) return { rxBytes: -1, txBytes: -1, fullDuplex: false, publishState: null, subscriberStates: [], remoteMuted: [] };
      const stats = await getStats();
      const debug = getDebug() as {
        publishState?: string | null;
        subscriberStates?: Array<{ state?: string }>;
        remoteAudioTracks?: Array<{ muted?: boolean }>;
      };
      let rxBytes = 0, txBytes = 0;
      for (const [, r] of stats) {
        if (r.type === "inbound-rtp" && r.kind === "audio") rxBytes += Number(r.bytesReceived ?? 0);
        if (r.type === "outbound-rtp" && r.kind === "audio") txBytes += Number(r.bytesSent ?? 0);
      }
      const subscriberStates = (debug.subscriberStates ?? []).map((s) => String(s.state ?? ""));
      const remoteMuted = (debug.remoteAudioTracks ?? []).map((t) => t.muted === true);
      return {
        rxBytes, txBytes,
        fullDuplex: debug.publishState === "connected"
          && subscriberStates.some((s) => s === "connected")
          && (debug.remoteAudioTracks ?? []).some((t) => t.muted === false),
        publishState: debug.publishState ?? null,
        subscriberStates, remoteMuted,
      };
    });
  }

  // ── 1. 建立双向音频 ───────────────────────────────────────────
  for (const [i, page] of [alice.page, bob.page].entries()) {
    await until(`client${i} SFU 双向音频建立`, async () => {
      const s = await sample(page);
      return s.fullDuplex && s.rxBytes > 0 && s.txBytes > 0;
    }, 90_000);
  }
  const beforeKill = await sample(bob.page);
  console.log(`[diag] bob 失效前: ${JSON.stringify(beforeKill)}`);

  // ── 2. 定向失效 bob 的**发布** PC（僵尸触发条件）─────────────────
  const publishIndex = await bob.page.evaluate(async () => {
    const connections = (window as unknown as { __callTestPeerConnections: RTCPeerConnection[] }).__callTestPeerConnections;
    const out: Array<{ index: number; outAudio: number; inAudio: number; state: string; localSdpType: string | null }> = [];
    for (const [index, connection] of connections.entries()) {
      const reports = await connection.getStats();
      let outAudio = 0;
      let inAudio = 0;
      for (const [, r] of reports) {
        if (r.type === "outbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) outAudio += Number(r.bytesSent ?? 0);
        if (r.type === "inbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) inAudio += Number(r.bytesReceived ?? 0);
      }
      out.push({ index, outAudio, inAudio, state: connection.connectionState, localSdpType: connection.localDescription?.type ?? null });
    }
    (window as unknown as { __pcInventory: unknown }).__pcInventory = out;
    // SFU publish PC: 有 outbound 音频且信令方向为 offer（我们主动 createOffer）
    const match = out.find((c) => c.outAudio > 0 && c.localSdpType === "offer");
    return match ? match.index : out.find((c) => c.outAudio > 0)?.index ?? -1;
  });
  const inventory = await bob.page.evaluate(() => (window as unknown as { __pcInventory: unknown }).__pcInventory);
  console.log(`[diag] bob PC inventory: ${JSON.stringify(inventory)}`);
  assert.ok(publishIndex >= 0, "找不到 bob 的发布 PC（outbound-rtp 音频连接）");
  console.log(`[diag] bob 发布 PC index = ${publishIndex}`);

  await bob.page.evaluate((index) => {
    const connection = (window as unknown as { __callTestPeerConnections: RTCPeerConnection[] }).__callTestPeerConnections[index]!;
    // Simulate a transient ICE failure, NOT a deliberate close().
    // callSfuSession maps publish-PC "closed" to hangup("error") by design, so
    // calling close() here would (correctly) end the call and never exercise
    // the zombie/rejoin path. A real network blip surfaces as "failed".
    //
    // The override must be temporary: permanently pinning connectionState to
    // "failed" prevents maybeActivate() from ever observing "connected", so
    // the session can never leave reconnecting even though the transport is
    // fine. Restore the real value after the event has been delivered.
    const proto = Object.getPrototypeOf(connection) as object;
    const realDescriptor = Object.getOwnPropertyDescriptor(proto, "connectionState")
      ?? Object.getOwnPropertyDescriptor(connection, "connectionState");
    const patched = connection as unknown as { connectionState: string };
    Object.defineProperty(patched, "connectionState", { configurable: true, value: "failed" });
    connection.dispatchEvent(new Event("connectionstatechange"));
    setTimeout(() => {
      if (realDescriptor) Object.defineProperty(connection, "connectionState", realDescriptor);
      else delete (connection as unknown as Record<string, unknown>).connectionState;
      connection.dispatchEvent(new Event("connectionstatechange"));
    }, 500);
  }, publishIndex);

  // 连续采样客户端状态机，定位恢复卡在哪一步。
  const trace: string[] = [];
  const traceStart = Date.now();
  const tracer = setInterval(async () => {
    try {
      const s = await sample(bob.page);
      const line = `${((Date.now() - traceStart) / 1000).toFixed(0)}s state=${JSON.stringify({ pub: s.publishState, subs: s.subscriberStates, muted: s.remoteMuted, rx: s.rxBytes, tx: s.txBytes })}`;
      if (trace[trace.length - 1] !== line) trace.push(line);
    } catch { /* page busy */ }
  }, 1500);
  t.after(() => clearInterval(tracer));

  // ── 3. 断言：参与者被重建 —— 上行恢复递增 ────────────────────────
  let recovered = true;
  try {
    await until("bob 上行发布在参与者重建后恢复", async () => {
      const s = await sample(bob.page);
      return s.publishState === "connected" && s.fullDuplex;
    }, 60_000);
  } catch (error) {
    recovered = false;
    console.log(`[diag] bob 状态机轨迹:\n${trace.join("\n")}`);
    throw error;
  } finally {
    clearInterval(tracer);
    if (recovered) console.log(`[diag] bob 状态机轨迹:\n${trace.join("\n")}`);
  }

  const t1 = await sample(bob.page);
  await new Promise((r) => setTimeout(r, 3000));
  const t2 = await sample(bob.page);
  console.log(`[diag] bob 恢复后: t1=${JSON.stringify(t1)} t2=${JSON.stringify(t2)}`);

  assert.ok(t2.txBytes > t1.txBytes, `bob 上行音频应持续递增（参与者已重建并重新发布）: ${t1.txBytes} → ${t2.txBytes}`);
  // 核心断言：僵尸会让下行永久静音 —— 这里必须恢复。
  assert.ok(t2.rxBytes > t1.rxBytes, `bob 下行音频应持续递增（订阅绑到活的 fanout）: ${t1.rxBytes} → ${t2.rxBytes}`);
  assert.ok(t2.fullDuplex, `bob 必须回到全双工（per-peer 订阅 connected + 远端轨 unmuted）: ${JSON.stringify(t2)}`);

  // ── 4. 断言：没有在 25s 恢复窗口内自动挂断 ───────────────────────
  // CallBar 的挂断按钮只有 Tooltip、没有 aria-label，因此以会话仍在（有 debug 钩子且
  // 仍有连接的 PC）作为「通话未结束」的判据。
  const callAlive = async (page: import("playwright").Page) =>
    page.evaluate(() => {
      const getDebug = (window as unknown as { __lsPc?: () => Record<string, unknown> }).__lsPc;
      if (!getDebug) return false;
      const debug = getDebug() as { publishState?: string | null };
      return Boolean(debug.publishState);
    });
  assert.ok(await callAlive(bob.page), "bob 的会话必须仍然存在（未自动挂断）");
  assert.ok(await callAlive(alice.page), "alice 的会话必须仍然存在（未自动挂断）");

  // 对端（alice）也必须还在收 bob 的音频
  const a1 = await sample(alice.page);
  await new Promise((r) => setTimeout(r, 3000));
  const a2 = await sample(alice.page);
  assert.ok(a2.rxBytes > a1.rxBytes, `alice 仍应收到 bob 的音频: ${a1.rxBytes} → ${a2.rxBytes}`);
  assert.ok(a2.fullDuplex, `alice 必须保持全双工: ${JSON.stringify(a2)}`);

  // 挂断收尾（Tooltip 按钮无 aria-label，用文本/图标容器定位）
  for (const page of [alice.page, bob.page]) {
    await page.evaluate(() => {
      const icons = Array.from(document.querySelectorAll("button"));
      const end = icons.find((b) => b.querySelector('svg[data-testid="CallEndIcon"]'));
      (end as HTMLButtonElement | undefined)?.click();
    }).catch(() => undefined);
  }
}, 300_000);
