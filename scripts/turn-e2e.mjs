/**
 * TURN E2E 连通性测试 — 从公网侧向 coturn 发起真实 RFC 5766 TURN Allocate。
 *
 * 验证三件事：
 *   1. UDP 3478 端口可达 + 服务器响应（安全组 UDP 放行）
 *   2. 短效凭据认证通过（use-auth-secret 下 username=<unix>:<ttl>, credential=HMAC-SHA1）
 *   3. 成功分配 relay 候选（XOR-RELAYED-ADDRESS）
 *
 * 用法: node scripts/turn-e2e.mjs
 */
import dgram from "node:dgram";
import crypto from "node:crypto";

const SERVER = "ecs.letshare.fun";
const PORT = 3478;
const API = "https://ecs.letshare.fun/api/turn-credentials";

// ── STUN 消息构造（RFC 5389）─────────────────────────────
const MAGIC_COOKIE = 0x2112a442;

function buildStunBuffer(headerBuf, attrsBuf) {
  // headerBuf: 20 字节（type+length+magic+txid），attrsBuf: 属性编码
  const len = attrsBuf.length;
  headerBuf.writeUInt16BE(20 + len, 2); // length
  return Buffer.concat([headerBuf, attrsBuf]);
}

function makeHeader(type, txid) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(type, 0);
  h.writeUInt32BE(MAGIC_COOKIE, 4);
  h.set(txid, 8); // txid 12 bytes from offset 8
  return h;
}

// 属性编码：type(2) + length(2) + value (4 字节对齐)
function attr(type, valueBuf) {
  const pad = (4 - (valueBuf.length % 4)) % 4;
  const out = Buffer.alloc(4 + valueBuf.length + pad);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(valueBuf.length, 2);
  valueBuf.copy(out, 4);
  return out;
}

// ── XOR 编解码（RFC 5389 §15.2）──────────────────────────
function xor(a, b) {
  const n = Math.max(a.length, b.length);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  return out;
}

function ipv4ToBuf(ip) {
  return Buffer.from(ip.split(".").map((n) => parseInt(n, 10)));
}

// ── MESSAGE-INTEGRITY（RFC 5766 long-term credential，short-term HMAC 凭据）────
function messageIntegrityAttr(buf, password) {
  // buf = header(20, 长度字段已填) + 到 MESSAGE-INTEGRITY 前的属性
  const hmac = crypto.createHmac("sha1", password).update(buf).digest();
  return attr(0x0008, hmac); // MESSAGE-INTEGRITY = 0x0008
}

async function fetchCredentials() {
  const resp = await fetch(API);
  if (!resp.ok) throw new Error(`凭据获取失败 HTTP ${resp.status}`);
  const data = await resp.json();
  const s = data.ice_servers[0];
  // RFC 5766 short-term credential: username 作为 password（HMAC 短效凭据即 password）
  return { username: s.username, password: s.credential };
}

function parseResponse(buf) {
  const type = buf.readUInt16BE(0);
  const txid = buf.subarray(8, 20);
  return { type, txid, attrs: parseAttrs(buf, 20) };
}

function parseAttrs(buf, off) {
  const attrs = {};
  let i = off;
  while (i + 4 <= buf.length) {
    const t = buf.readUInt16BE(i);
    const l = buf.readUInt16BE(i + 2);
    const v = buf.subarray(i + 4, i + 4 + l);
    attrs[t] = l + 4;
    if (t === 0x0020 || t === 0x0016 || t === 0x0001) {
      // XOR-MAPPED-ADDRESS (0x0020), XOR-RELAYED-ADDRESS (0x0016), MAPPED-ADDRESS(0x0001)
      if (l >= 8) {
        const family = v.readUInt8(1);
        const port = v.readUInt16BE(2) ^ (MAGIC_COOKIE >> 16);
        const ip = family === 0x01
          ? xor(v.subarray(4, 8), Buffer.from([0x21, 0x12, 0xa4, 0x42])).join(".")
          : "(ipv6)";
        attrs[t] = `${ip}:${port}`;
      }
    }
    i += 4 + l + ((4 - (l % 4)) % 4);
  }
  return attrs;
}

async function run() {
  const { username, password } = await fetchCredentials();
  console.log(`[凭据] username=${username} password=${password.slice(0, 12)}...`);

  const socket = dgram.createSocket("udp4");
  const txid = crypto.randomBytes(12);

  // TURN Allocate request = 0x0003
  const header = makeHeader(0x0003, txid);
  const requestedTransport = attr(0x0019, Buffer.from([17, 0, 0, 0])); // UDP=17
  let buf = buildStunBuffer(header, requestedTransport);

  // MESSAGE-INTEGRITY 需要在头长度已知后计算，覆盖 header+前面的 attrs
  const hdrLen = Buffer.from(header);
  hdrLen.writeUInt16BE(20 + requestedTransport.length + 24, 2); // 加 MI 的 24 字节
  const miBuf = Buffer.concat([hdrLen, requestedTransport]);
  const mi = messageIntegrityAttr(miBuf, password);
  buf = Buffer.concat([hdrLen, requestedTransport, mi]);

  let result = null;
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("TURN Allocate 超时（10s）")), 10000));

  const recv = new Promise((resolve, reject) => {
    socket.once("message", (msg) => resolve(msg));
    socket.once("error", reject);
  });

  socket.send(buf, PORT, SERVER, (err) => {
    if (err) console.error("[发送失败]", err);
  });

  try {
    const msg = await Promise.race([recv, timeout]);
    const parsed = parseResponse(msg);
    result = parsed;
    console.log(`[响应] type=0x${parsed.type.toString(16)}`);

    if (parsed.type === 0x0103) {
      // Allocate Success Response
      const relayed = parsed.attrs[0x0016] || parsed.attrs[0x0020];
      console.log(`✅ TURN Allocate 成功！relay 候选: ${relayed || "(未提取到 relay 地址)"}`);
      return { ok: true, relayed, username };
    } else if (parsed.type === 0x0113) {
      // Allocate Error Response
      console.error(`❌ Allocate 被拒 (error code)`);
      console.error(`   完整响应属性 key: ${Object.keys(parsed.attrs).join(", ")}`);
      return { ok: false, type: parsed.type, attrs: parsed.attrs, username };
    }
    return { ok: false, type: parsed.type, username };
  } finally {
    socket.close();
  }
}

run()
  .then((r) => {
    console.log(`\n${r.ok ? "🎉 E2E 通过" : "🔴 E2E 未通过"}（${r.ok ? "安全组 UDP 放行 + 认证 + relay 分配 三者均成功" : "详情见上方"}）`);
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(`❌ E2E 异常: ${e.message}`);
    process.exit(1);
  });