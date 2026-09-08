import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { meetingManager } from "@App/libs/meeting/meetingManager"
import realTimeColab from "@App/libs/connection/colabLib"
import settingsStore from "@App/libs/mobx/mobx"
import MeetingRoom from "../components/meeting/MeetingRoom"
import AlertPortal from "../components/Alert"

/**
 * 会议房间路由页（懒加载 chunk）。
 * 从 query 读 `room`、`source` 与 `screen`：
 *  - room=<id>      加入指定会议房间
 *  - source=<roomId> 原始 LetShare 房间号（邀请/在线名单上下文；与会议号分开，不含 token）
 *  - screen=1       进入后立即发起屏幕共享（作为一条共享 track 走同一 SFU 上行）
 * 由 share 页的"创建/加入会议 / 即时屏幕共享"通过 navigate 跳转到此，
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
        await realTimeColab.connectToServer({ silent: true }).catch(() => false)
      }
      if (cancelled) return
      // 恢复原始房间上下文：优先 URL source（邀请链接/接受邀请跳转），缺省回退当前文件房间。
      // 稳定用户身份（userId/uniqId）由 localStorage 恢复，不进 URL。
      meetingManager.setSourceRoomId(source || settingsStore.get("roomId") || "")
      if (room) meetingManager.joinMeeting(room)
      // 屏幕共享需拿到发布 PC 后再发；joinMeeting 内部异步建 PC，延迟一拍让 PC 就绪
      if (autoScreen) screenTimer = window.setTimeout(() => void meetingManager.startScreenShare(), 400)
    })()
    return () => {
      cancelled = true
      if (screenTimer !== undefined) clearTimeout(screenTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <AlertPortal />
      <MeetingRoom
        onExit={() => {
          meetingManager.leaveMeeting()
          nav("/")
        }}
      />
    </>
  )
}
