/**
 * 响亮测试音频生成（fake audio capture 输入，diag-loud / diag-min 共用）。
 * 生成合法 WAV：mono 16-bit 48kHz，9 秒 440Hz 正弦波（振幅 ~32000），写入系统临时目录。
 * 纯 Node Buffer 数学，无依赖；文件已存在时直接复用路径。
 */
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 48_000;
const DURATION_S = 9;
const FREQ_HZ = 440;
const AMPLITUDE = 32_000;

/** 确保响亮 WAV 存在并返回其路径（跨平台：OS 临时目录下 ls-loud-440hz.wav）。 */
export function ensureLoudWav(): string {
  const path = join(tmpdir(), "ls-loud-440hz.wav");
  if (existsSync(path)) return path;
  const totalSamples = SAMPLE_RATE * DURATION_S;
  const dataLen = totalSamples * 2; // mono 16-bit
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size（PCM 固定 16）
  buf.writeUInt16LE(1, 20); // audioFormat = PCM
  buf.writeUInt16LE(1, 22); // numChannels = mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byteRate = 48000 * 1ch * 2B
  buf.writeUInt16LE(2, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // bitsPerSample
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.round(AMPLITUDE * Math.sin((2 * Math.PI * FREQ_HZ * i) / SAMPLE_RATE));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}
