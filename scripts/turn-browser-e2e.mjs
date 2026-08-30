/**
 * 真实浏览器 ICE E2E —— 用 Chrome + CDP 做一次真实 RTCPeerConnection ICE gather，
 * 验证 coturn 的 TURN 中继能给出 relay 候选（通话能否出声的真正判据）。
 *
 * 流程：
 *   1. 启动 chrome headless + remote-debugging-port
 *   2. 通过 CDP 在真实浏览器上下文执行 RTCPeerConnection(iceServers=[turn...])
 *   3. 等待 ICE gather 完成，读取 candidate-type 是否有 relay
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEBUG_PORT = 9222;

async function fetchCred() {
  const r = await fetch("https://ecs.letshare.fun/api/turn-credentials");
  const d = await r.json();
  return d.ice_servers;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

// 通过 CDP 发送命令
async function cdpCommand(wsUrl, id, method, params) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.send(JSON.stringify({ id, method, params }));
  const resp = await new Promise((res, rej) => {
    ws.onmessage = (e) => res(JSON.parse(e.data));
    ws.onerror = (e) => rej(e);
  });
  ws.close();
  return resp;
}

async function main() {
  const iceServers = await fetchCred();
  console.log(`[凭据] ${iceServers[0].username}`);

  // 启动 chrome
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  // 等 chrome 起来拿 websocket url
  let target = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const page = list.find((t) => t.type === "page");
      if (page) { target = page; break; }
    } catch {}
  }
  if (!target) { console.error("❌ 无法连接 Chrome CDP"); chrome.kill(); process.exit(1); }

  const wsUrl = target.webSocketDebuggerUrl;

  // 执行 ICE gather
  const script = `
    (async () => {
      const iceServers = ${JSON.stringify(iceServers)};
      const pc = new RTCPeerConnection({ iceServers });
      const candidates = [];
      let done = false;
      const donePromise = new Promise((resolve) => {
        pc.addEventListener("icecandidate", (e) => {
          if (e.candidate) {
            candidates.push(e.candidate.candidate);
          } else {
            done = true; resolve();
          }
        });
      });
      pc.createDataChannel("probe");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // 最多等 8 秒
      const timeout = await Promise.race([
        donePromise,
        new Promise((r) => setTimeout(() => r("timeout"), 8000)),
      ]);
      const types = candidates.map(c => {
        const m = c.match(/typ ([a-z]+)/);
        return m ? m[1] : "unknown";
      });
      const relay = candidates.filter(c => c.includes(" typ relay "));
      pc.close();
      return JSON.stringify({
        done: timeout !== "timeout",
        totalCandidates: candidates.length,
        types,
        hasRelay: relay.length > 0,
        relayCount: relay.length,
        sample: candidates.slice(0, 5),
      });
    })()
  `;

  // 用 Runtime.evaluate（awaitPromise）
  const firstCmd = cdpCommand(wsUrl, 1, "Runtime.enable", {});
  await firstCmd;

  const evalRes = await cdpCommand(wsUrl, 2, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
  });

  chrome.kill();
  console.log("[ICE 结果]", evalRes.result?.result?.value ?? JSON.stringify(evalRes));
  const result = JSON.parse(evalRes.result?.result?.value ?? "{}");

  if (result.hasRelay) {
    console.log(`\n🎉 真实浏览器 ICE E2E 通过！拿到 ${result.relayCount} 个 relay 候选`);
    console.log(`   → TURN relay 真正可用，跨网通话可出声`);
    process.exit(0);
  } else {
    console.log(`\n🔴 未拿到 relay 候选。候选类型: ${JSON.stringify(result.types)}`);
    console.log(`   候选样例: ${JSON.stringify(result.sample)}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });