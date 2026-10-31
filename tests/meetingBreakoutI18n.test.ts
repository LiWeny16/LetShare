import test from "node:test";
import assert from "node:assert/strict";
import i18next from "i18next";
import { resources } from "../src/app/libs/i18n/translation";

test("meeting invitation and breakout controls follow the selected language", async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ resources, lng: "zh", fallbackLng: "en" });
  assert.equal(i18n.t("meeting.inviteAction"), "邀请");
  assert.equal(i18n.t("meeting.breakoutDefaultName", { number: 2 }), "分组 2");
  assert.equal(i18n.t("meeting.breakoutJoin"), "加入房间");
  await i18n.changeLanguage("en");
  assert.equal(i18n.t("meeting.inviteAction"), "Invite");
  assert.equal(i18n.t("meeting.breakoutDefaultName", { number: 2 }), "Room 2");
  assert.equal(i18n.t("meeting.breakoutJoin"), "Join room");
  assert.equal(i18n.t("meeting.breakoutEmptyHost"), "Create a room for members to join freely.");
});
