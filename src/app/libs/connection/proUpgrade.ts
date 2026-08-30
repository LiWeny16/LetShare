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

const API_BASE = import.meta.env.DEV ? "" : "https://ecs.letshare.fun";

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
 * 返回的 iceServers 直接并入 RTCPeerConnection 的 iceServers 配置。
 * 后端未启用 TURN 时（404）返回空数组，调用方按无 TURN 降级处理。
 */
export async function fetchTurnCredentials(): Promise<TurnIceServer[]> {
	const resp = await fetch(`${API_BASE}/api/turn-credentials`);
	if (resp.status === 404) {
		// TURN 服务未启用：降级为纯 STUN，不影响通话发起
		return [];
	}
	if (!resp.ok) {
		throw new Error("获取 TURN 凭据失败");
	}
	const data = (await resp.json()) as TurnCredentialsResponse;
	return data.ice_servers ?? [];
}
