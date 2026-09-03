let _showProUpgradeDialog: (() => Promise<boolean>) | null = null;

export function registerProUpgradeDialog(fn: () => Promise<boolean>) {
	_showProUpgradeDialog = fn;
}

export function showProUpgradeDialog(): Promise<boolean> {
	if (_showProUpgradeDialog) return _showProUpgradeDialog();
	return Promise.resolve(false);
}

export const PRO_COOKIE_KEY = "letshare_admin_pass";
export const PRO_INVITE_CODE = "bigonion";
export const PRO_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB 非PRO限制(仅服务器中转)

export const PRO_TOKEN_KEY = "letshare_pro_token";

export function getProToken(): string | null {
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${PRO_TOKEN_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
	);
	return match ? decodeURIComponent(match[1]) : null;
}

export function setProToken(token: string, days: number) {
	const d = new Date();
	d.setTime(d.getTime() + days * 86400000);
	const secure = location.protocol === "https:" ? ";Secure" : "";
	document.cookie = `${PRO_TOKEN_KEY}=${encodeURIComponent(token)};expires=${d.toUTCString()};path=/;SameSite=Lax${secure}`;
}

export function clearProToken() {
	document.cookie = `${PRO_TOKEN_KEY}=;expires=Thu,01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
}

export function getProCookie(): string | null {
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${PRO_COOKIE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
	);
	return match ? decodeURIComponent(match[1]) : null;
}

export function isPro(): boolean {
	return getProToken() !== null;
}

export function setProCookie(value: string, days: number) {
	const d = new Date();
	d.setTime(d.getTime() + days * 86400000);
	const secure = location.protocol === "https:" ? ";Secure" : "";
	document.cookie = `${PRO_COOKIE_KEY}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax${secure}`;
}

export function clearProCookie() {
	document.cookie = `${PRO_COOKIE_KEY}=;expires=Thu,01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
	clearProToken();
}

// import.meta.env 仅 Vite 存在；Node（单测）下取默认生产地址，避免模块加载即抛错
const API_BASE = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? "" : "https://ecs.letshare.fun";

/**
 * TURN 凭据端点地址。默认 API_BASE；E2E 测试可用 localStorage ls_turn_api
 * 覆盖为本地 Go 后端（测试钩子，生产零影响）。
 */
function turnApiBase(): string {
	if (typeof localStorage !== "undefined") {
		const override = localStorage.getItem("ls_turn_api");
		if (override !== null) return override;
	}
	return API_BASE;
}

export async function activatePro(userId: string, inviteCode: string): Promise<{ token: string; expires_at: string }> {
	const resp = await fetch(`${API_BASE}/api/pro/activate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ user_id: userId, invite_code: inviteCode }),
	});
	if (!resp.ok) {
		const err = await resp.json().catch(() => ({ error: "激活失败" }));
		throw new Error(err.error || "激活失败");
	}
	return resp.json();
}

export interface TurnIceServer {
	urls: string;
	username: string;
	credential: string;
}

export interface TurnCredentialsResponse {
	ice_servers: TurnIceServer[];
	ttl_seconds: number;
}

/**
 * 获取短效 TURN 凭据（由 Go 后端签发，RFC 5766 use-auth-secret 模式）。
 * 返回完整响应（ice_servers + ttl_seconds）：调用方按 ttl 调度到期前续期。
 * 后端未启用 TURN 时（404）返回空凭据与 ttl=0，调用方按无 TURN 降级处理。
 */
export async function fetchTurnCredentials(): Promise<TurnCredentialsResponse> {
	// Node（单测）环境：与"TURN 未启用"同路降级，测试不发真实网络请求
	// （注意 Node 24 也有全局 fetch，须用 window 判定浏览器环境）
	if (typeof window === "undefined") return { ice_servers: [], ttl_seconds: 0 };
	const resp = await fetch(`${turnApiBase()}/api/turn-credentials`);
	if (resp.status === 404) {
		// TURN 服务未启用：降级为纯 STUN，不影响通话发起
		return { ice_servers: [], ttl_seconds: 0 };
	}
	if (!resp.ok) {
		throw new Error("获取 TURN 凭据失败");
	}
	const data = (await resp.json()) as TurnCredentialsResponse;
	return {
		ice_servers: data.ice_servers ?? [],
		ttl_seconds: typeof data.ttl_seconds === "number" ? data.ttl_seconds : 0,
	};
}
