# 文件传输恢复与双链路落地

## 后续部署授权（2026-10-21）

用户明确要求“部署吧 然后上线后测试”，中断后“继续”。本轮扩展为发布前后端3.8.47并做生产真实浏览器测试；此前“不部署”描述仅对应上一实施阶段。使用现有干净main发布worktree保留3.8.46已上线的通话/后端race修复，主工作区和原有docs改动保持。按标准deploy.cjs部署后端、前端及同步海外Pages，核对源站/CDN/Pages版本，并以生产无DEVhook页面完成实际文件交互和下载校验。发布记录见RELEASE.md。

## 用户授权与工作方式

- 活跃目标：仔细评估后设计并落地上一轮审核清单；实现由gpt-6-luna/max子代理负责，主控只制定方案、管理任务记录、review和验证。
- 上一轮已提交分期设计，用户明确“开始吧”授权按该方向实施。采用brainstorming梳理架构和subagent-orchestrator管理边界，不重复要求批准既有方向。
- direct模式；全局Harness指针仍是其他历史任务，不改其状态。本任务完整保留P0稳定性、同任务续传与跨路接续、持久化恢复和并行分块目标，不以完成第一批修复代替整体完成。
- 原始工作区有未提交的通话、会议、README、构建产物和server子模块指针改动，全部保留。不部署、不push、不改生产数据。
- 用户新增GUI约束：正常发送、双路调度和短断线恢复应自动完成，默认只展示文件/进度/速度/简单状态；线路、排队量、完整ID、保存期限等收进默认折叠详情。只有需要用户介入的源文件重选或真正存储/校验失败才突出操作提示。可自动恢复的单路径错误不弹全局错误或强制打开面板。
- 基线root HEAD 6b66bd38b950f46a6b4ec1c4771e5efe2574dca7；server工作目录HEAD d78c8b193947dcad3f7d61732a129db9b439a126且干净。版本字段不作线上证据。
- 当前失败会话没有浏览器性能录制；已做源码手工复核，后续验证按目标的完成审计要求覆盖实际路径。针对AC补充/执行定向回归、类型检查、隔离输出构建与浏览器验证；不启动无关全库测试。

## 方案与约束

详见DESIGN.md。采用独立的文件v2任务核心与协议适配器，复用现有WebRTC及WebSocket通道；旧端协商保留经过修复的旧路径。稳定任务/内容身份独立于peer/socket代次。接收端持久分块覆盖是恢复真值，服务器入口账本不是接收确认。

## 验收要求

| AC | 要求 | 完成证据 |
| --- | --- | --- |
| R1 | ACK滚动速度、排队与接收量分离、停顿归零；按任务隔离状态 | PASS：定向回归；最终basic28个进度样本无违规，结束排队/速度0 |
| R2 | 有界接收/在途字节、慢盘降速、减少整文件复制、UI保持响应 | PASS：阻塞store/微小帧/跨任务窗口回归；最大36MiB真实浏览器与390px布局 |
| R3 | 直写hash存在，完整覆盖/写入排空/校验/保存后唯一完成；失败不放行 | PASS：hash/重复/事务失败/竞态回归；真实持续历史保存失败不完成，8块保留并可恢复 |
| R4 | 断线不吞错、不误作取消；ICE旧代次和定时器隔离，在线presence保留 | PASS：presence/ICE代次/退避回归；32MiB实际P2P关闭后relay接续 |
| R5 | v2共同清单、内容hash、协议能力、分块与帧校验、身份与授权 | PASS：TS协议负例、Go授权/帧限制及race；真实下载内容hash一致 |
| R6 | 同页断线/换路只补缺块，同任务ID与进度连续 | PASS：缺块重排回归；32MiB原ID换路完成且下载SHA匹配 |
| R7 | 已提交分块及任务持久化；刷新恢复、重选源文件验证，配额/过期/删除可解释 | PASS：存储/配额/删除/暂停回归；36MiB双方刷新、错源拒绝、原源同ID恢复；取消刷新不复活 |
| R8 | 同一任务P2P与relay分配不同块、全局窗口、去重和路径自适应，无收益可单路 | PASS：调度/窗口/乱序回归；4MiB实际P2P2.5MiB+relay1.5MiB；3MiB纯relay、断P2P接续 |
| R9 | 服务端v2授权转发、有界暂存与持久会话恢复，重启后可重新寻址有效任务 | PASS：Go两包race及磁盘重建恢复；浏览器本地relay集成。未执行浏览器跨后端进程重启 |
| R10 | 用户界面可见准备/传输/暂停/重连/恢复源文件/校验/完成/失败及实际路径 | PASS：最终六场景真实DOM/截图/交互；技术详情折叠、恢复中性提示、390px无横向溢出 |
| R11 | 独立代码与验收review通过，保留原改动，无未接入的假功能 | PASS：fresh reflector核验R1–R11无必需阻断；86+67测试、tsc、隔离构建、Go race与最终6/6浏览器 |

## 执行波次与写入边界

写入者之间按文件分离；同一文件后续工作串行交接。主控不写产品代码。所有子代理不得改本任务的PLAN/PROGRESS/DESIGN/验收要求，不提交或部署。

| Wave | Task / Agent | Write set | Dependency | Status |
| --- | --- | --- | --- | --- |
| 1 | legacy_hardening / implementer | colabLib.ts、peerManager.ts、transferReliability.ts、chat/FileBlobStore.ts、chat/ChatIntegration.ts；对应定向测试 | R1–R4既有源码审核 | 已实现并释放，定向回归通过 |
| 1 | transfer_v2_core / implementer | connection/fileTransferV2的protocol.ts、store.ts、hash.worker.ts、hash.ts及新测试 | DESIGN协议与存储合同 | 已实现并释放，定向回归通过 |
| 1 | transfer_v2_backend / implementer | server/internal文件v2服务与handler、新测试；必要websocket.go/file_transfer.go/model/message.go接线 | DESIGN线路合同 | 已实现并释放，Go定向及race通过 |
| 2 | transfer_v2_core复用 / implementer | fileTransferV2/engine.ts及定向新测试；窄store修复逐项授权 | core接口review、ENGINE-CONTRACT | 已释放；owner/pause恢复review闭环 |
| 2 | v2接线与UI / implementer | adapter/colab由legacy；Download/share由backend，串行交接 | legacy完成、core/engine合同稳定 | 已实现并释放，主控tsc/隔离build通过 |
| 3 | 验证与独立review | 隔离验证夹具/报告；fresh reflector只读 | 前后端接入完成 | 已完成：86项定向+67项现有unit、tsc/隔离build/Go race、最终6/6真实浏览器、独立AC通过 |

## 持续记录

每轮记录真正完成的代码/证据与下一依赖，目标持续active直至R1–R11逐项被实际证据证明。若核心或线路合同有变更，先由主控记录再让实施者继续。

## 完成范围

2026-10-21本地工程与限定浏览器验收完成。证据与外推边界见REPORT.md：本机Edge/Chrome、本地服务、最大36MiB；390px是桌面视口，跨NAT/实体手机/Safari/Firefox及3GiB实传未验证；未部署、提交或推送。
