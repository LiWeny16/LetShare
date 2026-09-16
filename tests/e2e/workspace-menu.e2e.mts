import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://127.0.0.1:5173";
const WS = process.env.E2E_WS ?? "ws://127.0.0.1:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

test("workspace quick menu keeps only the three useful entries", async (t) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(({ ws, token }) => {
    localStorage.setItem("memorableState", JSON.stringify({ memorable: {
      userId: "menu-ux",
      userName: "菜单验收",
      userNameExplicit: true,
      uniqId: "menu-ux:menu-e2e",
    } }));
    localStorage.setItem("user_settings", JSON.stringify({
      roomId: "menu-e2e",
      userTheme: "light",
      userLanguage: "zh-CN",
      serverMode: "custom",
      customServerUrl: ws,
      authToken: token,
      ablyKey: "",
      transferPriority: "p2p",
      version: "0",
      isNewUser: false,
    }));
  }, { ws: WS, token: TOKEN });

  const page = await context.newPage();
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  await page.goto(`${SITE}/?room=menu-e2e#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('button[aria-label="plus"]:visible').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('button[aria-label="plus"]:visible').click();

  const menu = page.locator('[role="menu"]:visible').first();
  await menu.waitFor({ state: "visible" });
  const items = menu.getByRole("menuitem");
  assert.equal(await items.count(), 3);
  const menuText = (await menu.innerText()).replace(/\s+/g, " ");
  assert.match(menuText, /创建会议/);
  assert.match(menuText, /加入会议/);
  assert.match(menuText, /下载管理/);
  assert.doesNotMatch(menuText, /即时屏幕共享/);

  await page.waitForTimeout(350);
  const bounds = await page.locator(".MuiMenu-paper:visible").first().boundingBox();
  await page.screenshot({ path: "temp-images/workspace-menu-redesign.png", fullPage: false });
  assert.ok(bounds && bounds.width >= 290 && bounds.width <= 350, `unexpected menu bounds: ${JSON.stringify(bounds)}`);
});
