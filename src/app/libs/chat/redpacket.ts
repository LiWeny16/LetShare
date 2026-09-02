/**
 * 假红包协议：红包以带前缀的聊天文本传输（跨端零协议改动）。
 * 内容格式：[LS_REDPACKET]{"amount":8.88,"message":"恭喜发财"}
 */

export const REDPACKET_PREFIX = "[LS_REDPACKET]";

export type RedPacketPayload = {
  /** 金额（假红包，纯展示用） */
  amount: number;
  /** 祝福语 */
  message: string;
};

/** 生成红包消息文本。 */
export function buildRedPacket(payload: RedPacketPayload): string {
  return REDPACKET_PREFIX + JSON.stringify(payload);
}

/** 解析红包消息文本；非红包消息返回 null。 */
export function parseRedPacket(content: string): RedPacketPayload | null {
  if (!content.startsWith(REDPACKET_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(REDPACKET_PREFIX.length)) as Partial<RedPacketPayload>;
    if (typeof raw.amount !== "number" || typeof raw.message !== "string") return null;
    return { amount: raw.amount, message: raw.message };
  } catch {
    return null;
  }
}