import { useState } from "react";
import { markMeetingEntryBufferStart } from "@App/libs/meeting/meetingEntryBuffer";
import MeetingJoinLoader from "./MeetingJoinLoader";

/**
 * Full-screen buffer page shown by the /meeting route's <Suspense> while the
 * meeting chunk downloads. It must stay dependency-free (no MUI, no motion,
 * no i18n): the eager route shell imports it before any of those exist, and
 * it renders the very same elephant loader the in-meeting join screen uses,
 * so entry reads as one continuous "joining" experience.
 *
 * The background is resolved from the same localStorage settings the meeting
 * page consumes, so the buffer blends into the room it precedes.
 */

const FALLBACK_BACKGROUNDS: Record<string, string> = {
  light: "#F1F1F1",
  dark: "#121212",
  blue: "#e3f2fd",
  green: "#f1f8e9",
  sunset: "#fff3e0",
  coolGray: "#263238",
};

function resolveFallbackColors(): { background: string; color: string } {
  let userTheme = "light";
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem("user_settings");
    if (raw) {
      const parsed = JSON.parse(raw) as { userTheme?: unknown };
      if (typeof parsed.userTheme === "string" && parsed.userTheme) userTheme = parsed.userTheme;
    }
  } catch {
    userTheme = "light";
  }
  let resolved = String(userTheme);
  if (resolved === "system") {
    resolved = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return {
    background: FALLBACK_BACKGROUNDS[resolved] ?? FALLBACK_BACKGROUNDS.light,
    color: resolved === "dark" ? "#e6edf5" : "#243b56",
  };
}

export default function MeetingEntryFallback() {
  // Idempotent: the shared entry clock starts the moment the buffer becomes
  // visible (markMeetingEntryBufferStart keeps the first mark).
  const [colors] = useState(() => {
    markMeetingEntryBufferStart();
    return resolveFallbackColors();
  });

  return (
    <div
      data-testid="meeting-entry-fallback"
      style={{ position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center", background: colors.background, color: colors.color }}
    >
      <MeetingJoinLoader />
    </div>
  );
}
