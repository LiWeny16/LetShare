/**
 * 通话提示音 — 用 Web Audio API 合成，无需音频资源文件。
 *
 * 三套音色（同一族、温和圆润，避免刺耳蜂鸣）：
 *  - startRingtone（来电/接听端）：上行"叮咚"长铃，1.9s 一轮柔缓循环
 *  - startRingbackTone（拨出端等待接听）：下行"嘟~"短回铃，3s 一轮（传统回铃节奏）
 *  - playDisconnectTone（挂断/通话结束）：D5→B4→G4 下行三音
 *
 * 非用户手势环境（被浏览器阻止声音）下 resume 失败则静默，不报错。
 */

/** 获取 AudioContext 构造器或 null（Node 等无音频环境）。 */
function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

/**
 * 播放一段音符：正弦基音 + 低一个八度的柔和泛音（温暖感），带音头渐入/尾音渐出包络。
 * @param freq     基音频率（Hz）
 * @param start    c.currentTime 偏移起点（s）
 * @param duration 音符时长（s）
 * @param volume   峰值音量（0..1）
 */
function tone(c: AudioContext, freq: number, start: number, duration: number, volume: number): void {
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const sub = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  sub.type = "sine";
  sub.frequency.value = freq / 2; // 低八度泛音，音色更厚实温暖
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  g.gain.setValueAtTime(volume, t + duration - 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g);
  sub.connect(g);
  g.connect(c.destination);
  osc.start(t);
  sub.start(t);
  osc.stop(t + duration + 0.01);
  sub.stop(t + duration + 0.01);
}

type Loop = { stop: () => void };

/** 通用循环提示音：每 periodMs 触发一次 playBeat 合音。返回 stop() 以停止并释放 AudioContext。 */
function scheduleLoop(periodMs: number, playBeat: (c: AudioContext) => void): Loop | null {
  const AC = getAudioContextCtor();
  if (!AC) return null;
  let c: AudioContext;
  try {
    c = new AC();
  } catch {
    return null;
  }
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    playBeat(c);
    timer = setTimeout(tick, periodMs);
  };
  tick();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer != null) clearTimeout(timer);
      timer = null;
      void c.close().catch(() => undefined);
    },
  };
}

let ringtoneLoop: Loop | null = null;

/**
 * 来电铃声（接听端播放）：上行"叮-咚"（E6 → C6），1.9s 一轮，柔缓而不急促。
 */
export function startRingtone(): void {
  if (ringtoneLoop) return;
  ringtoneLoop = scheduleLoop(1900, (c) => {
    tone(c, 1318.51, 0, 0.16, 0.16); // E6
    tone(c, 1046.5, 0.22, 0.32, 0.16); // C6 主音稍长
  });
}

let ringbackLoop: Loop | null = null;

/**
 * 拨号回铃音（拨出端等待接听时播放）：下行"嘟~"双短音，3s 一轮近传统回铃节奏。
 * 与来电铃声同族而更低更轻，不打扰操作者对号入座。
 */
export function startRingbackTone(): void {
  if (ringbackLoop) return;
  ringbackLoop = scheduleLoop(3000, (c) => {
    tone(c, 440, 0, 0.18, 0.12); // A4
    tone(c, 392, 0.32, 0.18, 0.12); // G4 下行感
  });
}

export function stopRingtone(): void {
  ringtoneLoop?.stop();
  ringtoneLoop = null;
}

export function stopRingbackTone(): void {
  ringbackLoop?.stop();
  ringbackLoop = null;
}

/** 停止所有提示音（来电/回铃）。 */
export function stopAllCallTones(): void {
  stopRingtone();
  stopRingbackTone();
}

/**
 * 挂断/通话结束提示音（下行三音 D5→B4→G4"嘟~"），独立播放后自动释放；
 * 非用户手势环境 resume 失败则静默。
 */
export function playDisconnectTone(): void {
  const AC = getAudioContextCtor();
  if (!AC) return;
  let c: AudioContext;
  try {
    c = new AC();
  } catch {
    return;
  }
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  const notes = [587.33, 493.88, 392.0]; // D5 → B4 → G4
  notes.forEach((freq, i) => {
    tone(c, freq, i * 0.2, 0.12, 0.2);
  });
  setTimeout(() => void c.close().catch(() => undefined), 800);
}
