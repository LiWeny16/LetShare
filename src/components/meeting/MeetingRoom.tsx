/**
 * LetShare meeting room.
 * The meeting surface keeps the shared work area dominant while the
 * collaboration controls stay predictable: product bar, dark stage,
 * conversation rail, and a labelled control dock.
 */
import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  alpha,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import CallEndIcon from "@mui/icons-material/CallEnd";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import LinkIcon from "@mui/icons-material/Link";
import ChatIcon from "@mui/icons-material/Chat";
import PeopleIcon from "@mui/icons-material/People";
import GroupsIcon from "@mui/icons-material/Groups";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import CheckIcon from "@mui/icons-material/Check";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import PictureInPictureAltIcon from "@mui/icons-material/PictureInPictureAlt";
import realTimeColab from "@App/libs/connection/colabLib";
import settingsStore from "@App/libs/mobx/mobx";
import { RemoteAudioPipeline, clampSpeakerVolume } from "@App/libs/call/remoteAudioPipeline";
import { useTranslation } from "react-i18next";
import alertUseMUI from "@App/libs/tools/alert";
import { meetingManager, type PresentationFocusTarget } from "@App/libs/meeting/meetingManager";
import { getMeetingAiSecret, getMemberMeetingAiPreferences } from "@App/libs/meeting/meetingAi";
import { finalizeMeetingMinutes, getMeetingMinutesSession, ensureMeetingMinutesSession, subscribeMeetingMinutesSession } from "@App/libs/meeting/meetingMinutesSession";
import { saveMeetingMinutesHistory, toMeetingMinutesHistoryRecord } from "@App/libs/meeting/meetingMinutesHistory";
import { VideoWall } from "./components/VideoWall";
import { MemberTile } from "./components/MemberTile";
import { MeetingChat } from "./components/MeetingChat";
import { ParticipantsPanel } from "./components/ParticipantsPanel";
import { Whiteboard } from "./components/Whiteboard";
import { ExcalidrawBoard } from "./components/ExcalidrawBoard";
import MeetingInviteDialog from "./components/MeetingInviteDialog";
import MeetingMediaSettingsDialog from "./components/MeetingMediaSettingsDialog";
import MeetingAiMinutesDialog from "./components/MeetingAiMinutesDialog";
import MeetingMinutesConsentDialog from "./components/MeetingMinutesConsentDialog";
import MeetingMinutesEndScreen from "./components/MeetingMinutesEndScreen";
import { useLocalStream } from "./hooks/useLocalStream";
import { useMeetingTimer, formatDuration } from "./hooks/useMeetingTimer";
import { useSpeakingUsers } from "./hooks/useSpeakingUsers";
import { displayNameOf } from "./types";
import type { MemberTileData, FormFactor } from "./types";
import { bindMeetingVideo } from "./videoBinding";

export interface MeetingRoomProps {
  onExit: () => void;
}

const STAGE = "#ffffff";
const BLUE = "#1677ff";

async function toggleFullscreen(element: HTMLElement | null): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (element?.requestFullscreen) await element.requestFullscreen().catch(() => undefined);
}

export default function MeetingRoom({ onExit }: MeetingRoomProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobileBp = useMediaQuery(theme.breakpoints.down("sm"));
  const isTabletBp = useMediaQuery(theme.breakpoints.down("md"));
  const formFactor: FormFactor = isMobileBp ? "mobile" : isTabletBp ? "tablet" : "desktop";

  const state = meetingManager.getState();
  const [, force] = useState(0);
  const [focused, setFocused] = useState("");
  useEffect(() => meetingManager.subscribe(() => force((x) => x + 1)), []);

  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;
  useEffect(() => {
    const onMemberMinutesPreferences = () => {
      const next = getMemberMeetingAiPreferences();
      setMemberMinutesPreferences(next);
      setMinutesConsentDecision("pending");
      const current = meetingManager.getState();
      if (!next.enabled && current.minutes.running && current.hostId !== selfId) meetingManager.consentMinutes(false);
    };
    window.addEventListener("meeting-minutes-member-preferences", onMemberMinutesPreferences);
    return () => window.removeEventListener("meeting-minutes-member-preferences", onMemberMinutesPreferences);
  }, []);
  const inBreakout = /\d{4}B\d+$/.test(state.roomId ?? "");
  const meetingId = state.roomId || "";
  const title = state.title || t("meeting.untitled", "未命名会议");

  useEffect(() => {
    if (!meetingId) return undefined;
    ensureMeetingMinutesSession(meetingId, title);
    setMinutesSession(getMeetingMinutesSession());
    return subscribeMeetingMinutesSession(() => setMinutesSession(getMeetingMinutesSession()));
  }, [meetingId, title]);

  const [panelOpen, setPanelOpen] = useState(!isMobileBp);
  const [panelTab, setPanelTab] = useState(0);
  const [panelWidth, setPanelWidth] = useState(320);
  const panelResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [legacyWhiteboardOn, setLegacyWhiteboardOn] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [endingMinutes, setEndingMinutes] = useState(false);
  const [endMinutesError, setEndMinutesError] = useState("");
  const endingRef = useRef(false);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [breakoutRooms, setBreakoutRooms] = useState(2);
  const [breakoutActive, setBreakoutActive] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [applicantsOpen, setApplicantsOpen] = useState(false);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [minutesExpanded, setMinutesExpanded] = useState(false);
  const [minutesConsentDecision, setMinutesConsentDecision] = useState<"pending" | "accepted" | "rejected">("pending");
  const [memberMinutesPreferences, setMemberMinutesPreferences] = useState(() => getMemberMeetingAiPreferences());
  const [mediaSettingsVersion, setMediaSettingsVersion] = useState(0);
  const [privateChatTarget, setPrivateChatTarget] = useState<string | null>(null);
  const [stageFocusMode, setStageFocusMode] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState<"stage" | "room" | null>(null);
  const [minutesSession, setMinutesSession] = useState(() => getMeetingMinutesSession());
  const meetingShellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [sharingView, setSharingView] = useState<"screen" | "whiteboard">("screen");
  const [followPresenter, setFollowPresenter] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ requestId: string; from: string; target: Exclude<PresentationFocusTarget, ""> } | null>(null);
  const followedBoardRoomRef = useRef("");
  const whiteboardHiddenRef = useRef(false);
  const previousPresenterEpochRef = useRef(state.presentation.presenterEpoch);
  const previousPresenterFollowEpochRef = useRef(state.presentation.presenterFollowEpoch);
  const presenterId = state.presentation.presenterId;
  const presenterTarget = state.presentation.presenterTarget;
  const whiteboardOn = state.presentation.whiteboardActive && (legacyWhiteboardOn || (followPresenter && presenterTarget === "whiteboard"));
  const whiteboardMode = state.presentation.boardMode ?? "excalidraw";
  const screenOwnerId = state.presentation.screenOwnerId || (state.presentation.mode === "screen" ? state.presentation.ownerId : "");
  const isPresenter = presenterId === selfId;
  const presenterCameraAvailable = presenterTarget === "camera"
    || (presenterId === selfId ? state.cameraOn : Boolean(state.members.find((member) => member.uniqId === presenterId)?.media.cameraOn));
  const canReleasePresentation = screenOwnerId === selfId || amHost;
  const whiteboardLabel = !state.presentation.whiteboardActive
    ? t("meeting.whiteboard", "白板")
    : whiteboardOn
      ? t("meeting.wbClose", "关闭白板")
      : t("meeting.wbOpen", "打开白板");

  const local = useLocalStream(state.inMeeting, state.cameraOn, state.muted);
  const elapsed = useMeetingTimer(state.stage);

  const setWhiteboardLocalVisible = (visible: boolean, breakFollow = true) => {
    if (breakFollow) setFollowPresenter(false);
    whiteboardHiddenRef.current = !visible;
    setLegacyWhiteboardOn(visible);
    if (visible) setSharingView("whiteboard");
    if (!visible && isPresenter && presenterTarget === "whiteboard") {
      meetingManager.setPresenterTarget(screenOwnerId === selfId ? "screen" : "camera");
    }
  };

  useEffect(() => {
    if (!meetingId) {
      followedBoardRoomRef.current = "";
      whiteboardHiddenRef.current = false;
      previousPresenterEpochRef.current = 0;
      previousPresenterFollowEpochRef.current = 0;
      setFollowPresenter(true);
      setLegacyWhiteboardOn(false);
      return;
    }
    if (state.stage !== "in-meeting" || followedBoardRoomRef.current === meetingId) return;
    followedBoardRoomRef.current = meetingId;
    setFollowPresenter(true);
  }, [meetingId, state.stage]);

  useEffect(() => {
    const presenterChanged = previousPresenterEpochRef.current !== state.presentation.presenterEpoch;
    const requestedFollow = previousPresenterFollowEpochRef.current !== state.presentation.presenterFollowEpoch;
    previousPresenterEpochRef.current = state.presentation.presenterEpoch;
    previousPresenterFollowEpochRef.current = state.presentation.presenterFollowEpoch;
    if (presenterChanged || requestedFollow) {
      setFollowPresenter(true);
      whiteboardHiddenRef.current = false;
    }
  }, [state.presentation.presenterEpoch, state.presentation.presenterFollowEpoch]);

  useEffect(() => {
    if (!followPresenter) return;
    if (presenterTarget === "whiteboard" && state.presentation.whiteboardActive) {
      whiteboardHiddenRef.current = false;
      setLegacyWhiteboardOn(true);
      setSharingView("whiteboard");
    } else if (presenterTarget === "screen" && screenOwnerId) {
      setSharingView("screen");
      setLegacyWhiteboardOn(false);
    } else if (presenterTarget === "camera" && presenterId) {
      setFocused(`camera:${presenterId}`);
      setLegacyWhiteboardOn(false);
    }
  }, [followPresenter, presenterId, presenterTarget, screenOwnerId, state.presentation.whiteboardActive]);

  useEffect(() => {
    if (!state.presentation.whiteboardActive) {
      whiteboardHiddenRef.current = false;
      setLegacyWhiteboardOn(false);
      if (sharingView === "whiteboard") setSharingView("screen");
    }
  }, [sharingView, state.presentation.whiteboardActive]);

  useEffect(() => {
    setMinutesConsentDecision("pending");
  }, [meetingId, state.minutes.configured, state.minutes.running]);

  useEffect(() => {
    if (state.applicants.size > 0) setApplicantsOpen(true);
  }, [state.applicants.size]);

  // Keep the screen-share MediaStream identity stable while the underlying
  // track is unchanged. Recreating it on every meeting state update makes
  // the video element rebind and visibly flicker (for example on mute).
  const screenTrack = state.screenOn ? meetingManager.getScreenTrack() : null;
  const screenStream = useMemo(
    () => (screenTrack ? new MediaStream([screenTrack]) : null),
    [screenTrack],
  );

  const speakingSources = useMemo(() => {
    const localAudio = meetingManager.getLocalStream()?.getAudioTracks()[0] ?? local.stream?.getAudioTracks()[0];
    return [
      { uniqId: selfId, track: localAudio, enabled: state.inMeeting && !state.muted },
      ...state.remoteTracks
        .filter((remote) => remote.kind === "audio" && remote.track)
        .map((remote) => ({ uniqId: remote.uniqId, track: remote.track, enabled: true })),
    ];
  }, [local.stream, selfId, state.inMeeting, state.muted, state.remoteTracks]);
  const speakingUsers = useSpeakingUsers(speakingSources);

  useEffect(() => {
    return meetingManager.onEvent((ev) => {
      if (ev.type === "meeting:ended") {
        alertUseMUI(t("meeting.endedToast", "会议已结束"), 2500, { kind: "info" });
        if (endingRef.current) setMeetingEnded(true);
        else onExit();
      } else if (ev.type === "meeting:kicked") {
        alertUseMUI(t("meeting.kickedToast", "你已被移出会议"), 2500, { kind: "warning" });
        onExit();
      } else if (ev.type === "meeting:breakout") {
        if (ev.data.action === "invite") {
          setBreakoutActive(true);
          alertUseMUI(t("meeting.breakoutJoined", "已进入分组讨论"), 2000, { kind: "info" });
        } else if (ev.data.action === "recall") {
          setBreakoutActive(false);
          alertUseMUI(t("meeting.breakoutRecalled", "已返回主会场"), 2000, { kind: "info" });
        }
      } else if (ev.type === "meeting:media-control") {
        if (ev.data.action === "mute-all") {
          alertUseMUI(t("meeting.mutedByHost", "主持人已将全员静音"), 2500, { kind: "info" });
        } else if (ev.data.action === "request-unmute") {
          alertUseMUI(t("meeting.unmuteRequested", "主持人邀请你开启麦克风"), 3000, { kind: "warning" });
        }
      } else if (ev.type === "meeting:invite-status") {
        // 房主侧邀请回执 toast（manager 已按「本地发送过的邀请」过滤相关性）
        const who = displayNameOf(ev.data.uniqId);
        if (ev.data.action === "accept") {
          alertUseMUI(t("meeting.inviteAcceptedToast", "{{name}} 已接受邀请", { name: who }), 2500, { kind: "success" });
        } else if (ev.data.action === "reject") {
          alertUseMUI(t("meeting.inviteRejectedToast", "{{name}} 已拒绝邀请", { name: who }), 2500, { kind: "info" });
        }
      } else if (ev.type === "meeting:sharing-request") {
        if (ev.data.action === "focus-request" && ev.data.requestId && ev.data.from) {
          setFocusRequest({ requestId: ev.data.requestId, from: ev.data.from, target: ev.data.target === "screen" ? "screen" : "whiteboard" });
        } else if (ev.data.action === "focus-requested") {
          alertUseMUI(ev.data.target === "screen" ? "已向屏幕共享人发送聚焦请求" : "已向白板共享人发送聚焦请求", 2500, { kind: "info" });
        } else if (ev.data.action === "focus-response") {
          const targetLabel = ev.data.target === "screen" ? "视频" : "白板";
          alertUseMUI(ev.data.accepted ? `${targetLabel}聚焦请求已通过` : `${targetLabel}聚焦请求被拒绝`, 2500, { kind: ev.data.accepted ? "success" : "info" });
        }
      }
    });
  }, [onExit, t]);

  const tiles: MemberTileData[] = useMemo(() => {
    const selfName = realTimeColab.getUserName() ?? t("meeting.you", "You");
    const out: MemberTileData[] = [{
      tileKey: `camera:${selfId}`,
      uniqId: selfId,
      name: t("meeting.you", "我"),
      isSelf: true,
      videoStream: state.cameraOn ? (meetingManager.getLocalStream() ?? local.stream) : null,
      muted: state.muted,
      cameraOn: state.cameraOn,
      isSpeaking: speakingUsers.has(selfId),
    }];
    if (state.screenOn && screenOwnerId === selfId && screenStream) {
      out.push({
        tileKey: `screen:${selfId}`,
        uniqId: selfId,
        name: selfName,
        isSelf: true,
        isScreen: true,
        videoStream: screenStream,
        muted: true,
        cameraOn: true,
      });
    }

    const remoteVideos = new Map<string, typeof state.remoteTracks>();
    for (const member of state.members) remoteVideos.set(member.uniqId, []);
    for (const remote of state.remoteTracks) {
      if (remote.kind !== "video" || !remote.track) continue;
      const entries = remoteVideos.get(remote.uniqId) ?? [];
      entries.push(remote);
      remoteVideos.set(remote.uniqId, entries);
    }
    for (const [uniqId, entries] of remoteVideos) {
      const member = state.members.find((candidate) => candidate.uniqId === uniqId);
      if (!member) continue;
      const isActiveScreenOwner = screenOwnerId === uniqId;
      // A publisher with camera + screen has two video tracks. When camera is
      // off, the sole video track is the active screen. The server presentation
      // lease decides which member is eligible; this fallback never promotes a
      // non-owner's second track into Active Sharing.
      const explicitCamera = member.media.cameraTrackId
        ? entries.find((entry) => entry.track?.id === member.media.cameraTrackId || entry.stream.id === member.media.cameraTrackId) ?? null
        : null;
      const explicitScreen = member.media.screenTrackId
        ? entries.find((entry) => entry.track?.id === member.media.screenTrackId || entry.stream.id === member.media.screenTrackId) ?? null
        : null;
      // Presentation ownership is the authoritative Active Sharing state.
      // Do not additionally gate it on the separately-arriving media-state
      // packet: the two signals can cross in flight, leaving a blank sharing
      // surface even though the remote screen track has already arrived.
      const activeScreen = isActiveScreenOwner
        ? explicitScreen ?? entries.find((entry) => entry !== explicitCamera && entries.length > 1) ?? (!member.media.cameraOn ? entries[0] ?? null : null)
        : null;
      const cameraEntries = member.media.cameraOn
        ? [explicitCamera ?? entries.find((entry) => entry !== activeScreen) ?? null].filter(Boolean) as typeof entries
        : [];
      for (const remote of cameraEntries) {
        out.push({
          tileKey: `camera:${remote.uniqId}`,
          uniqId: remote.uniqId,
          name: displayNameOf(remote.uniqId, t("meeting.member", "成员")),
          isSelf: false,
          isScreen: false,
          videoStream: remote.stream,
          muted: member.media.muted,
          cameraOn: member.media.cameraOn,
          isSpeaking: !member.media.muted && speakingUsers.has(uniqId),
        });
      }
      if (cameraEntries.length === 0) {
        out.push({
          tileKey: `camera:${uniqId}`,
          uniqId,
          name: displayNameOf(uniqId),
          isSelf: false,
          videoStream: null,
          muted: member.media.muted,
          cameraOn: member.media.cameraOn,
          isSpeaking: !member.media.muted && speakingUsers.has(uniqId),
        });
      }
      if (activeScreen) {
        out.push({
          tileKey: `screen:${uniqId}`,
          uniqId,
          name: displayNameOf(uniqId),
          isSelf: false,
          isScreen: true,
          videoStream: activeScreen.stream,
          muted: true,
          cameraOn: true,
        });
      }
    }
    return out.map((tile) => {
      if (tile.isSelf) return { ...tile, name: selfName };
      const memberName = state.members.find((member) => member.uniqId === tile.uniqId)?.name;
      return memberName ? { ...tile, name: memberName } : tile;
    });
  }, [local.stream, screenOwnerId, screenStream, selfId, speakingUsers, state, t]);

  const screenTiles = tiles.filter((tile) => tile.isScreen);
  const camTiles = tiles.filter((tile) => !tile.isScreen);
  const activeScreenTile = screenTiles[0] ?? null;
  const focusId = focused;
  const focusedTile = camTiles.find((tile) => tile.tileKey === focusId) ?? null;
  const secondaryCamTiles = focusedTile ? camTiles.filter((tile) => tile.tileKey !== focusedTile.tileKey) : camTiles;
  const activeSharingMode: "screen" | "whiteboard" | "" = sharingView === "whiteboard" && whiteboardOn
    ? "whiteboard"
    : followPresenter && presenterTarget === "screen" && screenOwnerId
      ? "screen"
      : whiteboardOn
        ? "whiteboard"
        : "";
  const hasActiveSharing = activeSharingMode !== "";
  const globalSharingMode: "screen" | "whiteboard" | "camera" | "" = presenterTarget === "screen" && screenOwnerId
    ? "screen"
    : presenterTarget === "whiteboard" && state.presentation.whiteboardActive
      ? "whiteboard"
      : presenterTarget === "camera" && presenterId
        ? "camera"
        : "";
  const hasGlobalSharing = globalSharingMode !== "";

  useEffect(() => {
    const syncFullscreenState = () => {
      if (document.fullscreenElement === stageRef.current) setNativeFullscreen("stage");
      else if (document.fullscreenElement === meetingShellRef.current) setNativeFullscreen("room");
      else setNativeFullscreen(null);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!whiteboardOn && sharingView === "whiteboard") setSharingView("screen");
    if (!screenOwnerId && whiteboardOn) setSharingView("whiteboard");
  }, [screenOwnerId, sharingView, whiteboardOn]);

  useEffect(() => {
    if (focused && !camTiles.some((tile) => tile.tileKey === focused)) setFocused("");
  }, [camTiles, focused]);

  const focusCameraTile = (tileKey: string) => {
    setFocused(tileKey);
    // A local camera selection is an intentional escape from the shared
    // whiteboard view. Keep the board session alive, but stop following it so
    // the active bar can offer “继续跟随共享人”. A server-forced board focus
    // remains non-dismissable by design.
    if (whiteboardOn && followPresenter) {
      setFollowPresenter(false);
      whiteboardHiddenRef.current = true;
      setLegacyWhiteboardOn(false);
    }
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioTrackKey = state.remoteTracks
    .filter((remote) => remote.kind === "audio" && remote.track)
    .map((remote) => remote.track!.id)
    .join("|");
  const remoteAudioStream = useMemo(() => {
    const stream = new MediaStream();
    for (const remote of state.remoteTracks) {
      if (remote.kind === "audio" && remote.track) stream.addTrack(remote.track);
    }
    return stream;
  }, [state.remoteTracks]);
  const remoteAudioPipelineRef = useRef<RemoteAudioPipeline | null>(null);
  const previousRemoteAudioTrackKeyRef = useRef<string | null>(null);
  const previousMediaSettingsVersionRef = useRef<number | null>(null);
  useEffect(() => {
    const audioTracksChanged = previousRemoteAudioTrackKeyRef.current !== remoteAudioTrackKey;
    const settingsChanged = previousMediaSettingsVersionRef.current !== mediaSettingsVersion;
    previousRemoteAudioTrackKeyRef.current = remoteAudioTrackKey;
    previousMediaSettingsVersionRef.current = mediaSettingsVersion;
    // Video/screen tracks are stored in the same remoteTracks array. They must
    // not tear down an otherwise healthy remote audio decoder/playback graph.
    if (!audioTracksChanged && !settingsChanged) return;

    const audio = audioRef.current;
    const pipeline = (remoteAudioPipelineRef.current ??= new RemoteAudioPipeline());
    pipeline.detach();
    if (remoteAudioStream.getAudioTracks().length === 0) {
      if (audio) audio.srcObject = null;
      return;
    }
    const active = pipeline.attach(remoteAudioStream, {
      volume: Number(settingsStore.get("speakerVolume") ?? 1),
      clarity: settingsStore.get("voiceClarityEnabled") ?? true,
      widen: settingsStore.get("spatialAudioEnabled") ?? false,
    });
    const sinkId = settingsStore.get("speakerDeviceId") ?? "";
    if (active) {
      pipeline.resume();
      if (sinkId) void pipeline.setSinkId(sinkId);
      if (audio) {
        // Keep the same hidden native sink used by ordinary calls. Chromium
        // may otherwise stop driving remote NetEq/decoder output when the
        // WebAudio graph is rebuilt or a second remote track arrives.
        audio.srcObject = remoteAudioStream;
        audio.muted = true;
        audio.volume = 0;
        void audio.play().catch(() => undefined);
      }
    } else if (audio) {
      audio.srcObject = remoteAudioStream;
      audio.muted = false;
      audio.volume = Math.min(1, clampSpeakerVolume(Number(settingsStore.get("speakerVolume") ?? 1)));
      const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (sinkId && setSinkId) void setSinkId.call(audio, sinkId).catch(() => undefined);
      void audio.play().catch(() => undefined);
    }
  }, [remoteAudioStream, remoteAudioTrackKey, mediaSettingsVersion]);

  // Browsers may create the remote audio context after the route transition,
  // outside the original join gesture. Retry both playback paths on the next
  // user gesture so a suspended context cannot leave the meeting silent.
  useEffect(() => {
    const unlockRemoteAudio = () => {
      remoteAudioPipelineRef.current?.resume();
      const audio = audioRef.current;
      if (audio?.srcObject && audio.paused) void audio.play().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlockRemoteAudio, { passive: true });
    window.addEventListener("keydown", unlockRemoteAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockRemoteAudio);
      window.removeEventListener("keydown", unlockRemoteAudio);
    };
  }, []);

  useEffect(() => () => {
    remoteAudioPipelineRef.current?.detach();
    remoteAudioPipelineRef.current = null;
  }, []);

  const applyMeetingMediaSettings = async () => {
    try {
      await meetingManager.applyMediaSettings();
    } catch (error) {
      console.warn("[meeting] media settings apply failed", error);
      alertUseMUI(t("meeting.mediaSettingsFailed", "媒体设置应用失败，请检查设备权限或重新选择设备"), 3000, { kind: "error" });
    }
  };

  const control = (
    icon: ReactNode,
    label: string,
    onClick: () => void,
    active = false,
    danger = false,
    disabled = false,
    testId?: string,
  ) => {
    const effectiveTestId = testId ?? (
      isValidElement(icon) && (icon.type === ScreenShareIcon || icon.type === StopScreenShareIcon)
        ? "meeting-share-screen"
        : undefined
    );
    return (
    <Tooltip title={label} arrow>
      <span>
        <Button
          onClick={onClick}
          aria-label={label}
          data-testid={effectiveTestId}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          startIcon={icon}
          sx={{
            minHeight: 38,
            minWidth: { xs: 44, sm: "auto" },
            px: { xs: 1.25, sm: 1.5 },
            borderRadius: 1.75,
            color: danger ? "common.white" : active ? BLUE : "text.secondary",
            bgcolor: danger ? "error.main" : active ? alpha(BLUE, 0.1) : "transparent",
            opacity: disabled ? 0.48 : 1,
            fontWeight: 650,
            fontSize: "0.78rem",
            textTransform: "none",
            transition: "transform 120ms ease-out, background-color 150ms ease-out, color 150ms ease-out",
            "&:hover": {
              bgcolor: danger ? "error.dark" : active ? alpha(BLUE, 0.16) : alpha(theme.palette.text.primary, 0.06),
            },
            "&:active": { transform: "scale(0.96)" },
            "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } },
            "& .control-label": { display: { xs: "none", sm: "inline" } },
          }}
        >
          <Box component="span" className="control-label">{label}</Box>
        </Button>
      </span>
    </Tooltip>
    );
  };

  const breakoutPreview = useMemo(() => {
    const others = state.members.filter((member) => member.uniqId !== selfId);
    const groups: string[][] = Array.from({ length: breakoutRooms }, () => []);
    others.forEach((member, index) => groups[index % breakoutRooms].push(member.uniqId));
    return groups;
  }, [breakoutRooms, selfId, state.members]);

  const startBreakout = () => {
    const assignments = breakoutPreview
      .map((members, index) => ({ room: `${meetingId}B${index + 1}`, members }))
      .filter((assignment) => assignment.members.length > 0);
    if (assignments.length === 0) return;
    meetingManager.breakoutCreate(assignments);
    setBreakoutActive(true);
    setBreakoutOpen(false);
    alertUseMUI(t("meeting.breakoutStarted", "已开始分组讨论"), 2000, { kind: "success" });
  };

  const onPanelResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobileBp || !panelOpen) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth };
  };

  const onPanelResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panelResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextWidth = drag.startWidth - (event.clientX - drag.startX);
    if (nextWidth <= 244) {
      panelResizeRef.current = null;
      setPanelOpen(false);
      return;
    }
    setPanelWidth(Math.min(520, Math.max(260, nextWidth)));
  };

  const onPanelResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panelResizeRef.current?.pointerId !== event.pointerId) return;
    panelResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleEndMeeting = async () => {
    if (endingMinutes) return;
    setEndingMinutes(true);
    setEndMinutesError("");
    try {
      const finalized = await finalizeMeetingMinutes();
      if (finalized) await saveMeetingMinutesHistory(toMeetingMinutesHistoryRecord(finalized));
      endingRef.current = true;
      setMinutesSession(getMeetingMinutesSession());
      setEndDialogOpen(false);
      setMeetingEnded(true);
      meetingManager.endMeeting();
    } catch (error) {
      setEndMinutesError(error instanceof Error ? error.message : "会议纪要生成失败，请稍后重试");
    } finally {
      setEndingMinutes(false);
    }
  };

  if (meetingEnded && minutesSession) {
    return <MeetingMinutesEndScreen record={toMeetingMinutesHistoryRecord(minutesSession)} onExit={onExit} />;
  }

  return (
    <Stack
      ref={meetingShellRef}
      data-testid="meeting-shell"
      data-layout={stageFocusMode ? "stage-focus" : "normal"}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        overflow: "hidden",
        bgcolor: "background.paper",
        color: "text.primary",
        "&:fullscreen": { bgcolor: "background.paper" },
      }}
    >
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />

      {hasGlobalSharing && (
        <Box
          data-testid="meeting-active-sharing-layer"
          sx={{ position: "absolute", inset: 0, zIndex: 1300, pointerEvents: "none" }}
        >
          <ActiveSharingBarV2
            mode={globalSharingMode}
            screenAvailable={Boolean(screenOwnerId)}
            whiteboardAvailable={state.presentation.whiteboardActive}
            cameraAvailable={presenterCameraAvailable}
            presenterId={presenterId}
            presenterTarget={presenterTarget}
            followPresenter={followPresenter}
            isPresenter={isPresenter}
            canClose={!isPresenter && (globalSharingMode === "whiteboard" ? whiteboardOn : globalSharingMode === "screen" ? canReleasePresentation : false)}
            onClose={() => globalSharingMode === "whiteboard" ? setWhiteboardLocalVisible(false) : meetingManager.releasePresentation("screen")}
            onToggleFollow={() => {
              const next = !followPresenter;
              setFollowPresenter(next);
              whiteboardHiddenRef.current = !next;
              setLegacyWhiteboardOn(next && presenterTarget === "whiteboard" && state.presentation.whiteboardActive);
              if (next) {
                if (presenterTarget === "whiteboard") setSharingView("whiteboard");
                if (presenterTarget === "screen") setSharingView("screen");
                if (presenterTarget === "camera" && presenterId) setFocused(`camera:${presenterId}`);
              }
            }}
            onClaimPresenter={() => meetingManager.claimPresenter()}
            onRequestEveryoneFollow={() => meetingManager.requestEveryoneFollowPresenter()}
            onReleasePresenter={() => meetingManager.releasePresenter()}
            onSelectMode={(next) => {
              if (next === "whiteboard" && !whiteboardOn) {
                setFollowPresenter(true);
                whiteboardHiddenRef.current = false;
                setLegacyWhiteboardOn(state.presentation.whiteboardActive);
              }
              if (isPresenter) {
                meetingManager.setPresenterTarget(next);
              } else {
                setFollowPresenter(false);
                if (next === "camera" && presenterId) setFocused(`camera:${presenterId}`);
                else if (next !== "camera") setSharingView(next);
              }
            }}
          />
        </Box>
      )}

      <Box
        component="header"
        sx={{
          flexShrink: 0,
          height: { xs: 52, sm: 58 },
          px: { xs: 1.25, sm: 2.5 },
          display: "flex",
          alignItems: "center",
          gap: { xs: 1, sm: 2 },
          bgcolor: "background.paper",
          borderBottom: (th) => `1px solid ${alpha(th.palette.divider, 0.7)}`,
        }}
      >
        <BrandMark />
        <Typography sx={{ fontWeight: 800, letterSpacing: "-0.04em", fontSize: { xs: "1rem", sm: "1.08rem" }, color: "#12306a" }}>
          LetShare
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ my: 1.35, display: { xs: "none", sm: "block" } }} />
        <Typography noWrap sx={{ maxWidth: { xs: 130, sm: 280 }, fontSize: { xs: "0.82rem", sm: "0.9rem" }, fontWeight: 700 }}>
          {title}
        </Typography>
        {inBreakout && <Chip label={t("meeting.breakoutChip", "分组讨论")} size="small" color="warning" variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" alignItems="center" spacing={{ xs: 0.75, sm: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={0.6} sx={{ display: { xs: "none", sm: "flex" } }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: state.stage === "in-meeting" ? "success.main" : "warning.main" }} />
            <Typography sx={{ fontSize: "0.76rem", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(elapsed)}
            </Typography>
          </Stack>
          <Chip
            data-testid="meeting-people-count"
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            label={state.members.length + 1}
            size="small"
            onClick={() => { setPanelTab(1); setPanelOpen(true); }}
            sx={{ bgcolor: alpha(BLUE, 0.07), color: "text.secondary", fontWeight: 700, "& .MuiChip-icon": { color: BLUE } }}
          />
          {state.mediaError && (
            <Tooltip
              arrow
              title={
                state.mediaError === "denied"
                  ? t("meeting.mediaDenied", "摄像头/麦克风权限被拒绝，请在浏览器授权后重新开启摄像头")
                  : state.mediaError === "not-found"
                    ? t("meeting.mediaNotFound", "未找到可用的摄像头/麦克风，仅订阅模式继续")
                    : t("meeting.mediaFailed", "摄像头/麦克风获取失败，可重新点击摄像头开关重试")
              }
            >
              <Chip
                data-testid="meeting-media-error"
                label={
                  state.mediaError === "denied"
                    ? t("meeting.mediaDeniedShort", "媒体权限被拒")
                    : state.mediaError === "not-found"
                      ? t("meeting.mediaNotFoundShort", "无摄像头/麦克风")
                      : t("meeting.mediaFailedShort", "媒体获取失败")
                }
                size="small"
                sx={{ bgcolor: alpha("#f59e0b", 0.14), color: "#b45309", fontWeight: 700, fontSize: "0.68rem", height: 23 }}
              />
            </Tooltip>
          )}
          {meetingId && (
            <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<LinkIcon />}
              data-testid="meeting-invite-open"
              onClick={() => setInviteOpen(true)}
              sx={{ display: { xs: "none", sm: "inline-flex" }, borderRadius: 2, textTransform: "none", fontWeight: 700, color: BLUE, borderColor: alpha(BLUE, 0.35) }}
            >
              {t("meeting.invite", "邀请成员")}
            </Button>
            <Tooltip title={t("meeting.invite", "邀请成员")}>
              <IconButton
                onClick={() => setInviteOpen(true)}
                aria-label={t("meeting.invite", "邀请成员")}
                data-testid="meeting-invite-open-mobile"
                sx={{ display: { xs: "inline-flex", sm: "none" }, color: BLUE, bgcolor: alpha(BLUE, 0.07), width: 44, height: 44 }}
              >
                <LinkIcon />
              </IconButton>
            </Tooltip>
            </>
          )}
          <Tooltip title={t("meeting.settings", "会议设置")}>
            <IconButton
              data-testid="meeting-media-settings-open"
              aria-label={t("meeting.settings", "会议设置")}
              onClick={() => setMediaSettingsOpen(true)}
              sx={{ color: mediaSettingsOpen ? BLUE : "text.secondary", bgcolor: mediaSettingsOpen ? alpha(BLUE, 0.1) : "transparent" }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={t("meeting.panelOpen", "打开面板")}
            sx={{ display: { md: "none" }, color: panelOpen ? BLUE : "text.secondary", bgcolor: panelOpen ? alpha(BLUE, 0.1) : "transparent" }}
          >
            {panelOpen ? <CloseIcon /> : <ChatIcon />}
          </IconButton>
        </Stack>
      </Box>

      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "flex",
          gap: { xs: 0.75, sm: 1.25 },
          p: { xs: 0.75, sm: 1.25 },
          bgcolor: "#f4f7fb",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", gap: 1 }}>
          <Box
            ref={stageRef}
            data-testid="meeting-stage-surface"
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              overflow: "hidden",
              bgcolor: STAGE,
              borderRadius: { xs: 2, sm: 2.5 },
              border: `1px solid ${alpha("#fff", 0.06)}`,
              boxShadow: "0 14px 32px rgba(14, 29, 53, 0.12)",
            }}
          >
            {!minutesExpanded && <Stack direction="row" alignItems="center" spacing={1} sx={{ position: "absolute", top: 10, left: 16, right: 10, zIndex: 2, pointerEvents: "auto", minWidth: 0 }}>
              <Typography sx={{ color: "#13233d", fontSize: "0.75rem", fontWeight: 750, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeSharingMode === "screen" ? t("meeting.screenSharing", "正在共享屏幕") : activeSharingMode === "whiteboard" ? t("meeting.whiteboard", "白板") : t("meeting.stage", "会议舞台")}
              </Typography>
              <Chip
                data-testid="meeting-stage"
                data-stage={state.stage}
                data-media-error={state.mediaError || ""}
                label={state.stage === "in-meeting" ? t("meeting.inMeeting", "会议中") : t("meeting.joining", "正在加入")}
                size="small"
                sx={{ height: 23, flexShrink: 0, color: "#355070", bgcolor: alpha(BLUE, 0.08), border: `1px solid ${alpha(BLUE, 0.12)}`, fontSize: "0.68rem", fontWeight: 700 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }} />
              <Tooltip title={stageFocusMode ? t("meeting.stageRestore", "还原布局") : t("meeting.stageFocus", "专注舞台")}>
                <IconButton
                  data-testid="meeting-stage-focus"
                  aria-label={stageFocusMode ? t("meeting.stageRestore", "还原布局") : t("meeting.stageFocus", "专注舞台")}
                  onClick={() => {
                    const next = !stageFocusMode;
                    setStageFocusMode(next);
                    if (next) setPanelOpen(false);
                    else setPanelOpen(true);
                  }}
                  sx={{ width: 40, height: 40, color: stageFocusMode ? BLUE : "#58708e", bgcolor: "rgba(255,255,255,.82)", border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {stageFocusMode ? <FullscreenExitIcon fontSize="small" /> : <CenterFocusStrongIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={nativeFullscreen === "stage" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏舞台")}>
                <IconButton
                  data-testid="meeting-stage-fullscreen"
                  aria-label={nativeFullscreen === "stage" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreen", "全屏舞台")}
                  onClick={() => void toggleFullscreen(stageRef.current)}
                  sx={{ width: 40, height: 40, color: nativeFullscreen === "stage" ? BLUE : "#58708e", bgcolor: "rgba(255,255,255,.82)", border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {nativeFullscreen === "stage" ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={nativeFullscreen === "room" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreenWithChat", "全屏并保留聊天")}>
                <IconButton
                  data-testid="meeting-stage-fullscreen-chat"
                  aria-label={nativeFullscreen === "room" ? t("meeting.exitFullscreen", "退出全屏") : t("meeting.fullscreenWithChat", "全屏并保留聊天")}
                  onClick={() => { setPanelOpen(true); void toggleFullscreen(meetingShellRef.current); }}
                  sx={{ width: 40, height: 40, color: nativeFullscreen === "room" ? BLUE : "#58708e", bgcolor: "rgba(255,255,255,.82)", border: `1px solid ${alpha(BLUE, 0.12)}` }}
                >
                  {nativeFullscreen === "room" ? <FullscreenExitIcon fontSize="small" /> : <PictureInPictureAltIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>}
            <Box sx={{ position: "absolute", inset: 0, p: minutesExpanded ? 0 : { xs: 1, sm: 1.5 }, pt: minutesExpanded ? 0 : { xs: 5, sm: 5.5 }, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <Box sx={{ display: minutesExpanded ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
                <MeetingAiMinutesDialog
                  open={minutesExpanded}
                  mode="workspace"
                  embedded
                  onClose={() => {
                    setMinutesExpanded(false);
                  }}
                />
              </Box>
              <Box sx={{ display: minutesExpanded ? "none" : "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
              {focusedTile ? (
                <Stack spacing={1} sx={{ height: "100%", minHeight: 0 }}>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <MemberTile
                      tile={{ ...focusedTile, isExpanded: true }}
                      isFocused
                      onFocus={() => setFocused("")}
                    />
                  </Box>
                  {hasActiveSharing && (
                    <Box sx={{ height: { xs: 124, sm: 164 }, flexShrink: 0 }}>
                      <ActiveSharingSurface
                        mode={activeSharingMode}
                        boardMode={whiteboardMode}
                        followPresentation={followPresenter}
                        tile={activeScreenTile}
                        compact
                        onActivate={() => setFocused("")}
                      />
                    </Box>
                  )}
                  {isMobileBp && secondaryCamTiles.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ height: 104, flexShrink: 0, overflowX: "auto", pb: 0.25 }}>
                      {secondaryCamTiles.map((tile) => (
                        <Box key={tile.tileKey} sx={{ width: 164, flex: "0 0 auto", minHeight: 0 }}>
                          <MemberTile tile={tile} isFocused={false} onFocus={() => focusCameraTile(tile.tileKey)} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Stack>
              ) : hasActiveSharing ? (
                <Stack spacing={1} sx={{ height: "100%", minHeight: 0 }}>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <ActiveSharingSurface
                      mode={activeSharingMode}
                      boardMode={whiteboardMode}
                      followPresentation={followPresenter}
                      tile={activeScreenTile}
                      onActivate={() => activeScreenTile && setFocused(activeScreenTile.tileKey)}
                    />
                  </Box>
                  {isMobileBp && camTiles.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ height: 104, flexShrink: 0, overflowX: "auto", pb: 0.25 }}>
                      {camTiles.map((tile) => (
                        <Box key={tile.tileKey} sx={{ width: 164, flex: "0 0 auto", minHeight: 0 }}>
                          <MemberTile tile={tile} isFocused={false} onFocus={() => focusCameraTile(tile.tileKey)} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Stack>
              ) : (
              <VideoWall tiles={camTiles} focusedUniqId={focusId} onSelectFocus={focusCameraTile} formFactor={formFactor} />
              )}
              </Box>
            </Box>
          </Box>

          {(hasActiveSharing || focusedTile) && !isMobileBp && (
            <Stack spacing={1} sx={{ width: { sm: 138, md: 168 }, flexShrink: 0, overflowY: "auto", pb: 0.5 }}>
              {secondaryCamTiles.length > 0 ? secondaryCamTiles.map((tile) => (
                <Box key={tile.tileKey} sx={{ height: { sm: 82, md: 95 }, flexShrink: 0 }}>
                  <MemberTile tile={tile} isFocused={focusId === tile.tileKey} onFocus={() => focusCameraTile(tile.tileKey)} />
                </Box>
              )) : (
                <Typography sx={{ p: 1, color: "text.secondary", fontSize: "0.75rem", textAlign: "center" }}>暂无摄像头成员</Typography>
              )}
            </Stack>
          )}
        </Box>

        {!panelOpen && !stageFocusMode && (
          <Tooltip title={t("meeting.panelOpen", "打开面板")}>
            <IconButton
              data-testid="meeting-panel-toggle"
              onClick={() => setPanelOpen(true)}
              aria-label={t("meeting.panelOpen", "打开面板")}
              sx={{
                position: "absolute",
                right: { xs: 4, sm: 8 },
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 8,
                width: 46,
                height: 46,
                bgcolor: "background.paper",
                color: BLUE,
                border: (th) => `1px solid ${alpha(th.palette.divider, 0.8)}`,
                boxShadow: "0 8px 22px rgba(14, 29, 53, .16)",
                "&:hover": { bgcolor: alpha(BLUE, 0.08) },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Tooltip>
        )}
        {panelOpen && !isMobileBp && <Box
          role="separator"
          aria-orientation="vertical"
          aria-label="调整面板宽度"
          onPointerDown={onPanelResizeStart}
          onPointerMove={onPanelResizeMove}
          onPointerUp={onPanelResizeEnd}
          onPointerCancel={onPanelResizeEnd}
          onDoubleClick={() => setPanelWidth(320)}
          sx={{ width: 8, flexShrink: 0, cursor: "col-resize", touchAction: "none", position: "relative", "&::after": { content: '""', position: "absolute", left: 3, top: 10, bottom: 10, width: 2, borderRadius: 1, bgcolor: "transparent", transition: "background-color 120ms ease" }, "&:hover::after": { bgcolor: alpha(BLUE, 0.35) } }}
        />}
        <Paper
          component="aside"
          data-testid="meeting-panel"
          elevation={0}
          sx={{
            flexShrink: 0,
            display: panelOpen ? "flex" : "none",
            flexDirection: "column",
            minHeight: 0,
            width: isMobileBp ? "auto" : panelWidth,
            borderRadius: { xs: 2, sm: 2.5 },
            overflow: "hidden",
            border: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`,
            bgcolor: "background.paper",
            boxShadow: "0 8px 24px rgba(14, 29, 53, 0.06)",
            position: isMobileBp ? "fixed" : "static",
            left: isMobileBp ? 8 : undefined,
            right: isMobileBp ? 8 : undefined,
            top: isMobileBp ? 58 : undefined,
            bottom: isMobileBp ? 66 : undefined,
            zIndex: isMobileBp ? 40 : undefined,
          }}
        >
          <Tabs
            value={panelTab}
            onChange={(_, value) => setPanelTab(value)}
            variant="fullWidth"
            sx={{ minHeight: 48, borderBottom: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`, "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0" } }}
          >
            <Tab icon={<ChatIcon sx={{ fontSize: 18 }} />} iconPosition="start" label={t("meeting.chat", "聊天")} sx={{ minHeight: 48, fontSize: "0.8rem", fontWeight: 750, textTransform: "none" }} />
            <Tab icon={<PeopleIcon sx={{ fontSize: 18 }} />} iconPosition="start" label={`${t("meeting.participants", "成员")} ${state.members.length + 1}`} sx={{ minHeight: 48, fontSize: "0.8rem", fontWeight: 750, textTransform: "none" }} />
            <Tab icon={<AutoAwesomeIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="AI 纪要" sx={{ minHeight: 48, fontSize: "0.8rem", fontWeight: 750, textTransform: "none" }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box sx={{ display: panelTab === 0 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <MeetingChat initialTarget={privateChatTarget} />
            </Box>
            <Box sx={{ display: panelTab === 1 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <ParticipantsPanel
                state={state}
                onStartPrivateChat={(uniqId) => {
                  setPrivateChatTarget(uniqId);
                  setPanelTab(0);
                  setPanelOpen(true);
                }}
              />
            </Box>
            <Box sx={{ display: panelTab === 2 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              <Box sx={{ display: minutesExpanded ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}><Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1, px: 2, textAlign: "center", color: "text.secondary" }}><NotesOutlinedIcon sx={{ color: BLUE, fontSize: 28 }} /><Typography sx={{ fontSize: "0.84rem", fontWeight: 800, color: "text.primary" }}>AI 会议纪要详情见左边</Typography><Typography sx={{ fontSize: "0.7rem", lineHeight: 1.5 }}>右侧保留聊天和成员，会议纪要正在左侧工作区展示。</Typography><Button variant="text" startIcon={<ArrowBackIcon />} onClick={() => setMinutesExpanded(false)} sx={{ mt: 0.5, minHeight: 40, color: BLUE, textTransform: "none", fontWeight: 800 }}>返回并关闭详情</Button></Stack></Box>
              <Box sx={{ display: minutesExpanded ? "none" : "flex", flex: 1, minHeight: 0, flexDirection: "column" }}><MeetingAiMinutesDialog
                open={panelTab === 2 && !minutesExpanded}
                mode="panel"
                onClose={() => {
                  setPanelTab(2);
                  setPanelOpen(true);
                }}
                onExpand={() => setMinutesExpanded(true)}
              /></Box>
            </Box>
          </Box>
        </Paper>
      </Box>

      <Box
        component="footer"
        sx={{
          flexShrink: 0,
          minHeight: { xs: 58, sm: 64 },
          px: { xs: 0.75, sm: 2.5 },
          py: 0.65,
          display: "flex",
          alignItems: "center",
          gap: { xs: 0.25, sm: 1 },
          bgcolor: "background.paper",
          borderTop: (th) => `1px solid ${alpha(th.palette.divider, 0.75)}`,
        }}
      >
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.25, sm: 1 },
            overflowX: { xs: "auto", sm: "visible" },
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
            "& > span": { flexShrink: 0 },
          }}
        >
        {control(state.muted ? <MicOffIcon /> : <MicIcon />, state.muted ? t("meeting.unmute", "解除静音") : t("meeting.mute", "静音"), () => meetingManager.setMuted(!state.muted), !state.muted, false, state.stage !== "in-meeting")}
        {control(state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />, state.cameraOn ? t("meeting.stopVideo", "关闭摄像头") : t("meeting.startVideo", "开启摄像头"), () => meetingManager.setCameraOn(!state.cameraOn), state.cameraOn, false, state.stage !== "in-meeting")}
        {control(state.screenOn ? <StopScreenShareIcon /> : <ScreenShareIcon />, state.screenOn ? t("meeting.stopShare", "停止共享") : t("meeting.shareScreen", "共享屏幕"), () => state.screenOn ? meetingManager.stopScreenShare() : void meetingManager.startScreenShare(), state.screenOn, false, state.stage !== "in-meeting")}
        {control(<EditIcon />, whiteboardLabel, () => {
          if (!state.presentation.whiteboardActive) {
            meetingManager.claimPresentation("whiteboard", "excalidraw");
          } else {
            setWhiteboardLocalVisible(!whiteboardOn);
          }
        }, whiteboardOn, false, state.stage !== "in-meeting", "meeting-whiteboard-toggle")}
        {control(panelOpen ? <CloseIcon /> : <ChatIcon />, panelOpen ? t("meeting.panelClose", "收起面板") : t("meeting.panelOpen", "打开面板"), () => setPanelOpen((value) => !value), panelOpen)}
        {amHost && !breakoutActive && control(<GroupsIcon />, t("meeting.breakout", "分组讨论"), () => setBreakoutOpen(true), false, false, state.stage !== "in-meeting")}
        {amHost && breakoutActive && control(<GroupsIcon />, t("meeting.breakoutRecallBtn", "召集回归"), () => { meetingManager.breakoutRecall(); setBreakoutActive(false); }, false)}
         {control(<AutoAwesomeIcon />, t("meeting.aiMinutes", "AI 会议纪要"), () => setMinutesExpanded((value) => !value), minutesExpanded, false, state.stage !== "in-meeting", "meeting-ai-minutes-open")}
        </Box>
        <Stack direction="row" alignItems="center" spacing={{ xs: 0.25, sm: 1 }} sx={{ flexShrink: 0 }}>
          {amHost && (
          <>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CallEndIcon />}
              aria-label={t("meeting.endForAll", "结束会议")}
              onClick={() => setEndDialogOpen(true)}
              sx={{ minHeight: 44, borderRadius: 2.5, fontWeight: 750, fontSize: "0.78rem", textTransform: "none", display: { xs: "none", sm: "inline-flex" } }}
            >
              {t("meeting.endForAll", "结束会议")}
            </Button>
            <Tooltip title={t("meeting.endForAll", "结束会议")}>
              <IconButton
                color="error"
                aria-label={t("meeting.endForAll", "结束会议")}
                onClick={() => setEndDialogOpen(true)}
                sx={{ width: 44, height: 44, display: { xs: "inline-flex", sm: "none" } }}
              >
                <CallEndIcon />
              </IconButton>
            </Tooltip>
          </>
          )}
          <Button
          variant="contained"
          color="error"
          startIcon={<LogoutIcon />}
          aria-label={t("meeting.leave", "离开")}
          onClick={() => { void meetingManager.leaveMeeting(); onExit(); }}
          sx={{ minHeight: 44, minWidth: 44, px: { xs: 1.25, sm: 2 }, borderRadius: 2.5, fontWeight: 800, fontSize: "0.78rem", textTransform: "none", boxShadow: "none", whiteSpace: "nowrap", "& .MuiButton-startIcon": { mr: { xs: 0, sm: 1 } } }}
        >
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("meeting.leave", "离开")}</Box>
          </Button>
        </Stack>
      </Box>

      <MeetingInviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        meetingId={meetingId}
        title={title}
      />

      <MeetingMediaSettingsDialog
        open={mediaSettingsOpen}
        onClose={() => setMediaSettingsOpen(false)}
        onMediaSettingsChanged={applyMeetingMediaSettings}
        onSettingsChanged={() => setMediaSettingsVersion((value) => value + 1)}
      />

      <MeetingMinutesConsentDialog
        open={!amHost && memberMinutesPreferences.enabled && state.minutes.running && state.minutes.requireConsent && !state.minutes.consented && minutesConsentDecision === "pending"}
        running={state.minutes.running}
        autoStart={!amHost && memberMinutesPreferences.enabled && state.minutes.running && !state.minutes.requireConsent && !state.minutes.consented && minutesConsentDecision === "pending"}
        language={memberMinutesPreferences.language}
        asrSource={memberMinutesPreferences.asrSource}
        asrModel={memberMinutesPreferences.asrModel}
        apiKey={getMeetingAiSecret("asr")}
        onResolved={(accepted) => setMinutesConsentDecision(accepted ? "accepted" : "rejected")}
      />

      <Dialog open={focusRequest !== null} onClose={() => setFocusRequest(null)} maxWidth="xs" fullWidth data-testid="meeting-focus-request-dialog">
        <DialogTitle sx={{ fontWeight: 800 }}>{focusRequest?.target === "screen" ? "视频聚焦请求" : t("meeting.focusRequestTitle", "白板聚焦请求")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: "text.secondary", fontSize: "0.88rem" }}>
            {focusRequest ? `${displayNameOf(focusRequest.from, t("meeting.member", "成员"))} 请求大家聚焦到${focusRequest.target === "screen" ? "视频" : "白板"}。` : ""}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => {
            if (focusRequest) meetingManager.respondPresentationFocus(focusRequest.requestId, focusRequest.from, focusRequest.target, false);
            setFocusRequest(null);
          }} sx={{ textTransform: "none" }}>{t("meeting.reject", "拒绝")}</Button>
          <Button variant="contained" data-testid="meeting-focus-request-accept" onClick={() => {
            if (focusRequest) meetingManager.respondPresentationFocus(focusRequest.requestId, focusRequest.from, focusRequest.target, true);
            setFocusRequest(null);
          }} sx={{ textTransform: "none", borderRadius: 2 }}>{focusRequest?.target === "screen" ? "聚焦视频" : t("meeting.focusAccept", "聚焦白板")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{t("meeting.endDialogTitle", "结束会议？")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.9rem", color: "text.secondary" }}>
            {t("meeting.endDialogBody", "全体成员将被移出会议，会议号立即释放。")}
          </Typography>
          <Typography sx={{ mt: 1.25, color: "#53708f", fontSize: "0.78rem", lineHeight: 1.55 }}>
            结束前会合并最后一批转写，生成会议纪要并保存到本机历史。
          </Typography>
          {endMinutesError && <Typography sx={{ mt: 1, color: "error.main", fontSize: "0.76rem" }}>{endMinutesError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEndDialogOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button variant="contained" color="error" disabled={endingMinutes} sx={{ textTransform: "none", borderRadius: 2 }} onClick={() => void handleEndMeeting()}>
            {endingMinutes ? "正在生成纪要…" : t("meeting.endForAll", "结束会议")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={amHost && applicantsOpen && state.applicants.size > 0}
        onClose={() => setApplicantsOpen(false)}
        maxWidth="sm"
        fullWidth
        data-testid="meeting-applicants-dialog"
        PaperProps={{
          sx: {
            width: "min(560px, calc(100vw - 24px))",
            borderRadius: { xs: 3, sm: 4 },
            overflow: "hidden",
            border: "1px solid rgba(35, 76, 132, 0.12)",
            boxShadow: "0 24px 80px rgba(18, 50, 100, 0.22), 0 6px 20px rgba(20, 38, 67, 0.08)",
          },
        }}
      >
        <DialogTitle component="div" sx={{ p: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: { xs: 2, sm: 2.75 }, py: { xs: 2, sm: 2.5 } }}>
            <Box sx={{ width: 46, height: 46, borderRadius: 2.5, display: "grid", placeItems: "center", flexShrink: 0, bgcolor: "#e8f1ff", color: BLUE }}>
              <GroupsIcon />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: { xs: "1.18rem", sm: "1.32rem" }, fontWeight: 800, lineHeight: 1.25 }}>
                {t("meeting.applyRequestsTitle", "加入申请")}
              </Typography>
              <Typography sx={{ mt: 0.35, color: "text.secondary", fontSize: "0.82rem" }}>
                {t("meeting.applyRequestsSubtitle", "确认后申请人将直接进入会议")}
              </Typography>
            </Box>
            <Chip label={`${state.applicants.size} ${t("meeting.applyRequestsCount", "人")}`} size="small" color="primary" sx={{ fontWeight: 800, bgcolor: "#e8f1ff", color: BLUE }} />
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: { xs: 1.75, sm: 2.5 }, bgcolor: "#f6f8fc" }}>
          <Paper elevation={0} sx={{ display: "flex", alignItems: "flex-start", gap: 1, p: 1.35, borderRadius: 2.5, bgcolor: "#edf5ff", color: "#174c91", border: "1px solid rgba(22, 119, 255, 0.12)" }}>
            <CheckIcon sx={{ mt: 0.1, fontSize: 19, flexShrink: 0 }} />
            <Typography sx={{ fontSize: "0.8rem", lineHeight: 1.55 }}>
              {t("meeting.applyRequestsDirectJoinHint", "接受后将直接加入当前会议，申请人无需再次接听邀请。")}
            </Typography>
          </Paper>
          <Stack spacing={1.15} sx={{ mt: 1.5 }}>
            {state.applicants.size === 0 ? (
              <Paper elevation={0} data-testid="meeting-applicants-empty" sx={{ p: 3, textAlign: "center", borderRadius: 2.5, bgcolor: "background.paper", color: "text.secondary" }}>
                <Typography sx={{ fontSize: "0.86rem" }}>{t("meeting.applyRequestsEmpty", "暂无申请")}</Typography>
              </Paper>
            ) : Array.from(state.applicants.values()).map((a) => {
              const processing = a.status !== "pending";
              return (
                <Paper key={a.requestId} elevation={0} data-testid={`meeting-applicant-card-${a.requestId}`} sx={{ p: { xs: 1.35, sm: 1.5 }, borderRadius: 2.75, bgcolor: "background.paper", border: "1px solid rgba(35, 76, 132, 0.11)", boxShadow: "0 5px 16px rgba(27, 59, 107, 0.06)" }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1.2, sm: 1.5 }} alignItems={{ xs: "stretch", sm: "center" }}>
                    <Stack direction="row" spacing={1.15} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ width: 40, height: 40, minWidth: 40, borderRadius: 2.25, display: "grid", placeItems: "center", bgcolor: "#eaf2ff", color: BLUE }}>
                        <PersonAddAlt1Icon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: "0.92rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.name || a.uniqId}
                        </Typography>
                        <Typography sx={{ mt: 0.2, color: "text.secondary", fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.uniqId}
                        </Typography>
                      </Box>
                    </Stack>
                    <Chip size="small" label={processing ? t("meeting.applyProcessing", "处理中") : t("meeting.applyPending", "等待确认")} color={processing ? "default" : "primary"} variant={processing ? "outlined" : "filled"} sx={{ alignSelf: { xs: "flex-start", sm: "center" }, fontSize: "0.72rem", fontWeight: 700 }} />
                    <Stack direction="row" spacing={0.8} sx={{ flexShrink: 0 }}>
                      <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon fontSize="small" />} data-testid={`meeting-applicant-reject-${a.uniqId}`}
                        disabled={processing} onClick={() => meetingManager.rejectApplicant(a.requestId)} sx={{ minHeight: 38, flex: 1, px: 1.2, borderRadius: 2, textTransform: "none", fontWeight: 700, whiteSpace: "nowrap" }}>{a.status === "rejecting" ? t("meeting.applyProcessing", "处理中") : t("meeting.applyReject", "拒绝")}</Button>
                      <Button size="small" variant="contained" color="primary" startIcon={<CheckIcon fontSize="small" />} data-testid={`meeting-applicant-accept-${a.uniqId}`}
                        disabled={processing} onClick={() => meetingManager.acceptApplicant(a.requestId)} sx={{ minHeight: 38, flex: 1, px: 1.2, borderRadius: 2, textTransform: "none", fontWeight: 700, whiteSpace: "nowrap", boxShadow: "none" }}>{a.status === "accepting" ? t("meeting.applyProcessing", "处理中") : t("meeting.applyAccept", "接受")}</Button>
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 2.75 }, py: 1.5, borderTop: "1px solid rgba(35, 76, 132, 0.1)" }}>
          <Button onClick={() => setApplicantsOpen(false)} sx={{ ml: "auto", minHeight: 40, px: 2, borderRadius: 2, textTransform: "none", fontWeight: 700 }}>{t("meeting.applyRequestsClose", "暂不处理")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={breakoutOpen} onClose={() => setBreakoutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{t("meeting.breakout", "分组讨论")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.82rem", color: "text.secondary", mb: 1.5 }}>
            {t("meeting.breakoutDesc", "将参会成员自动均分到独立讨论室，你留守主会场，可随时召集回归。")}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            {[2, 3, 4].map((count) => (
              <Chip key={count} label={`${count} ${t("meeting.breakoutRooms", "组")}`} onClick={() => setBreakoutRooms(count)} color={breakoutRooms === count ? "primary" : "default"} variant={breakoutRooms === count ? "filled" : "outlined"} sx={{ fontWeight: 700 }} />
            ))}
          </Stack>
          <List dense disablePadding>
            {breakoutPreview.map((members, index) => (
              <ListItem key={index} sx={{ px: 0, py: 0.25 }}>
                <ListItemText primary={`${t("meeting.breakoutGroup", "分组")} ${index + 1} · ${meetingId}B${index + 1}`} secondary={members.length ? members.map((member) => displayNameOf(member)).join("、") : t("meeting.breakoutEmpty", "（空）")} primaryTypographyProps={{ fontSize: "0.82rem", fontWeight: 700 }} secondaryTypographyProps={{ fontSize: "0.76rem" }} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setBreakoutOpen(false)} sx={{ textTransform: "none" }}>{t("meeting.cancel", "取消")}</Button>
          <Button variant="contained" sx={{ textTransform: "none", borderRadius: 2 }} disabled={state.members.length === 0 || state.stage !== "in-meeting"} onClick={startBreakout}>
            {t("meeting.breakoutStart", "开始分组")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function BrandMark() {
  return (
    <Box aria-hidden sx={{ position: "relative", width: 25, height: 25, transform: "rotate(45deg)", flexShrink: 0 }}>
      <Box sx={{ position: "absolute", width: 11, height: 11, top: 0, left: 0, borderRadius: 1.2, bgcolor: BLUE }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, top: 0, right: 0, borderRadius: 1.2, bgcolor: "#44a5ff" }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, bottom: 0, left: 0, borderRadius: 1.2, bgcolor: "#3e8fff" }} />
      <Box sx={{ position: "absolute", width: 11, height: 11, bottom: 0, right: 0, borderRadius: 1.2, bgcolor: "#1354d8" }} />
    </Box>
  );
}

function ScreenStage({ tile, isFocused, onFocus }: { tile: MemberTileData; isFocused: boolean; onFocus: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const video = ref.current;
    const stream = tile.videoStream;
    if (!video || !stream) return;
    return bindMeetingVideo(video, stream);
  }, [tile.videoStream]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  const toggleScreenFullscreen = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const target = containerRef.current;
    if (target?.requestFullscreen) void target.requestFullscreen().catch(() => undefined);
  };
  return (
    <Box
      ref={containerRef}
      role="button"
      tabIndex={0}
      aria-label={tile.name}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus();
        }
      }}
      sx={{ width: "100%", height: "100%", cursor: "pointer", outline: isFocused ? `2px solid ${BLUE}` : "none", outlineOffset: -2, "&:focus-visible": { outline: `2px solid ${BLUE}`, outlineOffset: -2 } }}
    >
      <Tooltip title={isFullscreen ? "退出全屏" : "全屏查看"}>
        <IconButton
          data-testid="meeting-screen-fullscreen"
          aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
          onClick={toggleScreenFullscreen}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 3, width: 40, height: 40, color: "#fff", bgcolor: "rgba(11,23,41,.56)", "&:hover": { bgcolor: "rgba(11,23,41,.76)" } }}
        >
          {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <video ref={ref} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f4f7fb", display: "block" }} />
    </Box>
  );
}

function _ActiveSharingBar({
  mode,
  screenAvailable,
  whiteboardAvailable,
  focusTarget,
  followWhiteboard,
  canManageFocus,
  canRequestFocus,
  canClose,
  onClose,
  onToggleFollow,
  onForceFocus,
  onRequestFocus,
  onSelectMode,
}: {
  mode: "screen" | "whiteboard" | "camera" | "";
  screenAvailable: boolean;
  whiteboardAvailable: boolean;
  focusTarget: PresentationFocusTarget;
  followWhiteboard: boolean;
  canManageFocus: boolean;
  canRequestFocus: boolean;
  canClose: boolean;
  onClose: () => void;
  onToggleFollow: () => void;
  onForceFocus: (target?: Exclude<PresentationFocusTarget, "">) => void;
  onRequestFocus: (target: Exclude<PresentationFocusTarget, "">) => void;
  onSelectMode: (mode: "screen" | "whiteboard") => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 10 });
  const [centered, setCentered] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const selectedFocusTarget: Exclude<PresentationFocusTarget, ""> = mode === "whiteboard" && whiteboardAvailable ? "whiteboard" : screenAvailable ? "screen" : "whiteboard";
  const selectedFocusLabel = selectedFocusTarget === "screen" ? "屏幕" : "白板";
  const label = mode === "whiteboard" ? "白板" : mode === "camera" ? "视频" : "屏幕";
  const labelTitle = mode === "whiteboard" ? "共享人正在展示白板" : mode === "camera" ? "共享人正在展示视频" : "共享人正在共享屏幕";

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!bar || !parent) return;
    const rect = bar.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!drag || !bar || !parent || drag.pointerId !== event.pointerId) return;
    const parentRect = parent.getBoundingClientRect();
    const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
    const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
    setCentered(false);
    setPosition({
      left: Math.min(maxLeft, Math.max(12, event.clientX - parentRect.left - drag.offsetX)),
      top: Math.min(maxTop, Math.max(10, event.clientY - parentRect.top - drag.offsetY)),
    });
    event.stopPropagation();
  };
  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    event.stopPropagation();
  };

  useEffect(() => {
    if (centered) return;
    const clampPosition = () => {
      const bar = barRef.current;
      const parent = bar?.parentElement;
      if (!bar || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
      const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
      setPosition((current) => ({
        left: Math.min(maxLeft, Math.max(12, current.left)),
        top: Math.min(maxTop, Math.max(10, current.top)),
      }));
    };
    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [centered]);

  return (
    <Paper
      ref={barRef}
      data-testid="meeting-active-sharing-bar"
      data-collapsed={collapsed ? "true" : "false"}
      elevation={0}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: "absolute",
        left: centered ? { xs: 8, sm: "50%" } : position.left,
        top: centered ? { xs: 70, sm: 10 } : position.top,
        transform: centered ? { xs: "none", sm: "translateX(-50%)" } : "none",
        zIndex: 20,
        width: { xs: "calc(100% - 16px)", sm: "auto" },
        maxWidth: "calc(100% - 16px)",
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "center", sm: "flex-start" },
        flexWrap: { xs: "wrap", sm: "nowrap" },
        gap: { xs: 0.25, sm: 0.5 },
        px: { xs: 0.45, sm: 0.7 },
        py: 0.45,
        borderRadius: 2.5,
        bgcolor: "rgba(255,255,255,.94)",
        border: `1px solid ${alpha(BLUE, 0.18)}`,
        boxShadow: "0 8px 24px rgba(14,29,53,.16)",
        backdropFilter: "blur(16px)",
        overflow: "visible",
        pointerEvents: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      <Box
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="拖动共享控制栏"
        sx={{ display: "grid", placeItems: "center", width: { xs: 24, sm: 28 }, height: 32, flexShrink: 0, cursor: "grab", color: "#718096", touchAction: "none" }}
      >
        <DragIndicatorIcon sx={{ fontSize: 19 }} />
      </Box>
      <Tooltip title={labelTitle} arrow>
        <Stack direction="row" alignItems="center" spacing={0.35} sx={{ flexShrink: 0 }}>
          {mode === "whiteboard" ? <EditIcon sx={{ fontSize: 16, color: BLUE }} /> : <ScreenShareIcon sx={{ fontSize: 16, color: BLUE }} />}
          <Typography sx={{ fontSize: { xs: "0.74rem", sm: "0.72rem" }, fontWeight: 800, color: "#13233d", whiteSpace: "nowrap" }}>{label}</Typography>
        </Stack>
      </Tooltip>
      <Tooltip title={collapsed ? "展开共享控制" : "收起共享控制"}>
        <IconButton
          data-testid={collapsed ? "meeting-active-sharing-expand" : "meeting-active-sharing-collapse"}
          data-expand-direction={collapsed ? "right" : "left"}
          aria-label={collapsed ? "展开共享控制" : "收起共享控制"}
          size="small"
          onClick={() => setCollapsed((value) => !value)}
          sx={{ width: 32, height: 32, flexShrink: 0, color: BLUE }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {!collapsed && (
        <>
      {screenAvailable && whiteboardAvailable && (
        <Tooltip title={`切换到${mode === "whiteboard" ? "屏幕" : "白板"}`} arrow>
          <Button
            size="small"
            onClick={() => {
              onSelectMode(mode === "whiteboard" ? "screen" : "whiteboard");
            }}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {mode === "whiteboard" ? "屏幕" : "白板"}
          </Button>
        </Tooltip>
      )}
      {whiteboardAvailable && (
        <Tooltip title={followWhiteboard ? "取消跟随共享人" : "跟随共享人"} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-follow-toggle"
            onClick={onToggleFollow}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {followWhiteboard ? "取消跟随" : "跟随"}
          </Button>
        </Tooltip>
      )}
      {canManageFocus && (
        <Tooltip title={focusTarget === selectedFocusTarget ? "取消邀请大家跟随" : `邀请大家跟随${selectedFocusLabel}`} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-manage-focus"
            onClick={() => onForceFocus(focusTarget === selectedFocusTarget ? undefined : selectedFocusTarget)}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {focusTarget === selectedFocusTarget ? "取消邀请" : "邀请跟随"}
          </Button>
        </Tooltip>
      )}
      {canRequestFocus && (
        <Tooltip title={`请求大家跟随${selectedFocusLabel}`} arrow>
          <Button
            size="small"
            data-testid="meeting-sharing-request-focus"
            onClick={() => onRequestFocus(selectedFocusTarget)}
            sx={{ minWidth: 0, px: { xs: 0.65, sm: 0.9 }, minHeight: 30, borderRadius: 1.5, fontSize: { xs: "0.72rem", sm: "0.7rem" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            请求跟随
          </Button>
        </Tooltip>
      )}
      {canClose && (
        <Tooltip title={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"}>
          <IconButton size="small" onClick={onClose} aria-label={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"} sx={{ width: 30, height: 30, flexShrink: 0 }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
        </>
      )}
    </Paper>
  );
}

// Kept for compatibility with older meeting snapshots/tests while the new
// presenter bar owns the live UI.
void _ActiveSharingBar;

function ActiveSharingBarV2({
  mode,
  screenAvailable,
  whiteboardAvailable,
  cameraAvailable,
  presenterId,
  presenterTarget,
  followPresenter,
  isPresenter,
  canClose,
  onClose,
  onToggleFollow,
  onClaimPresenter,
  onRequestEveryoneFollow,
  onReleasePresenter,
  onSelectMode,
}: {
  mode: "screen" | "whiteboard" | "camera" | "";
  screenAvailable: boolean;
  whiteboardAvailable: boolean;
  cameraAvailable: boolean;
  presenterId: string;
  presenterTarget: "" | "screen" | "whiteboard" | "camera";
  followPresenter: boolean;
  isPresenter: boolean;
  canClose: boolean;
  onClose: () => void;
  onToggleFollow: () => void;
  onClaimPresenter: () => void;
  onRequestEveryoneFollow: () => void;
  onReleasePresenter: () => void;
  onSelectMode: (mode: "screen" | "whiteboard" | "camera") => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 10 });
  const [centered, setCentered] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const label = mode === "whiteboard" ? "白板" : mode === "camera" ? "视频" : "屏幕";
  const selectedTarget = presenterTarget || mode;

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!bar || !parent) return;
    const rect = bar.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bar = barRef.current;
    const parent = bar?.parentElement;
    if (!drag || !bar || !parent || drag.pointerId !== event.pointerId) return;
    const parentRect = parent.getBoundingClientRect();
    const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
    const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
    setCentered(false);
    setPosition({
      left: Math.min(maxLeft, Math.max(12, event.clientX - parentRect.left - drag.offsetX)),
      top: Math.min(maxTop, Math.max(10, event.clientY - parentRect.top - drag.offsetY)),
    });
    event.stopPropagation();
  };
  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    event.stopPropagation();
  };

  useEffect(() => {
    if (centered) return;
    const clampPosition = () => {
      const bar = barRef.current;
      const parent = bar?.parentElement;
      if (!bar || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const maxLeft = Math.max(12, parentRect.width - bar.offsetWidth - 12);
      const maxTop = Math.max(10, parentRect.height - bar.offsetHeight - 10);
      setPosition((current) => ({
        left: Math.min(maxLeft, Math.max(12, current.left)),
        top: Math.min(maxTop, Math.max(10, current.top)),
      }));
    };
    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [centered]);

  return (
    <Paper
      ref={barRef}
      data-testid="meeting-active-sharing-bar"
      data-collapsed={collapsed ? "true" : "false"}
      elevation={0}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: "absolute",
        left: centered ? { xs: 8, sm: "50%" } : position.left,
        top: centered ? { xs: 70, sm: 10 } : position.top,
        transform: centered ? { xs: "none", sm: "translateX(-50%)" } : "none",
        zIndex: 20,
        width: { xs: "calc(100% - 16px)", sm: "auto" },
        maxWidth: "calc(100% - 16px)",
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "center", sm: "flex-start" },
        flexWrap: { xs: "wrap", sm: "nowrap" },
        gap: { xs: 0.25, sm: 0.5 },
        px: { xs: 0.45, sm: 0.7 },
        py: 0.45,
        borderRadius: 2.5,
        bgcolor: "rgba(255,255,255,.95)",
        border: `1px solid ${alpha(BLUE, 0.18)}`,
        boxShadow: "0 8px 24px rgba(14,29,53,.16)",
        backdropFilter: "blur(16px)",
        overflow: "visible",
        pointerEvents: "auto",
      }}
    >
      <Box
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="拖动共享控制栏"
        sx={{ display: "grid", placeItems: "center", width: { xs: 24, sm: 28 }, height: 32, flexShrink: 0, cursor: "grab", color: "#718096", touchAction: "none" }}
      >
        <DragIndicatorIcon sx={{ fontSize: 19 }} />
      </Box>
      <Stack direction="row" alignItems="center" spacing={0.4} sx={{ px: 0.45, minHeight: 32 }}>
        {mode === "whiteboard" ? <EditIcon sx={{ fontSize: 16, color: BLUE }} /> : mode === "camera" ? <VideocamIcon sx={{ fontSize: 16, color: BLUE }} /> : <ScreenShareIcon sx={{ fontSize: 16, color: BLUE }} />}
        <Typography sx={{ fontSize: { xs: "0.74rem", sm: "0.72rem" }, fontWeight: 800, color: "#13233d", whiteSpace: "nowrap" }}>{label}</Typography>
      </Stack>
      <Tooltip title={collapsed ? "展开共享控制" : "收起共享控制"}>
        <IconButton
          data-testid={collapsed ? "meeting-active-sharing-expand" : "meeting-active-sharing-collapse"}
          data-expand-direction={collapsed ? "right" : "left"}
          aria-label={collapsed ? "展开共享控制" : "收起共享控制"}
          size="small"
          onClick={() => setCollapsed((value) => !value)}
          sx={{ width: 32, height: 32, flexShrink: 0, color: BLUE }}
        >
          {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      {!collapsed && (
        <>
      <ToggleButtonGroup
        exclusive
        value={selectedTarget}
        size="small"
        aria-label="共享呈现目标"
        onChange={(_, next: "screen" | "whiteboard" | "camera" | null) => {
          if (next) onSelectMode(next);
        }}
        sx={{
          minHeight: 32,
          borderRadius: 1.5,
          overflow: "hidden",
          bgcolor: "#f4f7fb",
          "& .MuiToggleButton-root": {
            minWidth: { xs: 34, sm: 48 },
            minHeight: 30,
            px: { xs: 0.55, sm: 0.85 },
            py: 0.25,
            border: 0,
            borderRadius: 0,
            color: "#687386",
            fontSize: { xs: "0.68rem", sm: "0.7rem" },
            fontWeight: 750,
            textTransform: "none",
            whiteSpace: "nowrap",
          },
          "& .MuiToggleButton-root.Mui-selected": {
            color: BLUE,
            bgcolor: "#e7f0ff",
          },
          "& .MuiToggleButton-root.Mui-disabled": { opacity: 0.35 },
        }}
      >
        <ToggleButton value="camera" disabled={!isPresenter || !cameraAvailable} aria-label="呈现视频">
          <VideocamIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>视频</Box>
        </ToggleButton>
        <ToggleButton value="whiteboard" disabled={!isPresenter || !whiteboardAvailable} aria-label="呈现白板">
          <EditIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>白板</Box>
        </ToggleButton>
        <ToggleButton value="screen" disabled={!isPresenter || !screenAvailable} aria-label="呈现屏幕">
          <ScreenShareIcon sx={{ display: { xs: "inline-flex", sm: "none" }, fontSize: 15, mr: { xs: 0, sm: 0.35 } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>屏幕</Box>
        </ToggleButton>
      </ToggleButtonGroup>
      {!isPresenter && presenterId && (
        <Button size="small" data-testid="meeting-sharing-follow-toggle" onClick={onToggleFollow} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
          {followPresenter ? "取消跟随" : "跟随共享人"}
        </Button>
      )}
      {isPresenter ? (
        <>
          <Button size="small" data-testid="meeting-sharing-request-follow-all" onClick={onRequestEveryoneFollow} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
            邀请跟随
          </Button>
          <Button size="small" color="error" data-testid="meeting-sharing-end" onClick={onReleasePresenter} sx={{ minWidth: 0, px: 0.9, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none", fontWeight: 800 }}>
            结束共享
          </Button>
        </>
      ) : (
        <Button size="small" data-testid="meeting-sharing-claim-presenter" onClick={onClaimPresenter} sx={{ minWidth: 0, px: 0.8, minHeight: 30, borderRadius: 1.5, fontSize: "0.72rem", textTransform: "none" }}>
          成为共享人
        </Button>
      )}
      {canClose && !isPresenter && (
        <Tooltip title={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"}>
          <IconButton size="small" onClick={onClose} aria-label={mode === "whiteboard" ? "仅自己关闭白板" : "停止共享"} sx={{ width: 30, height: 30 }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
        </>
      )}
    </Paper>
  );
}

function ActiveSharingSurface({
  mode,
  boardMode,
  followPresentation,
  tile,
  compact = false,
  onActivate,
}: {
  mode: "screen" | "whiteboard" | "";
  boardMode: "basic" | "excalidraw";
  followPresentation: boolean;
  tile: MemberTileData | null;
  compact?: boolean;
  onActivate: () => void;
}) {
  const label = mode === "whiteboard" ? "共享白板" : "正在共享屏幕";
  return (
    <Box
      data-testid="meeting-active-sharing"
      data-mode={mode}
      role="region"
      aria-label={label}
      onClick={compact || (mode === "screen" && tile) ? onActivate : undefined}
      sx={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", borderRadius: 2, bgcolor: "#f4f7fb", border: `1px solid ${alpha(BLUE, 0.16)}`, cursor: mode === "screen" && tile ? "pointer" : "default" }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ display: "none", position: "absolute", top: 10, left: 12, zIndex: 9, px: 1, py: 0.5, borderRadius: 1.5, bgcolor: "rgba(255,255,255,.9)", color: "#13233d", boxShadow: "0 4px 14px rgba(14,29,53,.12)" }}>
        <ScreenShareIcon sx={{ fontSize: 15, color: BLUE }} />
        <Typography sx={{ fontSize: "0.72rem", fontWeight: 800 }}>{label}</Typography>
      </Stack>
      {mode === "whiteboard" ? (
        compact ? (
          <Stack sx={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
            <EditIcon sx={{ color: BLUE, mb: 0.5 }} />
            <Typography sx={{ fontSize: "0.78rem", fontWeight: 700 }}>白板正在共享，点击放大</Typography>
          </Stack>
        ) : boardMode === "excalidraw" ? (
          <ExcalidrawBoard followPresentation={followPresentation} />
        ) : (
          <Whiteboard />
        )
      ) : tile ? (
        <ScreenStage tile={tile} isFocused={false} onFocus={onActivate} />
      ) : (
        <Stack sx={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>
          <Typography sx={{ fontSize: "0.82rem" }}>正在连接共享画面…</Typography>
        </Stack>
      )}
    </Box>
  );
}
