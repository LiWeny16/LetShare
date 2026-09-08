/**
 * Incremental SHA-256（纯 TS，无 crypto.subtle 依赖）。
 *
 * 用途：P2P / relay 文件传输的接收端 hash 校验 —— crypto.subtle.digest 只能一次性
 * 摘要完整 ArrayBuffer，无法对分块到达的字节流增量计算；大文件也不可能整体驻留内存。
 * 实现遵循 FIPS 180-4；性能对 256KB 分块足够（每块 ~0.5ms 量级）。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export class IncrementalSha256 {
  private h0 = 0x6a09e667;
  private h1 = 0xbb67ae85;
  private h2 = 0x3c6ef372;
  private h3 = 0xa54ff53a;
  private h4 = 0x510e527f;
  private h5 = 0x9b05688c;
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private w = new Uint32Array(64);
  private finalDigest: string | null = null;

  public update(data: Uint8Array): void {
    if (data.byteLength === 0) return;
    this.bytesHashed += data.byteLength;

    let offset = 0;
    if (this.bufferLength > 0) {
      const need = 64 - this.bufferLength;
      const take = Math.min(need, data.byteLength);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset = take;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= data.byteLength) {
      this.processBlock(data, offset);
      offset += 64;
    }

    if (offset < data.byteLength) {
      const rest = data.subarray(offset);
      this.buffer.set(rest, 0);
      this.bufferLength = rest.byteLength;
    }
  }

  public digestHex(): string {
    if (this.finalDigest !== null) {
      return this.finalDigest;
    }
    const bitLengthHi = Math.floor(this.bytesHashed / 0x20000000);
    const bitLengthLo = (this.bytesHashed << 3) >>> 0;

    // 0x80 填充
    const pad = new Uint8Array(((this.bufferLength < 56 ? 56 : 120) - this.bufferLength) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.byteLength - 8, bitLengthHi);
    view.setUint32(pad.byteLength - 4, bitLengthLo);
    this.updateIntoLengthOnly(pad);

    const out = new Uint32Array(8);
    out[0] = this.h0; out[1] = this.h1; out[2] = this.h2; out[3] = this.h3;
    out[4] = this.h4; out[5] = this.h5; out[6] = this.h6; out[7] = this.h7;
    this.finalDigest = Array.from(out, (word) => word.toString(16).padStart(8, "0")).join("");
    return this.finalDigest;
  }

  /** 摘要阶段的填充字节只参与压缩，不计入消息长度。 */
  private updateIntoLengthOnly(data: Uint8Array): void {
    let offset = 0;
    if (this.bufferLength > 0) {
      const need = 64 - this.bufferLength;
      const take = Math.min(need, data.byteLength);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset = take;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
      }
    }
    while (offset + 64 <= data.byteLength) {
      this.processBlock(data, offset);
      offset += 64;
    }
    if (offset < data.byteLength) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLength = data.byteLength - offset;
    }
  }

  private processBlock(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15] >>> 0, 7) ^ rotr(w[i - 15] >>> 0, 18) ^ ((w[i - 15] >>> 0) >>> 3);
      const s1 = rotr(w[i - 2] >>> 0, 17) ^ rotr(w[i - 2] >>> 0, 19) ^ ((w[i - 2] >>> 0) >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h0, b = this.h1, c = this.h2, d = this.h3;
    let e = this.h4, f = this.h5, g = this.h6, h = this.h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  }
}

export async function sha256HexOfFile(file: Blob): Promise<string> {
  const hasher = new IncrementalSha256();
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const buf = await file.slice(offset, offset + chunkSize).arrayBuffer();
    hasher.update(new Uint8Array(buf));
  }
  return hasher.digestHex();
}
