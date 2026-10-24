export type PersistedFileHydrationState = "not-started" | "loading" | "complete";

/** Starts persisted payload hydration only after the user opens the download drawer. */
export function shouldStartPersistedFileHydration(
  open: boolean,
  state: PersistedFileHydrationState,
): boolean {
  return open && state === "not-started";
}
