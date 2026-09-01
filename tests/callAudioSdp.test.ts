/**
 * Unit tests for enhanceOpusFmtp — Opus SDP fmtp 调优（FEC / 高码率 / 立体声）。
 *
 * 纯字符串函数，无浏览器依赖，node:test 直接跑。
 *
 * Run: node --test --import tsx tests/callAudioSdp.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { enhanceOpusFmtp } from "../src/app/libs/call/callSession";

const RTPMAP_111 = "a=rtpmap:111 opus/48000/2";
const FULL = "useinbandfec=1;maxaveragebitrate=128000;stereo=1";

test("existing fmtp line: keep original params first, append missing desired params", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    RTPMAP_111,
    "a=fmtp:111 minptime=10",
  ].join("\n");
  const out = enhanceOpusFmtp(sdp);
  assert.ok(
    out.includes(`a=fmtp:111 minptime=10;${FULL}`),
    `expected patched fmtp line, got:\n${out}`,
  );
});

test("no fmtp line for the PT: insert fmtp line directly after the rtpmap line", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    RTPMAP_111,
    "a=rtpmap:96 PCMU/8000",
  ].join("\n");
  const out = enhanceOpusFmtp(sdp);
  const lines = out.split("\n");
  const idx = lines.indexOf(RTPMAP_111);
  assert.notEqual(idx, -1, "rtpmap line should survive unchanged");
  assert.equal(lines[idx + 1], `a=fmtp:111 ${FULL}`);
});

test("CRLF input: output keeps CRLF line endings (no lone LF introduced)", () => {
  const sdp = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", RTPMAP_111].join("\r\n");
  const out = enhanceOpusFmtp(sdp);
  assert.ok(out.includes(`\r\na=fmtp:111 ${FULL}`), `expected CRLF before inserted fmtp, got:\n${JSON.stringify(out)}`);
  // 除 CRLF 内的 LF 外，不应出现孤立 LF（即没有任何行退化为 LF-only）
  assert.ok(!out.replace(/\r\n/g, "").includes("\n"), "found a line ending with bare LF");
});

test("SDP without opus rtpmap: returned unchanged", () => {
  const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=rtpmap:0 PCMU/8000\r\n";
  assert.equal(enhanceOpusFmtp(sdp), sdp);
});

test("fmtp already containing all params: unchanged, no duplicates", () => {
  const sdp = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", RTPMAP_111, `a=fmtp:111 ${FULL}`].join("\n");
  assert.equal(enhanceOpusFmtp(sdp), sdp);

  // 部分已有（如 stereo=1）→ 只补缺，不产生重复参数
  const partial = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", RTPMAP_111, "a=fmtp:111 stereo=1"].join("\n");
  const partialOut = enhanceOpusFmtp(partial);
  assert.equal((partialOut.match(/stereo=1/g) ?? []).length, 1, "stereo=1 must not be duplicated");
  assert.ok(partialOut.includes("a=fmtp:111 stereo=1;useinbandfec=1;maxaveragebitrate=128000"));
});

test("different PT (96): patches 96, leaves other PT's fmtp untouched", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 96 111",
    "a=rtpmap:96 opus/48000/2",
    "a=rtpmap:111 PCMU/8000",
    "a=fmtp:111 minptime=10",
  ].join("\n");
  const out = enhanceOpusFmtp(sdp);
  assert.ok(out.includes(`a=fmtp:96 ${FULL}`), `expected fmtp:96 patched, got:\n${out}`);
  assert.ok(out.includes("a=fmtp:111 minptime=10"), "non-opus fmtp:111 line must stay intact");
  assert.ok(!out.includes("a=fmtp:111 minptime=10;useinbandfec"), "must not patch the non-matched PT");
});
