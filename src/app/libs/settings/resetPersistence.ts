import { MEMORABLE_STATE_KEY } from "../identity/identity";

type ResetStorage = Pick<Storage, "removeItem">;

const PERSISTED_SETTING_KEYS = [
  "user_settings",
  MEMORABLE_STATE_KEY,
  "countryCode",
  "phoneNumber",
  "payNowName",
  "ls_bundle",
  "ls_force_relay",
  "ls_debug_stats",
  "ls_turn_api",
] as const;

/** Remove LetShare's persisted settings and identity before defaults are written back. */
export function clearPersistedSettings(storage: ResetStorage): void {
  for (const key of PERSISTED_SETTING_KEYS) {
    storage.removeItem(key);
  }
}
