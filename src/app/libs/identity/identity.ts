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
  const userName = normalizeUserName(current.userName || legacyName || current.userId);
  const userId = current.userId || randomId();
  const uniqId = current.uniqId || `${userName}:${randomId()}`;
  // Older memorableState records did not distinguish an automatically derived
  // name from one the user deliberately chose. Keep derived/default names gated
  // until the user confirms one in a meeting; explicit names skip that gate.
  const storedUserName = typeof current.userName === "string" ? current.userName.trim() : "";
  const userNameExplicit = current.userNameExplicit ?? (storedUserName !== "" && storedUserName !== DEFAULT_USER_NAME);
  const identity = { userId, userName, userNameExplicit, uniqId };
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
