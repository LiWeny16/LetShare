# 实施进度

## 后续发布（2026-10-21）

- **发布与线上验证完成。** 同一3.8.47 build的五项生产场景分批通过：4MiB双路、32MiB关闭P2P后relay接续、36MiB双方刷新/错源拒绝/原源恢复、16MiB暂停取消刷新、3MiB纯relay；所有完成下载的size/name/SHA一致。汇总保留原run失败和跳过条件，不声称单轮全通过。18:20最终CDN/Pages/二进制/服务健康复查通过，详见RELEASE.md。

- 用户授权部署并上线后测试，前后端3.8.47已上线：main源码c87c8ed、产物db31bc7、server832cbe6；运行hash与本次构建一致，源站/CDN/海外Pages的版本/首页/入口JS核对通过。
- CI现已成功：首次已有会议ICE时序测试失败，定向race3/3后failed job复跑成功；失败记录保留。生产用例失败观测与夹具修正同样保留，不与产品结果混淆。

## 继续后的验收状态（2026-10-21）

- **完成：本地工程与限定浏览器验收R1–R11全部闭环。** fresh reflector直接核验最终六场景JSON、六组唯一任务统计和测试/构建日志，确认无当前必需阻断、无新增finding。PLAN已填逐项证据，REPORT已记录实现、实测与外推边界；未部署/提交/push。此前失败轮次与暂停注入条件继续如实保留。

- 最终默认六场景run已于北京时间15:47:59结束、exit0：6/6 PASS，无跳过/失败/fatal。主控又检查六个fixture两端各仅一个同ID任务；真实下载四项的name/size/SHA全部匹配。4MiB split的P2P确认2.5MiB、relay1.5MiB；3MiB relay-only全量relay确认；32MiB确认9.75MiB后真实关闭P2P，故障后67个relay ACK且同ID完成；36MiB在接收2MiB后双方刷新，错源拒绝/正确源恢复后同ID完成。
- 取消场景暂停后实际UI取消，刷新后双方cancelled；持续历史保存失败期间8块保留且未完成，解除后UI继续双方completed。完整证据`acceptance-evidence.json`，此前失败证据继续保留。
- 六项结束后又独立重跑390px布局并人工查看截图，PASS。产品源码及后端在整轮中保持冻结；待fresh reflector最终R1–R11回包后关闭本地工程验收。

- 产品源码保持冻结。第八轮完整真实浏览器验收已结束：双路、断P2P接续、双方刷新/错源拒绝/原源恢复、暂停后取消并刷新不复活、持续历史保存失败阻止完成并恢复，五项PASS；纯relay仍因采样在完成前结束而漏记后续ACK，整轮FAIL，不改写失败结论。
- 已明确夹具修正：完成后再次合并发送前事件观察器保留的ACK，按时间/字节及出现次数去重，保留有界记录。故障前300ms采样和断路后时间筛选不放宽；待重跑默认六项完整验收。
- 主控执行390×844桌面Chrome视口检查通过：任务列表宽332px、scrollWidth332px，卡片无横向溢出；已查看真实截图，默认技术详情折叠。该项只证明窄屏布局，不代表真实手机/Safari兼容性。

## 本轮新增证据

- 主控独立执行 `node --import tsx --test tests/fileTransferRecoveryLegacy.test.ts tests/fileTransferV2Protocol.test.ts tests/fileTransferV2Store.test.ts`：22/22 通过。
- legacy 已释放第一阶段写集；同一 Luna max 开始串行接入 v2 应用适配器、恢复任务 UI 和历史持久引用，避免 colabLib 并发写入。
- engine 实现已可做双路分块，但主控 review 发现并发帧 busy/drop、accept 前发送、仅首条路径收到 checkpoint 三个阻断问题；已退回作者修复，并要求并发与慢 commit、部分续传、断路切换定向证据。
- backend 已补 24h 终态回执、重启块恢复、offset0 单次重放与分片元数据边界；仍等待最终释放和独立复核。

## 独立审核与真实运行准备

- backend 已释放写集。主控独立执行 `go test ./internal/service ./internal/handler -run '^TestFileTransferV2' -count=1`：两包通过；随后本地 Go 服务成功构建并通过 `/health`。
- 独立 frontend reviewer 返回七项待修复：全覆盖接收任务刷新后未重启最终校验；checkpoint 发送失败误入 failed；frame 失败无退避；取消墓碑丢失；过期任务缺生产清理；发送确认进度刷新丢失；准备阶段暂停后无法继续。主控已逐项派回作者，允许必要的窄 store API 增量，验收仍未通过。
- 主控另指出最小路径窗口不能小于完整分块、notifyPathsChanged 跨房间隔离、协商帧长必须计入 offset 数字增长；作者正在补定向验证。
- 本地验证服务：后端27771、前端27772；可见 Edge/CDP27773 与 Chrome/CDP27774 已启动，独立系统临时 profile；均已在房间123连接本地服务。浏览器准备通过，不代表传输验收通过。

## 本地路径与任务拆分

- 清理本次隔离 profile 的旧测试身份页面后，两浏览器已达到同房间、open DataChannel、probe verified；证据 `.tmp/file-v2-verify/connect-evidence.json`。
- 主控通过实际 file input 和用户行操作完成 Chrome→Edge 的 1MiB P2P 文件传输，接收字节数及 SHA-256 与源文件一致；证据 `.tmp/file-v2-verify/small-transfer-evidence.json`、`small-receive.png`。该项仅证明旧路径的一次正常接收，不冒充 v2 恢复/双链路验收。
- 独立 legacy review 发现 mitt 异步历史保存未被完成 ACK 等待，已要求作者补 awaited persistence bridge；同类 legacy relay finalizer 的 ServerFileTransfer.ts 写集也已明确扩大，保存失败不能发送 complete。
- 为缩短串行尾部，legacy_hardening 明确释放尚未编辑的 Download.tsx/share.tsx 给 transfer_v2_backend 复用 Luna max 实现 R10 UI/DEV 诊断；adapter/colab/history/legacy relay 仍由 legacy_hardening 独占。所有产品代码继续由子代理编写。
- engine 新增可选路径上下文 `{roomId,isCurrent()}`；适配器实际 send 前后必须检查，覆盖异步等待后跨房间隔离。store 窄增量已授权用于发送确认集合与取消墓碑；不扩大身份可变字段。

## 后续交叉审核收敛

- 主控独立 42/42 定向回归通过（legacy + protocol + store + engine）；此后 core 作者新增手动暂停、超过256个本地 ranges、两槽 hash 队列、完成写入失败等测试，报告 core39/39。主控还需重跑最终版本。
- core 独立审核后端并发现状态 Get/Set 竞态、分片配额检查重复 stat、累计 checkpoint 展开成块集合的二次复杂度。backend 作者修复并报告 Go 定向及 race 通过；主控再次独立 Go 定向两包通过。
- 当前仍在补中途 transferring 状态收到重复 offer/accept 的幂等接入（不得降级状态，也不能因合法路径附着报错），修复后需再构建验证后台。
- 当前本地验证后台 PID27096，二进制 `.tmp/file-v2-verify/server-final.exe`，端口27771；前端 PID13496/27772；可见浏览器CDP27773/27774保持。本次最终后台替换前必须核对进程路径。仅本地服务，无部署/推送。
- UI 与 `.tmp/file-v2-verify/acceptance.mjs` 已由作者释放；主控审核并退回测试收件人硬编码、手动暂停恢复、真实下载hash、故障必须在完成前等问题，作者已修正。尚未运行整套浏览器验收。
- legacy/adapter 作者已接入协商、命名空间DC控制、发送入口v2就绪前的旧协议兼容、保存bridge、relay ACK滚动速度、历史引用幂等与删除墓碑。独立review要求补跨房间清理所有runtime；core正在加terminal-only forgetRuntime API以释放File/队列引用。
- 主控最后读到 ChatHistoryManager.addFileMessage 仍在 putRequest.onsuccess 提前返回，已明确授权窄修复为事务 oncomplete/abort/error；保存bridge必须等待真实事务，不接受仅 await 请求成功。作者正在补 abort-after-put 回归。
- server/UI 作者继续只修改自己已授权文件，core/adapter 作者各守写集；独立最终AC reflector 等待真实浏览器证据，不提前判PASS。

## 首轮真实 v2 验收未通过（保留失败证据）

- 主控在最终接线版本独立执行五个文件的定向回归：60/60通过；全项目 `npx tsc --noEmit --pretty false` 通过。后台又一次独立 Go v2定向两包通过。
- 当前后台PID28304，`.tmp/file-v2-verify/server-acceptance.exe`；此后二进制需包含 Go optional-field-presence 修复（creditBytes/ranges指针）。作者已完成真实WS显式0/[]与缺省省略的回归，正常/race通过，尚需重建。
- 主控运行 `.tmp/file-v2-verify/acceptance.mjs`：首个 split case 没有P2P ACK数据，第二个case被上一case的下载层遮挡用户行点击。主控停止本次runner PID24316，停止后允许作者继续修复；该失败不算通过。
- adapter作者确认所有普通discover广播并未统一携带fileTransferV2，而接收方在缺字段时清空能力/hello-ack，形成P2P重新协商窗口；准备统一在 colab.broadcastSignal 注入能力并补回归。UI/harness作者负责真实关闭下载层及失败前保存诊断，不用强制点击绕过。
- 新的独立core复核退回：自动恢复接收状态错误(paused丢帧)、checkpoint await后generation检查、failed取消一致性、暂停/重连事件速率归零、resume控制失败恢复、细碎帧队列数量/元数据计费。core作者正在补修复/定向测试。
- 已拒绝“已完成历史每次刷新都必须重hash才能回complete”的扩张：已完成且用户删除文件的receipt有意保留24h并回答迟到offer，防止重新下载；重校验要求针对中断的非终态全覆盖任务。公开读取缺块仍失败。已拒绝禁用busy时取消按钮的建议，因为源文件长hash必须可取消。

## 当前收尾依赖

- core最终pause恢复packet释放：engine/store52/52；root独立完整五文件86/86、full tsc、隔离build通过。显式resume offer标记保留至accept/complete，pause清旧accepted path，丢失初次resume后路径恢复可自动重试；source-before/after-peerresume和冷加载/并发restore已有回归。
- 第七轮完整browser：basic、32MiB真实P2P断开接续、36MiB双方刷新/错源拒绝/原源续传/真实下载hash、持续history failure gate阻止假完成并释放后恢复均PASS；整轮仍FAIL。relay实际完成且failure捕获12个ACK/3145728字节，但固定4s采样先结束，旧观测0使断言失败；cancel16MiB在点击时已完成，button detached。证据`acceptance-seventh-run-failed.json`。
- author仅.tmp收敛两处：发送前订阅真实onUpdate保留有界ACK观测，断P2P后ACK按故障时刻筛选；cancel fixture在首个256KiB确认时用现有API暂停，随后真实UI取消并刷新，清楚记录这个故障设置。产品源码保持冻结，hash/唯一任务/完成条件不放宽。

- 用户“继续”后，core暂停通知首轮已交付；fresh reviewer与root继续退回同一功能的具体恢复边界：source attach不能越过remote pause、迟到accept/checkpoint/普通offer不能清pause、持久任务冷加载与并发restore不能覆写runtime。采用已有reason字段中的显式`v2-resume` offer标记，无后端schema变化。
- root补充同一pause恢复的丢包场景：首次resume标记在断路时丢失后，retry/notify必须保留恢复意图直至accept；pause后的旧acceptedPaths不应作为新轮发送许可。作者补异步路径回归后冻结。
- 当前实际组件DEV引用上的限定basic已再次PASS，真实send wrapper捕获1次且唯一任务、两路ACK和4MiB真实下载hash正确；完整验收仍未PASS，remote pause UI文案/隐藏无效continue已由backend释放。

- 原生DOM输入在真实App页36MiB 16ms，原File name/size/SHA全部正确（`raw-app-input-evidence.json`），输入延迟来自locator路径，canonical已改CDP nodeId并保留30s有限超时。第六轮异常重复任务与遮挡已保留为`acceptance-sixth-run-failed.json`，尚无静态可定罪原因。
- 动态import的测试wrapper没有捕捉到实际组件singleton，改由share现有DEV hook暴露当前真实引用供测试包装；此功能仅DEV。新限定basic追踪PASS：一组trusted input/change、一组trusted row click、一次真实sendFileAuto、唯一sender任务和同ID receiver，P2P确认2.5MiB+relay1.5MiB，实际下载name/size/hash正确；默认全六case未删。禁止把限定case跳过项当全通过。
- 双端pause原本仅本地停，core加耦合回归确认双方均RED后修peer通知；additive `pauseOrigin`持久化区分local/remote，界面remote只显示等待对方继续。core首轮engine/store50/50+tsc通过。
- Fresh reviewer退回pause恢复两处，core同批继续：remote仍暂停时sender重选源不得清remote开始发；无runtime旧task在异步restore前收到resume offer须正确恢复状态，createRuntime前不能覆盖并发restore已建runtime。root另退回迟到checkpoint/accept不能解除remote pause。修复释放后才重跑browser。

- GUI无感窄修已释放；root独立integration20/20、最终五文件81/81、全项目tsc、隔离Vite build通过；Go两包v2 `-race`亦由root独立通过。默认卡片截图已实际查看：文件/简单状态/下载，技术数据与删除收起。
- 第五轮完整run：basic/relay/failover/cancel PASS，32MiB在确认10223616字节后断P2P原ID继续，下载hash一致；refresh36MiB仍在原生输入路径设置超时，尚未发起该任务。history one-shot故障用例的新任务直接completed，可能被恢复/其他任务消耗；现有测试不能稳健证明持续保存失败，保持FAIL。证据`acceptance-fifth-run-failed.json`。
- 已限author仅修.tmp夹具：input模拟实际按钮的清空input并bringToFront，连续32/36MiB探针；保存故障对特定fixture持续阻断至显式释放（只在浏览器内临时包装现有保存方法，finally恢复），检查期间无完成ACK，再恢复真实UI继续。产品源码继续冻结，未放宽任何hash或完成条件。

- 最终owner/cross-room pause版本主控独立五文件79/79、full tsc、隔离Vite build通过；fresh reflector确认其两个finding均闭环。
- 第四轮磁盘fixture完整run：basic/relay/failover/cancel四项PASS，32MiB在确认8650752字节后实际断P2P，原ID由relay继续且真实下载hash正确。refresh用例在注入pause前受已打开drawer遮挡测试菜单失败；history失败恢复功能双方completed，但最后截图超时使case保持FAIL，未以功能完成替代验收。保留`acceptance-fourth-run-ui-failed.json`，待harness稳健化重跑。
- 用户强调GUI无感，已沿既有范围派backend作者窄收敛Download卡片：默认简明、技术数据收起、重连中性自动继续、只给必要动作；并修harness drawer动画/截图可靠性。派legacy作者窄收敛task-bound relay cooldown错误：保留恢复/诊断，停止全局弹窗和强开面板；真正需操作错误仍提示。写集互不重叠，root不写产品代码。

- 双offer初始化串行/创建期取消墓碑已由core释放；adapter owner guards、两阶段历史删除和独立清理也已释放，产品源码冻结。主控独立五文件定向回归77/77与全项目tsc通过；隔离 `vite build --outDir .tmp/file-v2-verify/dist --emptyOutDir`通过，未触碰docs构建输出。
- 第二轮真实v2：basic 4MiB双路PASS，P2P确认2883584字节、relay确认1310720字节，真实下载SHA与源一致。relay-only 3MiB双方任务completed但手动下载SHA不匹配，主控停止runner PID22076，证据 `acceptance-second-run-failed.json`；backend作者正在只读定位下载事件/产品路径，不放宽hash断言。
- 已派fresh `file_v2_final_reflector`（gpt-6-luna/max）只读独立审核R1–R11；它未参与实现，等待真实浏览器完整证据，当前不可判全体验收通过。
- 公网下载只读诊断：同一relay任务重新从UI下载，sender manifest / receiver分块File / 真实下载流SHA完全一致，12块逐块hash匹配（`download-diagnosis.json`）。原失败未记录actual filename/size/hash，无法追溯归因；canonical harness已加强这些断言与失败证据，且下一轮独占CDP避免并发附着。原失败仍保留，不改写为PASS。
- Fresh reflector指出驻留runtime按ID操作和snapshot缺当前owner检查，已派core窄修；保留同owner跨房间history删除cancel/forget语义。产品源码暂解除冻结给这一窄写集，修复释放后再跑完整浏览器。
- 主控另外独立现有文件消息unit67/67通过；Go v2两包再次定向通过。隔离build无错误，仅既有Vite配置/大chunk告警。

- 后台 optional presence 修复已独立 Go 定向通过并重建：当前PID31568，`.tmp/file-v2-verify/server-r5.exe`，27771。前端和浏览器端口维持原布局。
- 首轮失败证据保存在 `.tmp/file-v2-verify/acceptance-first-run-failed.json` 和 `acceptance-evidence-first-failed.json`。修正后的canonical harness仍为 `.tmp/file-v2-verify/acceptance.mjs`，保留增量JSON与截图，使用真实点击关闭下载层；尚待重跑。
- discover统一能力修复已由作者12/12 integration +全项目tsc通过；主控待最终合并回归。发送前等待协商的room/self/session guard也已补。
- core六项独立review修复+跨房间offer检查已释放，engine32/32+全项目tsc通过。主控又发现真实并发双offer初次建任务会跨await重复createRuntime，并且create未完成时cancel被忽略；已再次派给core做per-transfer pending初始化去重/串行与gated regression。这是重跑浏览器前的阻断。
- adapter/history作者正在补两项独立review：所有按transferId读/改必须验证localParticipantId；历史删除改为先提交历史事务后清理字节，失败前保留可用链接，后置清理失败保持任务可见可重试并解除永久pin。原测试已有保存事务abort、取消失败保留历史等，需补删除事务abort。
- 主控不写产品源代码，继续负责review、验证与任务文档；Goal仍active，整套真实v2验收尚未通过。

- 目标active；前一个goal轮次为首次实施轮，已通过当前git状态/源码重新确认基线，存在实质新增设计与验收证据。
- PLAN与DESIGN已建立，完整R1–R11保留。已有旧审核报告作为输入，主控只负责计划/文档/review/验证。
- 首波分成既有路径稳定化、新协议/持久存储核心、服务端v2，写入集合不重叠，全部Luna max实施。
- 已实际派发legacy_hardening、transfer_v2_core、transfer_v2_backend，均为gpt-6-luna/max，正在各自互不重叠写集实现；主控review协议接口。
- 核心已确认LSF2/分块/位图/身份与事务完成接口方向；服务端活路径已核对processMessage/processBinaryMessage，新增能力响应与实际额度边界，spool上限每任务64MiB/全局512MiB，接收checkpoint释放缓存。
- 后续依赖：core源接口稳定后派发engine；legacy释放colabLib写集后再进行v2集成/UI。当前未部署。
- core已实现protocol/store/hash/worker，主控实际读源码退回safeID、UTF8字节边界、空frame、终态迟到提交、活动租约与hash取消/超时等修正；子代理报告14/14定向回归、tsc和diff检查通过。已派发同一Luna max继续engine实现，受ENGINE-CONTRACT约束。
- backend已接真实WS处理路径，子代理报告真实WS回归通过；主控读服务代码退回缓存重发放大、blocks路径/孤儿清理、restart计数与协议边界修正。仍等待最终返回和独立验证。
- legacy已修改既有传输与Blob历史保存，子代理报告tsc通过；主控读完整colab差异后追加canonical hash顺序与await后实例校验要求，当前正在补定向回归。
- 浏览器验证准备：BrowserOS Neo callable工具未提供，使用项目visible-browser-cdp-debug规定的本地Edge+Chrome/CDP路径；已确认两浏览器可执行文件和指定本地端口空闲，尚未启动浏览器。所有profile将放系统临时目录，保留现有用户profile。
