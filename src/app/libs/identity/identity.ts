/**
 * 应用级身份层。
 *
 * 这层是 root、meeting 和通话功能共同依赖的唯一身份初始化入口：
 * - userName：可变的展示名称；
 * - uniqId：nickname + random id，首次初始化后长期稳定；
 * - userId：旧连接/授权链路的兼容字段，不参与 Meeting 身份判定。
 */

export const MEMORABLE_STATE_KEY = "memorableState";
export const DEFAULT_USER_NAME = "用户";

/**
 * 首次进入时的随机趣味昵称池（形容词 + 动物/水果/食物）。
 * 全部为正向、无讽刺意味的名字；后续可在会议里自行改名。
 */
const RANDOM_NICKNAMES: readonly string[] = [
  "高冷的小猫咪", "敏捷的北极狐", "快乐的小海豚", "机灵的小松鼠", "温柔的梅花鹿",
  "好奇的小浣熊", "呆萌的小企鹅", "威风的小狮子", "憨憨的小熊", "优雅的白天鹅",
  "活泼的小兔子", "神秘的小夜猫", "勇敢的小猎豹", "悠闲的小海龟", "蹦跳的小袋鼠",
  "聪明的小海獭", "爱笑的柴犬", "打盹的树懒", "圆滚滚的熊猫", "毛茸茸的小刺猬",
  "闪亮的小星星", "甜甜的水蜜桃", "清爽的小青柠", "香甜的芒果", "多汁的小蜜橘",
  "脆脆的小苹果", "软糯的小香蕉", "酸酸的小柠檬", "圆润的小葡萄", "鲜嫩的小草莓",
  "清爽的小西瓜", "金黄的小菠萝", "饱满的小樱桃", "晶莹的小荔枝", "香浓的小椰子",
  "暖暖的小太阳", "慢悠悠的小蜗牛", "灵巧的小蜜蜂", "自在的小鲸鱼", "闪闪的小萤火虫",
  "轻盈的小蝴蝶", "挺拔的小白杨", "安静的小睡莲", "清新的小薄荷", "软软的小云朵",
  "弯弯的小月牙", "圆亮的小月亮", "淘气的小风铃", "有趣的小陀螺", "亮晶晶的小露珠",
  "咕噜噜的小气泡", "胖乎乎的小海豹",
];

function randomNickname(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoApi.getRandomValues(buf);
    return RANDOM_NICKNAMES[buf[0] % RANDOM_NICKNAMES.length];
  }
  return RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
}

/** 供 UI「随机换一个名字」复用；与初始化昵称同池。 */
export function randomFunName(): string {
  return randomNickname();
}

/**
 * 从未被用户命名的占位名（新兜底"用户"、老版 UUID 残片）在初始化时
 * 换成随机趣味昵称；用户显式起过的名字原样保留。
 */
function isPlaceholderName(name: string): boolean {
  return name === DEFAULT_USER_NAME || /^[0-9a-fA-F-]{8,}$/.test(name);
}

export type IdentityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AppIdentity {
  userId: string;
  userName: string;
  /** Whether the user has explicitly chosen this display name. */
  userNameExplicit: boolean;
  uniqId: string;
}

const memoryStorage: Record<string, string> = {};

function getDefaultStorage(): IdentityStorage {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return {
    getItem: (key) => memoryStorage[key] ?? null,
    setItem: (key, value) => { memoryStorage[key] = value; },
    removeItem: (key) => { delete memoryStorage[key]; },
  };
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function normalizeUserName(value: unknown, fallback = DEFAULT_USER_NAME): string {
  const normalized = typeof value === "string" ? value.trim().slice(0, 32) : "";
  return normalized || fallback;
}

function legacyNameFromUniqId(uniqId: string | null): string {
  if (!uniqId) return "";
  return uniqId.split(":", 1)[0] ?? "";
}

function readState(storage: IdentityStorage): Partial<AppIdentity> {
  const raw = storage.getItem(MEMORABLE_STATE_KEY);
  if (!raw) return {};
  try {
    const memorable = JSON.parse(raw)?.memorable;
    if (!memorable || typeof memorable !== "object") return {};
    return {
      userId: typeof memorable.userId === "string" ? memorable.userId : undefined,
      userName: typeof memorable.userName === "string" ? memorable.userName : undefined,
      userNameExplicit: typeof memorable.userNameExplicit === "boolean" ? memorable.userNameExplicit : undefined,
      uniqId: typeof memorable.uniqId === "string" ? memorable.uniqId : undefined,
    };
  } catch {
    storage.removeItem(MEMORABLE_STATE_KEY);
    return {};
  }
}

function persist(identity: AppIdentity, storage: IdentityStorage): void {
  storage.setItem(MEMORABLE_STATE_KEY, JSON.stringify({ memorable: identity }));
}

/** 初始化一次应用身份；root/meeting/通话都必须调用这一个入口。 */
export function initializeIdentity(storage: IdentityStorage = getDefaultStorage()): AppIdentity {
  const current = readState(storage);
  const legacyName = legacyNameFromUniqId(current.uniqId ?? null);
  const storedUserName = typeof current.userName === "string" ? current.userName.trim() : "";
  const storedExplicit = typeof current.userNameExplicit === "boolean" ? current.userNameExplicit : undefined;
  const explicit = storedExplicit ?? (storedUserName !== "" && storedUserName !== DEFAULT_USER_NAME);
  // 显式命名 > 已存的合法自动名 > 占位名换随机昵称
  const derivedName = storedUserName !== "" && !isPlaceholderName(storedUserName)
    ? storedUserName
    : legacyName !== "" && !isPlaceholderName(legacyName)
      ? legacyName
      : "";
  const userName = explicit && storedUserName !== ""
    ? storedUserName
    : derivedName || randomNickname();
  const userId = current.userId || randomId();
  const uniqId = current.uniqId || `${userName}:${randomId()}`;
  // Older memorableState records did not distinguish an automatically derived
  // name from one the user deliberately chose. Keep derived/default names gated
  // until the user confirms one in a meeting; explicit names skip that gate.
  const identity = { userId, userName, userNameExplicit: explicit, uniqId };
  persist(identity, storage);
  return identity;
}

/** 改名只更新 userName，绝不重新生成 uniqId。 */
export function updateIdentityUserName(
  userName: string,
  storage: IdentityStorage = getDefaultStorage(),
): AppIdentity {
  const current = initializeIdentity(storage);
  const next = { ...current, userName: normalizeUserName(userName, current.userName), userNameExplicit: true };
  persist(next, storage);
  return next;
}
