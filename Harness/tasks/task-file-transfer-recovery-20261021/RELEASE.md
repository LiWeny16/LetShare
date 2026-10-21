# 3.8.47 发布与线上验证

## 授权与初始状态

- 用户明确授权部署后测试，随后要求继续；本轮可执行部署、必要提交/推送及真实线上验证。
- 部署前线上3.8.46，version sentinel `2026-10-20T11:43:31Z-7muyr`；源站与公网一致。
- 前端main发布worktree：`.tmp/release-call-audio-3.8.46`，初始HEAD `69e68b4cee4fca748a1e57db98cfce3cd3e2cf35`且干净。server发布基线 `052e483dfa58802fe39d99354aeb653d2b057406`；须保留它比审核工作区额外的WebSocket清理修复。
- ECS部署前服务active，二进制SHA-256 `93e5705595299b0e6fd738617e2d1706b3f8059ffb540c787db42938cc7e6fb3`；剩余磁盘23GiB。当前没有仍运行的部署进程。

## 计划

1. 在隔离main目录准备发布源码与3.8.47版本字段，审核相对线上版本的实际差异；后端只增量合入v2。
2. 保存可恢复的前后端部署前副本，执行标准deploy.cjs后端/前端流程，同步源码与docs到远端。
3. 核对运行二进制、服务健康、源站/CDN/海外Pages产物与版本。
4. 在生产https页面、真实Edge/Chrome以实际文件输入和下载校验验证双路、relay、断P2P接续、双方刷新源重选和取消；测试仅使用专属身份及文件。生产不加入DEV测试入口。

## 状态

**完成：前后端3.8.47已上线，五个生产场景分批验证通过。** 原始失败、选择性跳过及故障设置全部保留；不是把任一失败run改写成整套通过。

### 已上线

- 后端提交 `832cbe6af9f3a7e339235ad6e04faeed29a94906`，在 `052e483` 上增量加入v2，保留已有WebSocket清理修复；独立delta审核无阻断。主控执行v2/disconnect/cleanup定向Go race两包通过。
- 标准 `deploy.cjs --backend` 完成；北京时间17:35:34服务重启，active，`/health` healthy。线上与本地二进制SHA-256均为 `b720a9226236d63f065de0d047fd369ac725e043ba7d93126d1e38a152e56853`。
- 前端源码提交 `c87c8ed`，产物提交/main远端 `db31bc72fee4fcea9b66ccdfd97ba4726b0e78ea`。独立发布目录内执行相同package build脚本（`npm run build`，含tsc/Vite/后处理），然后标准 `deploy.cjs --frontend --no-build` 上传并同步产物。
- `pnpm build`首次自动启动依赖重装校验，尚未执行构建；核对自身进程后停止，现有依赖保持，改用npm执行同一构建脚本。此前源文件新增EOF空行由Luna仅做格式清理，审核与发布副本哈希一致。
- 构建版本3.8.47，sentinel `2026-10-21T09:38:27Z-yfndn`。CDN及强制GitHub Pages IP的HTTPS请求：版本、首页SHA与入口JS SHA全部一致；源站首页SHA亦匹配。`release-surfaces.json`保留证据。无CDN密钥，脚本未提交刷新API；实际普通URL读取已确认新版。
- 回滚副本：服务器 `/root/cloud/letshare-server-linux.pre-file-v2-3.8.47` 与 `/root/cloud/letshare-frontend.pre-file-v2-3.8.47.tgz`。

### CI

- Pages部署成功；前端类型/单测/生产构建CI成功。
- 首次后端CI仅已有会议媒体测试 `TestMeetingE2E_AC001_AC009_OfferAnswerMediaAndSubscriberRestart` 失败，日志有ICE在SDP前到达（remote description is not set），无Go DATA RACE。该测试及原路径未被本次修改；v2构造不创建新网络工作，新增清理在一分钟ticker后运行，失败发生于12秒内。
- 独立Luna只读复核，并在发布副本针对该测试 `-race -count=3` 全通过。保留首次失败日志后重跑failed job，CI `39579185484` 现为completed/success（`ci-final.json`），不是忽略该失败。

### 生产浏览器验收

生产五个场景已有有效通过证据，来自同一已部署build的三个run。生产构建无DEV入口；脚本使用真实文件input、用户行、下载SHA、只读IDB与原生网络元数据。

前三次启动观察在文件用例开始前退出：第一次过早读取lazy模块尚未写入的版本；第二/三次缓存worker仍installing时状态检查失败。保留失败证据，当前改为等待实际应用版本及Node侧明确等待worker激活，不以这些启动失败替代文件验收。

- 第四轮两项真实PASS：4MiB同时有P2P/relay发送和接收帧，下载大小/文件名/SHA正确；32MiB在接收13.75MiB时关闭双方原生P2P连接，后续观察到relay继续，原ID完成且下载SHA正确。第三项尚未发送文件就因前一项关闭了P2P、测试又要求P2P已打开而超时；修正为独立场景开始前恢复页面生命周期。
- 第五轮4MiB已完成下载SHA校验，但“必须每次两路都传帧”的附加断言失败；该轮在断言前未写出路由计数，无法追溯缺哪一路。独立review直接检查engine与设计，确认单条accepted可用路径可以先发送并完成，这是“无收益可单路”的既定行为。夹具已改为普通文件要求真实匹配路径与持久确认，保留实际双路作为单独证据；未改产品以强制小文件双路。
- 后续定向执行尚未完成的36MiB刷新/错源/原源恢复、16MiB暂停取消刷新、3MiB纯relay。最终生产验收将逐项引用有效原始run，不把定向跳过项记为通过，也不声称所有项来自同一轮。16MiB取消用例明确先保持原生P2P关闭，让真实relay部分传输稳定存在，再从UI暂停/取消；不是活跃写入取消竞态。

### 最终有效场景

| 场景 | 生产证据 |
| --- | --- |
| 4MiB实际双路 | P2P真实载荷3.75MiB、relay0.25MiB，发送/接收均观察到两路帧；完成下载大小/文件名/SHA一致 |
| 32MiB关闭P2P接续 | 接收13.75MiB时关闭双方原生连接；同ID随后观察到1136个relay发送帧，最终32MiB真实下载SHA一致；接收端还有1个迟到P2P帧，不声称断开瞬间全部归零 |
| 36MiB双方刷新恢复 | UI暂停后刷新，发送端needs-source、接收端paused；错源拒绝前后76个持久块不变，正确源重选后同ID完成，真实下载SHA一致 |
| 16MiB暂停/取消/刷新 | P2P原生连接显式保持关闭，接收256KiB时UI暂停并取消；刷新后双方cancelled |
| 3MiB纯relay | 原生P2P保持关闭；192个relay发送帧及192个接收帧，双方P2P帧0；真实下载3MiB，文件名与SHA一致 |

汇总 `online-accepted-evidence.json` 明确记录三份原始JSON、各自SHA、原run后续失败情况及仅选取的有效场景；没有将skipped项当通过。普通小文件允许先就绪的可用路径完成，不能要求每次强制双路。两路收到的checkpoint是全局持久区间的重复广播，不当作每路独有确认字节。

主控已人工查看生产完成卡片截图，技术详情默认折叠。最终北京时间18:20复查CDN/Pages版本、首页与入口JS仍一致；运行二进制hash未变，服务healthy，最近10分钟无error日志。

## 验证边界与记录位置

- 真实可见Edge/Chrome在同一台本机，连接生产HTTPS/WSS服务；P2P不是实际中国/新加坡跨NAT场景。最大实传36MiB，未外推为3GiB实传或100%成功率。
- 实体手机/Safari/Firefox未在线实测；之前390px布局只属于桌面Chrome视口。
- 线上未注入持续历史保存失败或重启整个生产后端来测试恢复；对应路径已有本地浏览器及Go重建回归，避免把这些本地证据写成线上行为。
- 本地忽略目录 `.tmp/file-v2-online/` 保存构建、部署、CI、表面哈希和三份有效run的完整证据/截图；未保存私人凭据。
