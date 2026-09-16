/**
 * Authentication defaults for the public LetShare relay.
 *
 * The WebSocket `token` is the fixed server-auth token.  A PRO JWT is a
 * separate `pro_token` cookie and must never be used as this value.
 */
export const PUBLIC_CUSTOM_SERVER_URL = "wss://ecs.letshare.fun/";
export const PUBLIC_CUSTOM_SERVER_AUTH_TOKEN =
  "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652";

function normalizedServerOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isPublicCustomServerUrl(value: string): boolean {
  return normalizedServerOrigin(value) === normalizedServerOrigin(PUBLIC_CUSTOM_SERVER_URL);
}

/**
 * Repair values written by older builds which accidentally persisted a PRO
 * JWT (or another non-auth value) into `user_settings.authToken`.
 *
 * Custom servers retain their configured token.  Only the known public relay
 * can safely use the bundled public token as a migration fallback.
 */
export function resolveCustomServerAuthToken(serverUrl: string, configuredToken: unknown): string {
  const token = typeof configuredToken === "string" ? configuredToken.trim() : "";
  if (!isPublicCustomServerUrl(serverUrl)) {
    return token;
  }
  // The public relay has one deployed server-auth secret.  A persisted value
  // from any older public build (including a PRO JWT) cannot be valid there.
  return token === PUBLIC_CUSTOM_SERVER_AUTH_TOKEN ? token : PUBLIC_CUSTOM_SERVER_AUTH_TOKEN;
}
