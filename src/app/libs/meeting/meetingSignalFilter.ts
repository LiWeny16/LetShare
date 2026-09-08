/**
 * 会议信令频道过滤与错误分类（纯函数，Node 可测）。
 *
 * colabLib（连接层）与 meetingManager（会议层）共享，避免互相依赖：
 *   - colabLib 负责把 meeting:* / membership:* 帧连同外层 channel 转发给会议层；
 *   - meetingManager 用本模块判定「事件是否属于当前会议频道」与「错误是否局部可重试」。
 */

/**
 * 一条 membership/meeting 下行事件是否属于当前会议频道。
 *
 * 严格模式：channel 缺失/为空一律拒绝 —— 会议只接受能证明来自当前会议号房间的事件。
 * 这是 share→meeting 路由切换级联的根因防线：WS 重连后服务器会对「原始房间」
 * 下发 membership:snapshot，若不按频道过滤，原始房间成员会被当作会议成员去订阅，
 * 触发「房间内不存在发布者」错误帧，进而引发 joining→idle 级联。
 */
export function isMeetingChannelEvent(
  channel: string | null | undefined,
  meetingChannel: string,
): boolean {
  return (
    typeof channel === "string" &&
    channel !== "" &&
    typeof meetingChannel === "string" &&
    meetingChannel !== "" &&
    channel === meetingChannel
  );
}

/**
 * 订阅/ICE 级局部错误：只影响某个「订阅者-发布者」组合，客户端应做成员级重试，
 * 绝不能重置全局会议状态（stage joining→idle 会连带杀死 Host 的 publish PC，
 * 并使摄像头/麦克风/共享屏幕控制失效）。
 *
 * 服务器对 meeting:sdp / meeting:ice 处理失败的错误消息均以消息类型开头
 * （如 "meeting:sdp 订阅失败: sfu: 房间内不存在发布者 \"x\""），据此按词边界匹配。
 */
export function isTransientMeetingError(message: string | null | undefined): boolean {
  return (
    typeof message === "string" &&
    /^meeting:(sdp|ice)(\s|$)/.test(message)
  );
}

/**
 * 从订阅类错误文本中提取受影响的发布者（成员级重试目标）。
 * 服务器格式：
 *   `sfu: 房间内不存在发布者 "bob:1"`
 *   `meeting:ice 未找到订阅 bob:1 的连接`
 * 无目标（如 answer 设置失败）返回 null。
 */
export function extractFailedPublisher(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  let m = /不存在发布者 "([^"]+)"/.exec(message);
  if (m) return m[1];
  m = /未找到订阅 (\S+) 的连接/.exec(message);
  if (m) return m[1];
  return null;
}
