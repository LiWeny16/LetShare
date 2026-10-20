/**
 * DOM 侧极小适配（元素工厂 + 扬声器路由 + 快照辅助）。顶层零浏览器 API（函数内判 typeof document），
 * Node 单测可 import；单测一般直接注入假元素，不需要本模块。
 */
import type { RemoteAudioMediaElement } from "./remoteAudioHostTypes";

/**
 * 解码 sink / 兜底发声元素的默认工厂：隐藏 <audio> 挂 body 尾部。
 * 有意 append 到 body 尾：DOM 顺序保证 `document.querySelector("audio")` 先命中 UI 注入的发声元素
 * （tests/e2e/diag-*.mts 的听感 RMS 测的就是它）。
 */
export function createDomAudioElement(): RemoteAudioMediaElement | null {
  if (typeof document === "undefined") return null;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.style.display = "none";
  const host = document.body ?? document.documentElement;
  if (!host) return null;
  host.appendChild(el);
  return el;
}

/** 元素绑定流里的音频轨数（诊断快照用；非 MediaStream 或无流返回 null）。 */
export function audioTrackCount(srcObject: MediaProvider | null): number | null {
  if (!srcObject) return null;
  const maybeStream = srcObject as Partial<MediaStream>;
  return typeof maybeStream.getAudioTracks === "function" ? maybeStream.getAudioTracks().length : null;
}

/**
 * 扬声器路由：管线通路走 AudioContext.setSinkId（Chromium 110+），失败或元素通路回退元素 setSinkId。
 * 失败必须可见（warn），禁止静默吞（X4）。
 */
export function applySinkRouting(
  pipeline: { setSinkId(deviceId: string): Promise<boolean> },
  output: RemoteAudioMediaElement | null,
  viaPipeline: boolean,
  sinkId: string,
): void {
  if (viaPipeline) {
    void pipeline.setSinkId(sinkId).then((ok) => {
      if (!ok) applyElementSinkId(output, sinkId);
    });
    return;
  }
  applyElementSinkId(output, sinkId);
}

function applyElementSinkId(output: RemoteAudioMediaElement | null, sinkId: string): void {
  const setSinkId = output?.setSinkId;
  if (!setSinkId) return;
  void setSinkId.call(output, sinkId).catch((err: unknown) => {
    console.warn("[RemoteAudioHost] 元素 setSinkId 失败:", err);
  });
}
