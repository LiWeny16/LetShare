// import { alertEmitter } from ""; // 您的原始导入路径
import type { AlertColor } from "@mui/material";
import { alertEmitter } from "../../../components/Alert"; // 确保这个路径是正确的

// 用于存储每个消息字符串及其对应的防抖计时器ID
const messageDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_DELAY = 1000; // 1秒防抖延迟

/**
 * @description 使用 MUI 弹出全局提示，并对同样的消息进行1秒防抖处理。
 * 如果同一个消息在1秒内被多次调用，只有最后一次调用会在1秒延迟后触发。
 * 不同消息之间的调用不受此防抖影响（它们会各自独立触发或被各自的防抖逻辑处理）。
 */
const alertUseMUI = (
  msg: string,
  time?: number,
  objConfig?: {
    kind?: AlertColor;
    zIndex?: number;
  }
) => {
  // 如果该消息已经有一个正在等待的计时器，清除它
  if (messageDebounceTimers.has(msg)) {
    clearTimeout(messageDebounceTimers.get(msg)!);
  }

  // 为当前消息设置一个新的计时器
  const timerId = setTimeout(() => {
    // 计时器触发时，实际显示提示
    alertEmitter.emit("show", {
      message: msg,
      severity: objConfig?.kind ?? "success",
      duration: time ?? 2500,
      zIndex: objConfig?.zIndex ?? 9999,
    });
    // 提示显示后，从Map中移除该消息的计时器记录，以便下次同样消息能重新开始防抖
    messageDebounceTimers.delete(msg);
  }, DEBOUNCE_DELAY);

  // 将新的计时器ID存入Map
  messageDebounceTimers.set(msg, timerId);
};

export default alertUseMUI;

// --- 简单测试用例 (可以在浏览器控制台或Node环境中模拟运行) ---
/*
// 模拟 alertEmitter
const alertEmitterMock = {
  emit: (event: string, data: any) => {
    console.log(`[${new Date().toLocaleTimeString()}] Alert Emitter Event:`, event, data);
  }
};

// 替换掉真实的 alertEmitter 进行测试
// 在实际代码中，你应该使用真实的 alertEmitter
// (globalThis as any).alertEmitter = alertEmitterMock; // 粗暴的替换方式，仅为测试

// const testAlert = alertUseMUI; // 如果在同一个文件内测试，可以直接用

console.log("Starting alert tests...");

// 1. 快速连续调用相同消息
testAlert("Same message 1");
testAlert("Same message 1"); // 这个应该会覆盖上一个
setTimeout(() => testAlert("Same message 1"), 300); // 这个应该会覆盖上一个

// 2. 调用不同消息
setTimeout(() => testAlert("Different message 2"), 600); // 这个应该独立显示

// 3. 再次调用第一个消息，但在防抖期外
setTimeout(() => testAlert("Same message 1"), 2000); // 距离上一个 "Same message 1" 的计划弹出时间超过1s

// 预期输出 (大致时间点):
// T+1.3s (approx): Alert Emitter Event: show { message: 'Same message 1', ... } (来自 T+0.3s 的调用)
// T+1.6s (approx): Alert Emitter Event: show { message: 'Different message 2', ... } (来自 T+0.6s 的调用)
// T+3.0s (approx): Alert Emitter Event: show { message: 'Same message 1', ... } (来自 T+2.0s 的调用)
*/