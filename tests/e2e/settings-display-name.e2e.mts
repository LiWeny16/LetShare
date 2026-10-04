import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://127.0.0.1:5173";
const WS = process.env.E2E_WS ?? "ws://127.0.0.1:8080/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

test("AC-002: global Settings saves the shared display name without replacing identity", async (t) => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const originalIdentity = {
    userId: "settings-name-e2e-user",
    userName: "旧显示名",
    userNameExplicit: true,
    uniqId: "stable-settings-name-id:browser",
  };
  await context.addInitScript(({ identity, ws, token }) => {
    if (!localStorage.getItem("memorableState")) {
      localStorage.setItem("memorableState", JSON.stringify({ memorable: identity }));
    }
    if (!localStorage.getItem("user_settings")) {
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: "setname",
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
    }
  }, { identity: originalIdentity, ws: WS, token: TOKEN });

  const page = await context.newPage();
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  await page.goto(`${SITE}/?room=setname#`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const settingsIcon = page.locator('svg[data-testid="SettingsIcon"]:visible').first();
  await settingsIcon.waitFor({ state: "visible", timeout: 30_000 });
  await settingsIcon.click();

  const nameField = page.getByTestId("settings-display-name");
  await nameField.waitFor({ state: "visible", timeout: 5_000 });
  assert.equal(await page.getByLabel("显示名称").count(), 1, "the Settings field has the contracted accessible label");
  await nameField.fill("设置里改的新名字");
  await nameField.press("Enter");

  await page.waitForFunction((name) => {
    const raw = localStorage.getItem("memorableState");
    if (!raw) return false;
    const identity = JSON.parse(raw).memorable;
    return identity?.userName === name && identity?.userNameExplicit === true;
  }, "设置里改的新名字");
  const savedIdentity = await page.evaluate(() => JSON.parse(localStorage.getItem("memorableState") ?? "{}").memorable);
  assert.equal(savedIdentity.uniqId, originalIdentity.uniqId, "renaming keeps the stable uniqId");

  await nameField.fill("失焦保存名字");
  await nameField.press("Tab");
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("memorableState");
    return raw && JSON.parse(raw).memorable?.userName === "失焦保存名字";
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText(/[:：]\s*失焦保存名字$/).waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('svg[data-testid="SettingsIcon"]:visible').first().click();
  const reloadedNameField = page.getByTestId("settings-display-name");
  await reloadedNameField.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await reloadedNameField.inputValue(), "失焦保存名字", "the edited name is shown after reload");
  const reloadedIdentity = await page.evaluate(() => JSON.parse(localStorage.getItem("memorableState") ?? "{}").memorable);
  assert.equal(reloadedIdentity.userName, "失焦保存名字");
  assert.equal(reloadedIdentity.uniqId, originalIdentity.uniqId);
});
