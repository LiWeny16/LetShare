/**
 * 来电铃声 — 用 Web Audio API 合成，无需音频资源文件。
 *
 * 在用户手势（接听/拒绝）前浏览器可能阻止声音，来电横幅出现时尝试播放，
 * 若不成功则静默（不报错）；用户点击接听/拒绝时也尝试触发一次用户手势播放。
 */

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let playing = false;

export function startRingtone(): void {
  if (playing) return;
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return;
  if (!ctx) ctx = new AC();
  const c = ctx;
  if (c.state === "suspended") void c.resume();
  playing = true;

  const beep = (start: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 880; // A5 铃声音
    gain.gain.setValueAtTime(0.15, c.currentTime + start);
    gain.gain.setValueAtTime(0.15, c.currentTime + start + 0.4);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + start + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + 0.5);
  };

  // 周期性双响铃（类似通话等待音），循环直到停止
  const loop = () => {
    if (!playing) return;
    beep(0);
    beep(0.35);
    timer = setTimeout(loop, 900);
  };
  loop();
}

export function stopRingtone(): void {
  if (!playing) return;
  playing = false;
  if (timer != null) clearTimeout(timer);
  timer = null;
  if (ctx) void ctx.close().catch(() => undefined);
  ctx = null;
}

/**
 * 挂断/通话结束提示音（Discord 式短促下行三音"嘟~"），独立 AudioContext 实例，
 * 与铃声互不干扰；播完自动关闭释放。非用户手势环境（对方挂断）下 resume 失败则静默。
 */
export function playDisconnectTone(): void {
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return;
  let c: AudioContext;
  try {
    c = new AC();
  } catch {
    return;
  }
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  // Discord 风格：D5 → B4 → G4 下行短音（各 ~110ms，间隔 90ms；音头渐入避免爆音）
  const notes = [587.33, 493.88, 392.0];
  notes.forEach((freq, i) => {
    const t = c.currentTime + i * 0.2;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  });
  setTimeout(() => void c.close().catch(() => undefined), 800);
}
