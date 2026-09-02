/**
 * Unit tests for redpacket — 假红包协议（前缀文本封装/解析）。
 *
 * Run: node --import tsx --test tests/redpacket.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildRedPacket, parseRedPacket, REDPACKET_PREFIX } from "../src/app/libs/chat/redpacket";

test("buildRedPacket: 生成带前缀的 JSON 文本", () => {
  const text = buildRedPacket({ amount: 8.88, message: "恭喜发财" });
  assert.ok(text.startsWith(REDPACKET_PREFIX));
  assert.ok(text.includes("8.88"));
  assert.ok(text.includes("恭喜发财"));
});

test("parseRedPacket: 正常解析", () => {
  const payload = parseRedPacket('[LS_REDPACKET]{"amount":66.66,"message":"大吉大利"}');
  assert.deepEqual(payload, { amount: 66.66, message: "大吉大利" });
});

test("parseRedPacket: 非红包文本返回 null", () => {
  assert.equal(parseRedPacket("普通文本消息"), null);
  assert.equal(parseRedPacket(""), null);
});

test("parseRedPacket: 损坏的负载返回 null（不抛异常）", () => {
  assert.equal(parseRedPacket(REDPACKET_PREFIX + "{invalid json"), null);
  assert.equal(parseRedPacket(REDPACKET_PREFIX + '{"amount":"abc","message":"x"}'), null);
  assert.equal(parseRedPacket(REDPACKET_PREFIX + "null"), null);
});

test("roundtrip: build → parse 一致", () => {
  const payload = { amount: 100, message: "生日快乐！" };
  assert.deepEqual(parseRedPacket(buildRedPacket(payload)), payload);
});