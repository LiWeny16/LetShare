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
export const PRO_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB

export function getProCookie(): string | null {
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${PRO_COOKIE_KEY.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1")}=([^;]*)`)
	);
	return match ? decodeURIComponent(match[1]) : null;
}

export function isPro(): boolean {
	return getProCookie() === PRO_INVITE_CODE;
}

export function setProCookie(value: string, days: number) {
	const d = new Date();
	d.setTime(d.getTime() + days * 86400000);
	document.cookie = `${PRO_COOKIE_KEY}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

export function clearProCookie() {
	document.cookie = `${PRO_COOKIE_KEY}=;expires=Thu,01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
}
