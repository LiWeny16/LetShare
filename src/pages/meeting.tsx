import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { meetingManager } from "@App/libs/meeting/meetingManager"
import realTimeColab from "@App/libs/connection/colabLib"
import MeetingRoom from "../components/meeting/MeetingRoom"

/**
 * 会议房间路由页（懒加载 chunk）。
 * 从 query 读 `room` 与 `screen`：
 *  - room=<id>  加入指定会议房间
 *  - screen=1   进入后立即发起屏幕共享（作为一条共享 track 走同一 SFU 上行）
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
  const autoScreen = sp.get("screen") === "1"
  const owner = sp.get("owner") === "1"

  useEffect(() => {
    let cancelled = false
    let screenTimer: number | undefined
    void (async () => {
      if (!realTimeColab.isConnected()) {
        await realTimeColab.connectToServer({ silent: true }).catch(() => false)
      }
      if (cancelled) return
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
    <MeetingRoom
      owner={owner}
      onExit={() => {
        meetingManager.leaveMeeting()
        nav("/")
      }}
    />
  )
}