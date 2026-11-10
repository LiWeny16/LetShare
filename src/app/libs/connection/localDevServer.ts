import {
  isPublicCustomServerUrl,
  resolveCustomServerAuthToken,
} from "./publicServerAuth";

/** Local Go backend used when the app is opened from localhost. */
export const LOCAL_DEV_SERVER_URL = "ws://127.0.0.1:8080/";

/**
 * The local server's default auth token:
 * sha256("sever_auth_123"). Keep this in sync with the Go server's
 * SERVER_AUTH_SECRET fallback.
 */
export const LOCAL_DEV_SERVER_AUTH_TOKEN =
  "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652";

export interface ResolveConnectionTargetOptions {
  hostname?: string | null;
  configuredServerUrl?: unknown;
  configuredAuthToken?: unknown;
  devServerUrl?: unknown;
  devAuthToken?: unknown;
  devBuild?: boolean;
}

export interface ResolvedConnectionTarget {
  serverUrl: string;
  authToken: string;
  usesLocalDevServer: boolean;
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isLocalDevHostname(hostname: string | null | undefined): boolean {
  const normalized = readTrimmed(hostname).toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function isLocalServerUrl(value: string): boolean {
  try {
    return isLocalDevHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Pick the WebSocket target without mutating persisted settings.
 *
 * A localhost page normally saves the public relay URL. In that case it should
 * transparently use the local Go backend. An explicitly configured private
 * server keeps precedence so local development against a remote/staging
 * backend still works.
 */
export function resolveConnectionTarget(
  options: ResolveConnectionTargetOptions,
): ResolvedConnectionTarget {
  const configuredServerUrl = readTrimmed(options.configuredServerUrl);
  const configuredAuthToken = readTrimmed(options.configuredAuthToken);
  const devServerUrl = readTrimmed(options.devServerUrl);
  const devAuthToken = readTrimmed(options.devAuthToken);
  const localPage = isLocalDevHostname(options.hostname);
  const localServerConfigured = Boolean(configuredServerUrl) && isLocalServerUrl(configuredServerUrl);
  const publicOrUnsetServer = !configuredServerUrl || isPublicCustomServerUrl(configuredServerUrl);
  const useLocalDefault = localPage && (publicOrUnsetServer || localServerConfigured);
  const useDevOverride = Boolean(
    devServerUrl && options.devBuild && isPublicCustomServerUrl(configuredServerUrl),
  );

  if (useLocalDefault) {
    const serverUrl = localServerConfigured
      ? configuredServerUrl
      : devServerUrl || LOCAL_DEV_SERVER_URL;
    const authToken = localServerConfigured
      ? configuredAuthToken || devAuthToken || LOCAL_DEV_SERVER_AUTH_TOKEN
      : devAuthToken || LOCAL_DEV_SERVER_AUTH_TOKEN;
    return { serverUrl, authToken, usesLocalDevServer: true };
  }

  if (useDevOverride) {
    return {
      serverUrl: devServerUrl,
      authToken:
        devAuthToken || resolveCustomServerAuthToken(devServerUrl, configuredAuthToken),
      usesLocalDevServer: isLocalServerUrl(devServerUrl),
    };
  }

  return {
    serverUrl: configuredServerUrl,
    authToken: resolveCustomServerAuthToken(configuredServerUrl, configuredAuthToken),
    usesLocalDevServer: false,
  };
}
