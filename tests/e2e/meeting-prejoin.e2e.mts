import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://localhost:5173";
const WS = process.env.E2E_WS ?? "ws://localhost:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");
const viewport = {
  width: Number(process.env.E2E_VIEWPORT_WIDTH ?? 1280),
  height: Number(process.env.E2E_VIEWPORT_HEIGHT ?? 720),
};
const artifactSuffix = process.env.E2E_ARTIFACT_SUFFIX ?? "";

test("meeting prejoin matches the ready state without layout shifts", async (t) => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  t.after(async () => { await browser.close(); });

  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport,
  });
  await context.addInitScript(({ token, ws }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: { userId: "prejoin", uniqId: "prejoin:e2e" } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "e2e-prejoin",
      userTheme: "light",
      userLanguage: "zh",
      serverMode: "custom",
      customServerUrl: ws,
      authToken: token,
      ablyKey: "",
      transferPriority: "p2p",
      version: "3.8.4",
      isNewUser: false,
    }));
  }, { token: TOKEN, ws: WS });

  const page = await context.newPage();
  await page.goto(`${SITE}/?room=e2e-prejoin#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 0, null, { timeout: 30_000 });
  await page.locator('button[aria-label="plus"]:visible').first().click();
  await page.getByRole("menuitem", { name: /创建会议/ }).click();

  // The ID is reserved by the real Go server as soon as the create dialog opens.
  await page.getByText("MEETING PASS", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("prejoin-mic-device").waitFor({ state: "visible" });
  await page.getByTestId("prejoin-camera-device").waitFor({ state: "visible" });
  await page.getByTestId("prejoin-ping").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("prejoin-mic-test").count(), 0, "microphone test button was removed");
  assert.equal(await page.getByTestId("prejoin-latency-test").count(), 0, "latency test button was removed");

  await page.waitForTimeout(350);
  await page.screenshot({ path: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-ready${artifactSuffix}.png`, fullPage: true });

  const layoutSnapshot = async () => ({
    boxes: await Promise.all([
      page.getByTestId("prejoin-mic-device").boundingBox(),
      page.getByTestId("prejoin-camera-device").boundingBox(),
      page.getByTestId("prejoin-mic-level").boundingBox(),
    ]),
    dialog: await page.locator('[role="dialog"]').boundingBox(),
  });
  const beforeInteraction = await layoutSnapshot();

  await page.getByRole("button", { name: "麦克风关闭" }).click();
  await page.getByRole("button", { name: "麦克风开启" }).waitFor({ state: "visible" });
  await page.getByTestId("prejoin-mic-level").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "摄像头关闭" }).click();
  await page.getByRole("button", { name: "摄像头开启" }).waitFor({ state: "visible" });
  await page.getByTestId("prejoin-camera-preview").waitFor({ state: "visible" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-media-on${artifactSuffix}.png`, fullPage: true });

  const afterInteraction = await layoutSnapshot();
  if (viewport.width >= 600) {
    beforeInteraction.boxes.forEach((before, index) => {
      const after = afterInteraction.boxes[index];
      assert.ok(before && after, `layout box ${index} should exist`);
      assert.ok(Math.abs(after.x - before.x) <= 1, `layout box ${index} moved horizontally`);
      assert.ok(Math.abs(after.width - before.width) <= 1, `layout box ${index} changed width`);
      assert.ok(Math.abs(after.height - before.height) <= 1, `layout box ${index} changed height`);
    });
    assert.ok(beforeInteraction.dialog && afterInteraction.dialog, "dialog should remain mounted");
    assert.ok(Math.abs(afterInteraction.dialog.x - beforeInteraction.dialog.x) <= 1, "dialog moved horizontally");
    assert.ok(Math.abs(afterInteraction.dialog.y - beforeInteraction.dialog.y) <= 1, "dialog layout moved vertically");
    assert.ok(Math.abs(afterInteraction.dialog.width - beforeInteraction.dialog.width) <= 1, "dialog width changed");
    assert.ok(Math.abs(afterInteraction.dialog.height - beforeInteraction.dialog.height) <= 1, "dialog height changed");
  }

  const contentMetrics = await page.locator('[role="dialog"]:visible .MuiDialogContent-root').evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert.equal(contentMetrics.overflowY, "auto", "content remains scrollable for narrow/mobile viewports");
  if (viewport.width >= 600) {
    assert.ok(contentMetrics.scrollHeight <= contentMetrics.clientHeight + 1, `ready dialog should fit without a scrollbar: ${JSON.stringify(contentMetrics)}`);
  } else {
    const pageMetrics = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(pageMetrics.scrollWidth, pageMetrics.innerWidth, "mobile prejoin has no horizontal overflow");
  }

  await page.getByLabel("会议名称").fill("Prejoin ready flow");
  await page.getByRole("button", { name: /开始会议/ }).click();
  await page.waitForURL(/#\/meeting\?room=\d{4}/, { timeout: 30_000 });
  await page.waitForSelector('[data-stage="in-meeting"], [data-stage="joining"]', { timeout: 30_000 });
  await page.getByText("Prejoin ready flow", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await page.screenshot({ path: `Harness/tasks/task-meeting-3-8-3-enterprise-readiness/artifacts/meeting-prejoin-entered${artifactSuffix}.png`, fullPage: true });
  assert.match(await page.url(), /#\/meeting\?room=\d{4}/);
});
