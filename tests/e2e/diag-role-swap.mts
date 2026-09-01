/**
 * 决定性实验：静音方向是否跟随 caller 角色。
 * 场景：bob（接听过 alice 的人）反向发起 → alice 接听。
 * 观察：alice（这次是 callee）是否反过来听不到 bob（caller）。
 * 若静音跟随 caller → 问题在 offer 创建侧编码路径；
 * 若静音跟随某台"机器"→ 环境因素。
 */
import { chromium } from "playwright";

const SITE = "https://letshare.fun";
const ROOM = "prode2ev5";

async function until(cond: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout");
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

async function client(name: string) {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  await ctx.addInitScript(() => {
    localStorage.setItem("ls_force_relay", "1");
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "prode2ev5", userTheme: "light", userLanguage: "zh-CN", serverMode: "custom",
      customServerUrl: "wss://ecs.letshare.fun/", authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
      ablyKey: "", transferPriority: "p2p", version: "0", isNewUser: false,
    }));
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror:`, e.message));
  for (let a = 0; a < 4; a++) {
    await page.goto(`${SITE}/?room=${ROOM}#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await until(async () => (await page.getByRole("button", { name: /语音通话|Voice call/i }).count()) >= 1, 45_000);
      break;
    } catch { await page.reload().catch(() => undefined); }
  }
  return { ctx, page };
}

const alice = await client("alice");
const bob = await client("bob");

async function sample(page: import("playwright").Page): Promise<{ rxE: number; txE: number }> {
  return page.evaluate(async () => {
    const getStats = (window as unknown as { __lsCallStats?: () => Promise<Map<string, Record<string, unknown>>> }).__lsCallStats;
    if (!getStats) return { rxE: -1, txE: -1 };
    const stats = await getStats();
    let rxE = -1, txE = -1;
    for (const [, r] of stats) {
      if (r.type === "inbound-rtp" && r.kind === "audio") rxE = Number(r.totalAudioEnergy ?? 0);
      if (r.type === "outbound-rtp" && r.kind === "audio") txE = Number(r.totalAudioEnergy ?? 0);
    }
    return { rxE, txE };
  });
}

async function hangupAll(page: import("playwright").Page) {
  await page.evaluate(() => {
    // 挂断按钮无 aria-label：经 CallEndIcon 图标反查按钮（来电横幅已消失，唯一 CallEndIcon 即挂断）
    const svg = document.querySelector('svg[data-testid="CallEndIcon"]');
    (svg?.closest("button") as HTMLButtonElement | null)?.click();
  }).catch(() => undefined);
}

console.log("=== 第一通：alice 发起，bob 接听 ===");
await alice.page.evaluate(() => (document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement).click());
await until(async () => (await bob.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1, 40_000);
await bob.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 10_000));
console.log("[call1 alice-caller]", JSON.stringify(await sample(alice.page)));
console.log("[call1 bob-callee]", JSON.stringify(await sample(bob.page)));

console.log("=== 第二通：互换，bob 发起，alice 接听 ===");
await hangupAll(alice.page);
await hangupAll(bob.page);
await new Promise((r) => setTimeout(r, 2500));

await bob.page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="语音通话"]') as HTMLButtonElement | null;
  if (!btn) throw new Error("bob 侧语音按钮未找到");
  btn.click();
});
await until(async () => (await alice.page.getByRole("button", { name: /接听|Accept/i }).count()) >= 1, 40_000);
await alice.page.evaluate(() => (document.querySelector('button[aria-label="接听"]') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 10_000));
console.log("[call2 bob-caller]", JSON.stringify(await sample(bob.page)));
console.log("[call2 alice-callee]", JSON.stringify(await sample(alice.page)));

await browser.close();
process.exit(0);
