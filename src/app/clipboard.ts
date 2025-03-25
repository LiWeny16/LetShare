import alertUseMUI from "./alert";

/**
 * @description 读取剪切板（兼容更多设备）
 * @returns {Promise<string>}
 */
export async function readClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) {
    alertUseMUI("当前浏览器不支持读取剪切板，请手动粘贴。", 3000, { kind: "warning" });
  }

  // 检查是否支持 navigator.clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      const text = await navigator.clipboard.readText();
      return text || "";
    } catch (err) {
      console.error("Failed to read clipboard contents via clipboard API: ", err);
    }
  }

  // 降级方案：尝试使用 document.execCommand
  try {
    const textArea = document.createElement("textarea");
    document.body.appendChild(textArea);
    textArea.style.position = "absolute";
    textArea.style.left = "-9999px"; // 将文本区域移出屏幕
    textArea.focus();
    document.execCommand("paste"); // 触发粘贴命令
    const text = textArea.value;
    document.body.removeChild(textArea); // 清理 DOM
    return text || "";
  } catch (err) {
    console.error("Failed to read clipboard contents via execCommand: ", err);
  }

  // 如果都不支持，返回空字符串
  console.warn("Clipboard API and execCommand are not supported on this device.");
  return "";
}


/**
* @description 写入剪切板（兼容更多设备）
* @param {string} text 要写入剪切板的内容
* @returns {Promise<boolean>} 是否写入成功
*/
export async function writeClipboard(text: string): Promise<boolean> {
  // 优先使用 Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      
      // ✅ 关键：写入后读取回来做校验（适用于大多数现代浏览器）
      if (typeof navigator.clipboard.readText === "function") {
        try {
          const copiedText = await navigator.clipboard.readText();
          if (copiedText === text) {
            return true;
          } else {
            console.warn("Clipboard text mismatch. Written vs Read:", text, copiedText);
          }
        } catch (readErr) {
          console.warn("Could not verify clipboard content:", readErr);
          // 如果读取失败，依然不能确认成功，继续降级处理
        }
      } else {
        // 如果无法验证，只能假设成功
        return true;
      }

    } catch (err) {
      console.error("Failed to write clipboard via Clipboard API:", err);
      // 继续降级处理
    }
  }

  // 降级处理：使用 execCommand('copy')
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "-1000px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    if (success) {
      return true;
    } else {
      console.warn("execCommand copy returned false.");
    }
  } catch (err) {
    console.error("Failed to write clipboard via execCommand:", err);
  }

  alertUseMUI("复制失败，请手动复制文本。", 3000, { kind: "warning" });
  return false;
}

