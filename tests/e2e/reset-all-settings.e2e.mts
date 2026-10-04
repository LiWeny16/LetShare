import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.E2E_SITE ?? "http://127.0.0.1:5173";
const WS = process.env.E2E_WS ?? "wss://ecs.letshare.fun/";
const TOKEN = createHash("sha256").update("sever_auth_123").digest("hex");

test("AC-001: Reset All restores defaults and replaces the previous identity", async (t) => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const previousIdentity = {
    userId: "reset-settings-old-user",
    userName: "旧的显示名称",
    userNameExplicit: true,
    uniqId: "reset-settings-old-user:old-id",
  };
  await context.addInitScript(({ identity, ws, token }) => {
    if (!sessionStorage.getItem("reset-settings-e2e-seeded")) {
      localStorage.setItem("user_settings", JSON.stringify({
        roomId: "rstset1",
        userTheme: "dark",
        userLanguage: "zh",
        serverMode: "custom",
        customServerUrl: ws,
        authToken: token,
        ablyKey: "old-ably-key",
        transferPriority: "server",
        micDeviceId: "old-microphone",
        speakerDeviceId: "old-speaker",
        speakerVolume: 1.8,
        videoDeviceId: "old-camera",
        meetingCameraDefaultOn: true,
        meetingMicrophoneDefaultOn: true,
        version: "0",
        isNewUser: false,
      }));
      localStorage.setItem("memorableState", JSON.stringify({ memorable: identity }));
      localStorage.setItem("countryCode", "+86");
      localStorage.setItem("phoneNumber", "12345678");
      localStorage.setItem("payNowName", "Old Payee");
      localStorage.setItem("ls_bundle", "max-compat");
      localStorage.setItem("ls_force_relay", "1");
      localStorage.setItem("ls_debug_stats", "1");
      localStorage.setItem("ls_turn_api", "https://old-turn.example");
      localStorage.setItem("user-created-content-marker", "preserve");
      sessionStorage.setItem("reset-settings-e2e-seeded", "true");
    }
  }, { identity: previousIdentity, ws: WS, token: TOKEN });

  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  await page.goto(SITE + "/?room=rstset1#", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const displayNameField = page.getByTestId("settings-display-name");
  await page.waitForFunction(() => !document.body.innerText.includes("Preparing your sharing room"), null, { timeout: 30_000 });
  if (!(await displayNameField.isVisible().catch(() => false))) {
    await page.locator('svg[data-testid="SettingsIcon"]:visible').first().click();
  }
  const settingsDialog = page.getByRole("dialog").filter({ has: displayNameField });
  await settingsDialog.waitFor({ state: "visible", timeout: 10_000 });
  await settingsDialog.locator('svg[data-testid="SettingsIcon"]').click();

  const resetButton = settingsDialog.getByRole("button", { name: /重置所有设置|Reset All Settings/ });
  await resetButton.waitFor({ state: "visible", timeout: 10_000 });
  let resetConfirmationSeen = false;
  page.once("dialog", async (dialog) => {
    resetConfirmationSeen = true;
    assert.equal(dialog.type(), "confirm");
    await dialog.accept();
  });
  await resetButton.click();

  await page.waitForFunction(() => {
    const rawSettings = localStorage.getItem("user_settings");
    const rawIdentity = localStorage.getItem("memorableState");
    if (!rawSettings || !rawIdentity) return false;
    const settings = JSON.parse(rawSettings);
    const identity = JSON.parse(rawIdentity).memorable;
    return settings.roomId === "" && identity?.uniqId !== "reset-settings-old-user:old-id";
  });
  assert.equal(resetConfirmationSeen, true, "Reset All confirmation was accepted");

  const result = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem("user_settings") ?? "{}"),
    identity: JSON.parse(localStorage.getItem("memorableState") ?? "{}").memorable,
    contentMarker: localStorage.getItem("user-created-content-marker"),
  }));
  assert.equal(result.settings.userTheme, "light");
  assert.equal(result.settings.transferPriority, "p2p");
  assert.equal(result.settings.micDeviceId, "");
  assert.equal(result.settings.speakerDeviceId, "");
  assert.equal(result.settings.speakerVolume, 1);
  assert.equal(result.settings.videoDeviceId, "");
  assert.equal(result.settings.meetingCameraDefaultOn, false);
  assert.equal(result.settings.meetingMicrophoneDefaultOn, false);
  assert.notEqual(result.identity.userName, previousIdentity.userName);
  assert.notEqual(result.identity.userId, previousIdentity.userId);
  assert.notEqual(result.identity.uniqId, previousIdentity.uniqId);
  assert.notEqual(result.identity.userName, "用户");
  assert.equal(result.identity.userNameExplicit, false);
  for (const key of ["countryCode", "phoneNumber", "payNowName", "ls_bundle", "ls_force_relay", "ls_debug_stats", "ls_turn_api"]) {
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), null, `${key} is cleared`);
  }
  assert.equal(result.contentMarker, "preserve", "Reset All preserves unrelated user-created content");
});
