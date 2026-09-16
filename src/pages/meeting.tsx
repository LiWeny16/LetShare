import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from "@mui/material"
import { meetingManager } from "@App/libs/meeting/meetingManager"
import type { MeetingError } from "@App/libs/meeting/meetingManager"
import realTimeColab from "@App/libs/connection/colabLib"
import { normalizeUserName } from "@App/libs/identity/identity"
import settingsStore from "@App/libs/mobx/mobx"
import MeetingRoom from "../components/meeting/MeetingRoom"
import AlertPortal from "../components/Alert"

/**
 * 会议房间路由页（懒加载 chunk）。
 * 从 query 读 `room`、`source` 与 `screen`：
 *  - room=<id>      加入指定会议房间
 *  - source=<roomId> 原始 LetShare 房间号（邀请/在线名单上下文；与会议号分开，不含 token）
 *  - screen=1       进入后立即发起屏幕共享（作为一条共享 track 走同一 SFU 上行）
 * 由 share 页的"创建会议 / 加入会议"通过 navigate 跳转到此，
 * 避免把整棵会议组件树打进 share 首屏 chunk。
 *
 * 会议页是独立路由，可能被直接以 URL 打开（分享链接/扫码），此时 WS 尚未连接
 * （连接流程只挂在 share 页）。挂载时若未连接先 connectToServer，再发 join，
 * 否则 sendMeetingMessage 会被 isConnected 检查静默丢弃。
 */
export default function MeetingPage() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const room = sp.get("room") ?? ""
  const source = sp.get("source") ?? ""
  const autoScreen = sp.get("screen") === "1"
  const [userName, setUserName] = useState(realTimeColab.getUserName() ?? "")
  const [nameConfirmed, setNameConfirmed] = useState(!room || realTimeColab.hasExplicitUserName())
  const [managerState, setManagerState] = useState(meetingManager.getState())
  const [connectionError, setConnectionError] = useState(false)
  const joinedRoomRef = useRef<string | null>(null)

  useEffect(() => meetingManager.subscribe(setManagerState), [])

  // E2E/调试钩子（仅 dev 构建）：暴露 manager 单例供 CDP 断言内部状态
  if (import.meta.env.DEV) {
    (window as any).__meeting = meetingManager
  }

  // 会议路由会卸载 share 页；保留同一套仅开发环境的传输观测面，
  // 让会议内定向文件 E2E 能验证真实 receivedFiles，而不是读取已卸载的 share hook。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const e2eApi = {
      getState: () => ({
        receivedFiles: Array.from(realTimeColab.receivedFiles.values()).map((file) => ({ name: file.name, size: file.size })),
        sentFiles: Array.from(realTimeColab.sentFiles.values()),
        receivingFiles: Array.from(realTimeColab.receivingFiles.entries()).map(([peerId, info]) => ({
          peerId,
          name: info.name,
          size: info.size,
          receivedSize: info.receivedSize,
        })),
        activeOutgoingFileTransfer: realTimeColab.activeOutgoingFileTransfer,
        fileTransferStatus: realTimeColab.fileTransferStatus,
      }),
      // Dev-only fault injection used by the meeting transfer fallback E2E.
      // The production bundle never exposes this API because this effect is DEV-gated.
      closeP2P: (peerId: string): boolean => {
        const channel = realTimeColab.dataChannels.get(peerId);
        if (!channel) return false;
        channel.close();
        return true;
      },
    }
    ;(window as any).__LET_SHARE_E2E__ = e2eApi
    return () => {
      if ((window as any).__LET_SHARE_E2E__ === e2eApi) delete (window as any).__LET_SHARE_E2E__
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let screenTimer: number | undefined
    void (async () => {
      if (!realTimeColab.isConnected()) {
        // 保持原始房间订阅：source 提供时不进入 transport-only，让服务器能
        // 把本端记在 sourceRoom 成员表里（meeting:invite / 在线名单依赖它）。
        const targetRoom = source || settingsStore.get("roomId") || ""
        if (source && settingsStore.get("roomId") !== source) {
          settingsStore.update("roomId", source)
        }
        const transportOnly = !targetRoom
        const connected = await realTimeColab.connectToServer({ silent: true, transportOnly }).catch(() => false)
        if (!connected && room) {
          setConnectionError(true)
          return
        }
      }
      // The same tab can navigate directly from one meeting URL to another.
      // Leave the old meeting before attempting the new join, otherwise the
      // manager's inMeeting guard would silently keep the old room alive.
      if (room && joinedRoomRef.current && joinedRoomRef.current !== room) {
        meetingManager.leaveMeeting()
        joinedRoomRef.current = null
      }
      if (cancelled || !nameConfirmed) return
      // 恢复原始房间上下文：优先 URL source（邀请链接/接受邀请跳转），缺省回退当前文件房间。
      // 稳定用户身份（userId/uniqId）由 localStorage 恢复，不进 URL。
      meetingManager.setSourceRoomId(source || settingsStore.get("roomId") || "")
      if (room) {
        setConnectionError(false)
        joinedRoomRef.current = room
        meetingManager.joinMeeting(room)
      }
      // 屏幕共享需拿到发布 PC 后再发；joinMeeting 内部异步建 PC，延迟一拍让 PC 就绪
      if (autoScreen) screenTimer = window.setTimeout(() => void meetingManager.startScreenShare(), 400)
    })()
    return () => {
      cancelled = true
      if (screenTimer !== undefined) clearTimeout(screenTimer)
    }
  }, [nameConfirmed, room, source, autoScreen])

  const routeError = room && managerState.meetingError?.roomId === room
    ? managerState.meetingError
    : connectionError
      ? { kind: "unavailable", message: "无法连接会议服务" } satisfies MeetingError
      : undefined

  const confirmName = () => {
    const next = normalizeUserName(userName, "");
    if (!next) return;
    realTimeColab.setUserName(next);
    setUserName(next);
    setNameConfirmed(true);
  }

  if (routeError) {
    return <MeetingRouteError error={routeError} onBack={() => nav("/")} onRetry={() => window.location.reload()} />
  }

  return (
    <>
      <AlertPortal />
      <Dialog
        open={Boolean(room) && !nameConfirmed}
        disableEscapeKeyDown
        data-testid="meeting-name-gate"
        PaperProps={{ sx: { borderRadius: 3, minWidth: { xs: "min(92vw, 360px)", sm: 400 } } }}
      >
        <DialogTitle>加入会议</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            请设置你在本次会议中显示的名字。你的 uniqID 不会因改名而变化。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="会议内名称"
            value={userName}
            inputProps={{ maxLength: 32, "data-testid": "meeting-name-input" }}
            onChange={(event) => setUserName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") confirmName(); }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="contained" onClick={confirmName} disabled={!normalizeUserName(userName, "")}>
            进入会议
          </Button>
        </DialogActions>
      </Dialog>
      <MeetingRoom
        onExit={() => {
          meetingManager.leaveMeeting()
          nav("/")
        }}
      />
    </>
  )
}

function MeetingRouteError({ error, onBack, onRetry }: { error: MeetingError; onBack: () => void; onRetry: () => void }) {
  const notFound = error.kind === "not-found"
  return (
    <Box
      data-testid={notFound ? "meeting-not-found" : "meeting-unavailable"}
      sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", px: 2, bgcolor: "#f4f7fb" }}
    >
      <Paper elevation={0} sx={{ width: "min(100%, 480px)", p: { xs: 3, sm: 4 }, borderRadius: 4, border: "1px solid", borderColor: "divider", textAlign: "center" }}>
        <Typography sx={{ fontSize: "3rem", lineHeight: 1, mb: 2 }}>{notFound ? "404" : "!"}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 850, mb: 1 }}>
          {notFound ? "会议不存在或已结束" : "暂时无法连接会议"}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {notFound ? "请检查会议号或邀请链接，然后重新加入。" : "会议服务暂时不可用，请稍后重试。"}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} justifyContent="center">
          <Button variant="outlined" onClick={onBack}>返回首页</Button>
          <Button variant="contained" onClick={onRetry}>重新尝试</Button>
        </Stack>
      </Paper>
    </Box>
  )
}
