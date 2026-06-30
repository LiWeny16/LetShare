import { Clipboard } from '@capacitor/clipboard';
import alertUseMUI from './tools/alert';
import { isApp } from './capacitor/user';
import i18n from './i18n/i18n';

const t = i18n.t;


/**
 * @description 读取剪切板（兼容 Web + App）
 * @returns {Promise<string>}
 */
export async function readClipboard(): Promise<string> {
  try {
    if (isApp) {
      const { value } = await Clipboard.read();
      return value || '';
    } else if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      const text = await navigator.clipboard.readText();
      return text || '';
    } else {
      alertUseMUI(t('toast.clipboardReadUnsupported'), 3000, { kind: 'warning' });
    }
  } catch (err) {
    console.error('读取剪贴板失败: ', err);
    alertUseMUI(t('toast.clipboardReadFailed'), 3000, { kind: 'error' });
  }

  return '';
}

/**
 * @description 写入剪切板（兼容 Web + App）
 * @param {string} text 要写入剪贴板的内容
 * @returns {Promise<boolean>} 是否写入成功
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (isApp) {
      await Clipboard.write({ string: text });
      return true;
    } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);

      // 可选：验证写入是否成功（仅当有读取权限时）
      if (typeof navigator.clipboard.readText === 'function') {
        try {
          const copiedText = await navigator.clipboard.readText();
          if (copiedText === text) return true;
          console.warn('剪贴板内容验证失败:', text, copiedText);
        } catch (readErr) {
          console.warn('剪贴板内容验证失败:', readErr);
          return true; // 写入成功但未验证
        }
      } else {
        return true; // 无法验证但已写入
      }
    } else {
      alertUseMUI(t('toast.clipboardWriteUnsupported'), 3000, { kind: 'warning' });
    }
  } catch (err) {
    console.error('复制失败:', err);
    alertUseMUI(t('toast.clipboardWriteFailed'), 3000, { kind: 'warning' });
  }

  return false;
}
