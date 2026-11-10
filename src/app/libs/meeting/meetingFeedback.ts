import type { MeetingStage } from "./meetingManager";

export type MeetingServerConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";
export type MeetingConnectionNotice = "offline" | "reconnecting" | "disconnected" | null;

/** A member sound is only for a genuinely new remote join in an established room. */
export function shouldAnnounceMemberJoin(
  stage: MeetingStage,
  memberId: string,
  localId: string,
  existingMemberIds: Iterable<string>,
): boolean {
  if (stage !== "in-meeting" || !memberId || memberId === localId) return false;
  for (const existingId of existingMemberIds) {
    if (existingId === memberId) return false;
  }
  return true;
}

/** Resolve the visible meeting transport status from browser and server state. */
export function getMeetingConnectionNotice(
  browserOnline: boolean,
  serverState: MeetingServerConnectionState,
  awaitingServerConfirmation = false,
): MeetingConnectionNotice {
  if (!browserOnline) return "offline";
  if (awaitingServerConfirmation) return "reconnecting";
  if (serverState === "connecting" || serverState === "reconnecting") return "reconnecting";
  if (serverState === "disconnected") return "disconnected";
  return null;
}

export type MeetingConnectionBanner = MeetingConnectionNotice | "recovered";

export function transitionMeetingConnectionBanner(
  currentIssue: MeetingConnectionNotice,
  hadPreviousIssue: boolean,
): { banner: MeetingConnectionBanner; hasIssue: boolean } {
  if (currentIssue) return { banner: currentIssue, hasIssue: true };
  if (hadPreviousIssue) return { banner: "recovered", hasIssue: false };
  return { banner: null, hasIssue: false };
}

/**
 * Online events only mean the browser has a network interface again. Require a
 * subsequent server downlink before allowing an offline meeting to be marked
 * recovered. The listener exists only for the short confirmation window.
 */
export class MeetingConnectionRecoveryConfirmation {
  private offlineNeedsConfirmation = false;
  private disposeTrafficListener: (() => void) | null = null;
  private confirmationGeneration = 0;

  constructor(
    private readonly subscribeToServerTraffic: (listener: () => void) => () => void,
    private readonly onConfirmed: () => void,
  ) {}

  get awaitingConfirmation(): boolean {
    return this.disposeTrafficListener !== null;
  }

  markOffline(): void {
    this.confirmationGeneration += 1;
    this.stopListening();
    this.offlineNeedsConfirmation = true;
  }

  waitForServerConfirmation(): boolean {
    if (!this.offlineNeedsConfirmation) return false;
    this.stopListening();
    const generation = ++this.confirmationGeneration;
    this.disposeTrafficListener = this.subscribeToServerTraffic(() => {
      if (!this.offlineNeedsConfirmation || generation !== this.confirmationGeneration) return;
      this.confirmationGeneration += 1;
      this.offlineNeedsConfirmation = false;
      this.stopListening();
      this.onConfirmed();
    });
    return true;
  }

  dispose(): void {
    this.confirmationGeneration += 1;
    this.stopListening();
    this.offlineNeedsConfirmation = false;
  }

  private stopListening(): void {
    const dispose = this.disposeTrafficListener;
    this.disposeTrafficListener = null;
    dispose?.();
  }
}

type Tone = { frequency: number; offset: number; duration: number };

/** The member-join cue is short; invite rings repeat only while the invite is pending. */
export const MEETING_SOUND_CUES = {
  incomingInvite: [
    { frequency: 660, offset: 0, duration: 0.19 },
    { frequency: 880, offset: 0.035, duration: 0.19 },
    { frequency: 660, offset: 0.48, duration: 0.19 },
    { frequency: 880, offset: 0.515, duration: 0.19 },
  ],
  memberJoined: [
    { frequency: 784, offset: 0, duration: 0.12 },
    { frequency: 1046.5, offset: 0.115, duration: 0.2 },
  ],
} satisfies Record<string, Tone[]>;

export type MeetingRingResult = "started" | "already-ringing" | "locked" | "unsupported";
type AudioContextFactory = () => AudioContext | null;
type MeetingTimerScheduler = {
  set: (callback: () => void, delayMs: number) => number;
  clear: (timerId: number) => void;
};

const browserTimers: MeetingTimerScheduler = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (timerId) => window.clearTimeout(timerId),
};

export const MEETING_INVITE_RING_INTERVAL_MS = 2_400;
export const MEETING_INVITE_RING_MAX_MS = 60_000;

export function shouldRingIncomingMeetingInvite(
  hasPendingInvite: boolean,
  expiresAt: number,
  now: number,
  browserOnline: boolean,
  serverState: MeetingServerConnectionState,
  stoppedOrTerminal = false,
): boolean {
  return hasPendingInvite && !stoppedOrTerminal && expiresAt > now && browserOnline && serverState === "connected";
}

export function shouldRingOutgoingMeetingInvite(
  status: "sending" | "sent" | "accepted" | "rejected" | "expired" | undefined,
  meetingReady: boolean,
  targetHasJoined: boolean,
  serverConnected: boolean,
  startedAt: number,
  now: number,
): boolean {
  return (status === "sending" || status === "sent")
    && meetingReady
    && !targetHasJoined
    && serverConnected
    && now >= startedAt
    && now - startedAt < MEETING_INVITE_RING_MAX_MS;
}

export type OutgoingMeetingInviteState = {
  status: "sending" | "sent" | "accepted" | "rejected" | "expired";
  at: number;
  inviteId?: string;
};

/**
 * Keeps outgoing invite rings tied to the dialog and the actual invite attempt.
 * Closing the dialog or losing the server connection mutes the current attempt;
 * a new send can ring again after its `sending` state is observed.
 */
export class OutgoingMeetingInviteRingPolicy {
  private wasOpen: boolean;
  private wasServerConnected: boolean;
  private readonly mutedAttempts = new Map<string, { at: number; inviteId?: string }>();

  constructor(initialState: { open: boolean; serverConnected: boolean }) {
    this.wasOpen = initialState.open;
    this.wasServerConnected = initialState.serverConnected;
  }

  update(input: {
    open: boolean;
    serverConnected: boolean;
    meetingReady: boolean;
    inviteStates: Record<string, OutgoingMeetingInviteState>;
    memberIds: ReadonlySet<string>;
    now: number;
  }): Set<string> {
    if ((this.wasOpen && !input.open) || (this.wasServerConnected && !input.serverConnected)) {
      for (const [uniqId, invite] of Object.entries(input.inviteStates)) {
        if (invite.status === "sending" || invite.status === "sent") {
          this.mutedAttempts.set(uniqId, { at: invite.at, inviteId: invite.inviteId });
        }
      }
    }
    this.wasOpen = input.open;
    this.wasServerConnected = input.serverConnected;

    const rings = new Set<string>();
    for (const [uniqId, invite] of Object.entries(input.inviteStates)) {
      const muted = this.mutedAttempts.get(uniqId);
      if (muted) {
        if (invite.status === "accepted" || invite.status === "rejected" || invite.status === "expired") {
          this.mutedAttempts.delete(uniqId);
        } else if (
          invite.status === "sending"
          && (invite.at !== muted.at || (muted.inviteId !== undefined && invite.inviteId !== muted.inviteId))
        ) {
          this.mutedAttempts.delete(uniqId);
        } else {
          continue;
        }
      }
      if (!input.open) continue;
      if (shouldRingOutgoingMeetingInvite(
        invite.status,
        input.meetingReady,
        input.memberIds.has(uniqId),
        input.serverConnected,
        invite.at,
        input.now,
      )) {
        rings.add(`host-invite:${uniqId}`);
      }
    }
    return rings;
  }
}

function createBrowserAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor = browserWindow.AudioContext || browserWindow.webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
}

function browserSupportsAudioContext(): boolean {
  if (typeof window === "undefined") return false;
  const browserWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return Boolean(browserWindow.AudioContext || browserWindow.webkitAudioContext);
}

/**
 * Meeting-only notification audio. It does not share the remote media pipeline.
 * AudioContext is created/resumed only from an explicit user gesture; events that
 * arrive before that remain visible and can be replayed from the invite dialog.
 */
export class MeetingSoundPlayer {
  private context: AudioContext | null = null;
  private readonly activeRings = new Map<string, {
    cycleTimer: number;
    maxTimer: number;
    sources: Set<OscillatorNode>;
  }>();

  constructor(
    private readonly createContext: AudioContextFactory = createBrowserAudioContext,
    private readonly timers: MeetingTimerScheduler = browserTimers,
  ) {}

  get supported(): boolean {
    return this.context !== null || this.createContext !== createBrowserAudioContext || browserSupportsAudioContext();
  }

  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  async unlockFromGesture(): Promise<boolean> {
    try {
      if (!this.context) this.context = this.createContext();
      if (!this.context) return false;
      if (this.context.state !== "running") await this.context.resume();
      return this.context.state === "running";
    } catch {
      return false;
    }
  }

  startInviteRinging(inviteId: string): MeetingRingResult {
    if (!inviteId) return "unsupported";
    if (this.activeRings.has(inviteId)) return "already-ringing";
    if (!this.context) return this.supported ? "locked" : "unsupported";
    if (this.context.state !== "running") return "locked";

    const ring = { cycleTimer: 0, maxTimer: 0, sources: new Set<OscillatorNode>() };
    this.activeRings.set(inviteId, ring);
    const playCycle = () => {
      if (this.activeRings.get(inviteId) !== ring) return;
      this.playCue(MEETING_SOUND_CUES.incomingInvite, ring.sources);
      ring.cycleTimer = this.timers.set(playCycle, MEETING_INVITE_RING_INTERVAL_MS);
    };
    playCycle();
    ring.maxTimer = this.timers.set(() => this.stopInviteRinging(inviteId), MEETING_INVITE_RING_MAX_MS);
    return "started";
  }

  stopInviteRinging(inviteId: string): void {
    const ring = this.activeRings.get(inviteId);
    if (!ring) return;
    this.activeRings.delete(inviteId);
    this.timers.clear(ring.cycleTimer);
    this.timers.clear(ring.maxTimer);
    for (const source of ring.sources) {
      try { source.stop(); } catch { /* an oscillator may already have ended */ }
    }
    ring.sources.clear();
  }

  stopAllInviteRings(): void {
    for (const inviteId of [...this.activeRings.keys()]) this.stopInviteRinging(inviteId);
  }

  playMemberJoined(): boolean {
    if (!this.context || this.context.state !== "running") return false;
    this.playCue(MEETING_SOUND_CUES.memberJoined);
    return true;
  }

  private playCue(tones: readonly Tone[], activeSources?: Set<OscillatorNode>): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = now + tone.offset;
      const endAt = startAt + tone.duration;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.075, startAt + 0.015);
      gain.gain.setValueAtTime(0.075, endAt - 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      if (activeSources) {
        activeSources.add(oscillator);
        oscillator.onended = () => activeSources.delete(oscillator);
      }
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.01);
    }
  }
}

export const meetingSoundPlayer = new MeetingSoundPlayer();
