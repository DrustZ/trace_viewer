# Code Review Feedback — ACE Cockpit (branch `codex/ace-trace-cockpit`)

> 审查方：Claude（受 Ray 委托做周期性审查）。本文件每轮审查更新，newest round 在最上面。
> 行号基于审查时的工作区快照；codex 持续在改，行号可能有漂移，按符号名定位。
> 标 **[已修复 by Claude]** 的条目我已直接改掉，无需重复处理；其余请 codex 处理或明确说明不改的理由。

## Round 19 — 2026-08-07 18:15 — 六提交审查（1ae8cd8..12eaec1）：judge 校准闭环，无阻塞问题

### 状态：**973 tests / 112 files 全绿，tsc 干净**（Round 18 是 960/110）

审查范围：`e1176e6` Task 原始 JSON + evaluation 可见性 · `1330570` 会话流内联判分锚定 ·
`c1eb6a4` demo 走廊六卡 · `9da3815` prompt preset v3/v4 · `a4b43f4` drawer 摘要降位 ·
`12eaec1` LLM judge review section。

### 无需修改；两处做得对，值得点出

- **`9da3815` 单一常量贯穿五处** ⭐ 这次改动的正确形状：`ACE_PROMPT_PRESETS` 一处定义，
  server 请求校验 / `runConfigFidelity` / trace 记录 / 下拉 / demo 全部引用它。此前
  三项列表手写五份，桥侧加 v3/v4 时必然漏改其中一两处 —— 这类「新增枚举值要改 N 处」
  的味道，就该按这个办法根治。
- **`12eaec1` judgeReviews 的向后兼容与落盘链路是完整的**：可选字段 + strict 枚举 +
  250 维上限；`finalizeReviewPayload` 原样透传且有 round-trip 测试
  （`reviewPayloadOps.test.ts` 断言 `finalized.judgeReviews` 全等，空 payload 时为
  `undefined`）；旧 `reviews.jsonl` 无该字段照常解析。人工标注最怕「填了但没存」，
  这条链路我逐段跟过，没有丢字段的缝。
  另外 `verdict.critique` 为空时显式写「The judge recorded no evidence for this
  dimension.」而不是留白——空白会被读成「没问题」，这个判断是对的。

### 两处小观察（不影响正确性，看你要不要动）

1. **`ReviewPanel.tsx:219` — 只写 note 不点按钮，会默默存成 `unsure`。**
   `onNote` 里 `decision: previous.judgeReviews?.[dimension]?.decision ?? 'unsure'`。
   语义上说得通（没表态即不确定），但导出做 κ 时，「人打了字但没选」和「人主动选了
   unsure」是两种不同的数据。若要区分，可让 note-only 时 decision 存 `null` 并在
   提交前提示；若不区分，建议在 schema 注释里写一句「unsure 含 note-only 的隐式态」，
   免得半年后自己误读。
2. **judge 维度的 `disagree` 不强制 note。** 现在 placeholder 已经在引导（「judge 错在
   哪」），但 disagree 无理由的记录对校准几乎没用。轻量做法：提交时若存在
   `decision==='disagree' && !note.trim()`，给一次非阻塞确认。

### 待真机验证（你自己已在 commit message 里记了）

带 judge 的真实批次要等 ANTHROPIC key。**这里有个上游事实值得同步**：ac_express 侧
`judge_mode` 在全部 160 个 batch 里都是 `off`，也就是说目前磁盘上**没有任何 episode
带 judge sidecar**。所以 ReviewJudgeSection 在真实数据上一定会走「automatic 上下文
存在但没有 judge verdict」那条空态分支——这条分支你已经显式写了文案，是对的。真机
验证前，用 fixture 覆盖到的部分基本就是全部可覆盖的部分。

## Round 18 — 2026-08-07 14:20 — 五提交审查（960fe57..1ae8cd8）：两个真 bug 的根因很硬

### 无需修改；两处根因定位质量突出

- **960fe57 kqueue fd 耗尽** ⭐ 最佳诊断：实测出 macOS `posix_spawn` 在进程持有 ~10,441 个
  fs.watch fd 时返回 EBADF（OPEN_MAX 10240 交互），语料今天越过阈值后 ACE 桥全部子进程
  启动失败、HTTP 却正常，表现为"Playground 整面板不可用"。修法（watcher 改 stat 轮询、
  fd 11,313 → 44、不再 watch checkpoint 档案、轮询延迟被前端 1.5s 兜底覆盖）干净且可回退
  （`TRACE_VIEWER_WATCH_POLL_MS=0`）。**这个 bug 随语料增长必然复发，抓得很及时。**
- **430fdd1 localhost → 127.0.0.1** ⭐ 同类：Cursor 占了 `::1:8787`，node 解析 localhost 优先
  IPv6，导致 vite 代理整体打到陌生进程、全站 /api 404。钉死 IPv4 是正解。
- 65b956e / fe18b9a / 1ae8cd8 Playground transport 与 Replicate 修复：`chat+reasoning`
  非法组合的预检 + 记录消毒（源 trace 记的就是死因配置时自动改 responses 并解释）思路对——
  "忠实复现一个永远跑不起来的配置没有意义"这个判断是产品直觉，赞。
- 943 tests + tsc 全绿（Round 17 时 925 → +18）。

### 唯一提醒

- 工作区历史草稿脚本 `.{autorun,quickrun,sse,replicate}_repro.mjs` / `.verify_replicate.mjs`
  仍在，建议 .gitignore 或删除。

## Round 17 — 2026-08-07 13:05 — Playground 三提交审查（b5c84de..07b2ae5）

### 审查结论：三个提交质量都很高，无需修改

- **b5c84de SSE 假死修复** ✅ 根因定位准确（僵尸 EventSource / 同源连接占满，而非
  scanner 或 watcher），1.5s 轮询兜底有界（仅 run 活跃期，durable trace 到手/终态即停，
  SSE 仍是快路径），Playwright 阻断 /api/events 实测验证。
- **0763194 Quick run** ✅ 单一主 CTA 设计合理，`quickRunSelection` 纯函数带测试。
- **07b2ae5 autorun=1 深链** ✅ 花钱路径审查通过：`shouldAutorun` 纯函数（配置不全不跑、
  已有 run 不跑、桥不可用不跑）+ 三层防重复（StrictMode-safe guard ref、消费即清 URL 参数、
  onRunSelected 兜底）+ runEpisode 原有 in-flight/batchId 幂等仍在 + Playwright 实测单次
  POST。这是本仓库花钱路径防护的最佳实践样例。

### 小提醒

- 仓库根的 `.autorun_repro.mjs` / `.quickrun_repro.mjs` / `.sse_repro.mjs` 草稿脚本
  记得删除或加 .gitignore，避免被下次快照提交扫入。
- 925 tests + tsc 全绿（Round 16 时 900 → +25）。

## Round 16 — 2026-08-07 12:15 — 遗留 minor 清扫 + 第二个 flaky 定位

- 核验早期 minor：app.ts 错误中间件 4xx-5xx 透传 ✅ 已修；`publicBridgeResult` 递归
  basename 全部 `*path` 键 ✅ 已修；launchLineageStore 队列 ✅ 已修。
- **[已修复 by Claude]** `bridge.ts parseEnvelope` — `{"ok":false}` 无 error 对象时抛裸
  TypeError 丢 stderr 诊断（Round 1 minor #6，最后一个真实遗留）→ 显式校验 + 类型化
  `invalid_bridge_response`（+fakeBridge 测试）。
- **[已修复 by Claude]** 定位到巡检期间第二个 flaky：`reviews.test.ts › filters queue
  state/priority…` 多请求集成测试在满并发下 5s 超时 → 15s（连跑 3 轮 900/900 验证）。
- 仍开放（均 minor、低优先级）：AceAnalysisPage `runSearch` 本地 state 不进 URL；
  events.ts SSE 慢消费者无背压上限。

## Round 15 — 2026-08-07 11:35 — 接手 Round 13 遗留 D2/D3/D4

codex 两轮空闲，我直接实现了（899 tests + tsc 全绿验证）：

1. **D2** `ReviewPanel` — `DetailsSection` 增加 `onToggle`，"Automatic failures" 手风琴的
   open 状态提升为 `failuresSectionOpen`；C/X 快捷键仅在手风琴展开（finding 可见）时生效。
2. **D3** `ReviewPanel` — Cmd+S/Cmd+Enter 的编辑目标豁免限定在面板子树：
   `panelRef.contains(event.target)`，在队列搜索/Filters popover 输入框里按 chord 不再
   保存/锁定当前 review。
3. **D4** `ReviewPage` — `movePending` state 在 move()（保存草稿 + 邻页请求）期间传
   `suspended` 给面板，恢复冻结路径；死 prop 复活为原设计用途，边界期键入不再被静默丢弃。

## Round 14 — 2026-08-07 10:25 — Playground 四提交审查（04f6b88..69f376c）

- **Playground/lab 重构质量好**：花钱路径三重防护齐全（共享 `buildAceRunRequest` 校验 +
  `submitInFlight` ref + sessionStorage 幂等 batchId），`playgroundRun.ts` 抽成纯函数 +
  153 行测试；69f376c 主动把 batchId 方案对齐 Round 13 的修复，赞。
- 本轮无新发现、无 Claude 改动；899 tests + tsc 全绿。
- 温和重提 Round 13 遗留：D2（C/X 改折叠面板中不可见 failure）、D3（Cmd+Enter 面板级
  豁免）、D4（`suspended` 死 prop）尚未处理，按你们 P0 计划排期即可。

## Round 13 — 2026-08-07 10:10 — UX 重设计十提交审查（afbbba2..2461a7d）

### 总体评价

重设计结构上很好：ReviewPanel 的竞态防护在拆分中逐字保留；键控 remount +
`workspaceReady` 门 + `moving` 序列化让"跨 subject 提交"这类 bug 结构性不可能而非仅靠
防护；`?run=` 合并、review 过滤 URL round-trip、NavRail 纯增量都对；868→874 测试全绿。

### 发现（按严重度）

1. **[MEDIUM-HIGH] 抽屉卸载销毁 launcher 幂等 key（Round 8 保证被回归）** —
   `Drawer.tsx` `if (!open) return null` + launcher 进抽屉后，"启动失败→关抽屉→重开→重试"
   会铸新 batchId，服务端无法 409 拒重 → 二次花钱；且中途关抽屉后 `start.error` 无处渲染。
   **[已修复 by Claude]**：`pendingBatchId` 改为 sessionStorage 持久
   （key=`ace-launcher-pending-batch:<context>`，成功后清除，storage 不可用时回退内存 ref）。
   `start.error` 卸载后不可见的问题留给你们：建议关抽屉时若有未展示错误，在页面上显示一条。
2. **[LOW-MEDIUM] C/X 快捷键会改动折叠在 Details 手风琴里的不可见 failure** —
   `focusedFailureId` 在手风琴从未展开时也默认聚焦第一条，误触 C/X 即静默改判 + autosave
   落盘。建议：手风琴收起时 C/X no-op（把 `<details>` 的 open 状态提到 state 并门控）。
   你们正在拆分该区域组件，顺手处理。
3. **[LOW-MEDIUM] Cmd+Enter 的编辑目标豁免是页面级而非面板级** — 在队列 Filters popover
   的输入框里按 Cmd+Enter 会提交并锁定当前 review（Calibration 锁不可逆）。建议：chord
   豁免仅当 target 在面板子树内（panel root ref `.contains(event.target)`）。
4. **[LOW] Next/Prev 页边界期间的键入被静默丢弃** — `move()` await 队列请求期间旧面板仍可
   编辑，`setSelected` remount 丢弃这窗口的编辑；旧设计的 `suspended` 冻结路径现在是死
   prop（ReviewPage 不再传）。要么恢复传 `suspended`，要么删掉死 prop。
5. **[LOW] Cmd+S 手动保存缺 submitInFlight 防护** — **[已修复 by Claude]**：`saveCurrent`
   开头加了检查（与 autosave timer 同类防护）。
6. **[LOW·先前既有] episode 分页从未钳制的原始索引步进** — **[已修复 by Claude]**：
   Previous/Next 改为从 `currentEpisodePage` 步进（SSE 数据缩水后 Previous 不再"点几下没
   反应"）。

## Round 12 — 2026-08-07 05:05（Round 9-11 为空巡检，未记录）

- 抓到一个 flaky：`server/store/scan.test.ts › watches the resolved path from the same
  labelled root spec` 在机器高负载时偶发超时（chokidar 事件 3s 内未到）。已把该文件 7 处
  watcher `waitFor` 超时 3s→10s（`waitFor` 条件满足即返回，绿跑不变慢）。连跑 3 轮套件
  验证稳定。

## Round 8 — 2026-08-07 02:55

### 状态

codex 连续第二轮空闲（工作区干净），我把剩余 LOW 清了一部分。

### 本轮 Claude 的直接修改（831 tests + tsc 全绿验证）

1. **launcher 花钱幂等 key（Round 2 收口）** — `AceRunLauncher.submit` 现在每个提交会话
   生成一次性 `viewer-<uuid>` 作为 `batchId`：失败重试复用同一 id（若上次其实已启动，
   服务端以 run_already_active/duplicate 409 拒绝而不是再开一批），成功后清空。
   Experiments 路径原本就传 `${experimentId}-a/-b`，现在两条花钱路径都有服务端幂等。

### 有意不做的（记录决策）

- **probe 失败 TTL**：我实现后发现你们的测试
  `retries unavailable and digest-mismatch probes instead of caching failures`
  显式固化了"失败不缓存、每请求重试"的设计（修好的 venv 立即恢复优先）。已回退，尊重
  这个决策。观察：坏 venv 下 2s 轮询 ≈ 每 2s 一个快速失败的解释器（in-flight 去重只限
  并发不限频率）。如果以后想改，建议 TTL + 可注入时钟，测试改为推进时间断言。
- **probe 指纹 venv/symlink 盲区**：作为已知限制记录（非可编辑安装的依赖升级不会失效
  缓存；symlink 的 .py 不进指纹）。本地工具威胁模型下可接受，文档里提一句即可。

### 八轮总结（2026-08-06 22:00 → 08-07 02:55）

- 测试 582 → 831，tsc/biome 全绿，全部 Critical/HIGH/MEDIUM 清零。
- codex 修复亮点：Tailnet token 门 + IP 校验、dataRoots allowlist、SSE 定向失效、
  probe 内容寻址缓存、overlay token 恢复、start READY 等待、control per-run flock。
- Claude 直接修复 13 项：reviewStore 撕裂尾部、bridge stdin EPIPE、useAceRun 轮询、
  ReplayTab 花费校验、三处花钱路径 in-flight 防护、experiments 部分失败自锁、
  recordHasDisagreement、ReviewPanel autosave 竞态、traceStore uid 集合、
  setSearch 合并、stateRank 全序、detectorAnalysisAvailable、informalSelectedRunIds、
  launcher 幂等 batchId。

## Round 7 — 2026-08-07 02:20

### 状态

codex 本轮无新改动（工作区干净）。按计划我把最后一个 MEDIUM 实现掉了。

### 本轮 Claude 的直接修改（831 tests + tsc 全绿验证）

1. **headline 指标 informal 标记（Round 3 #5 收口）**：
   - `shared/schema/ace.ts` — `AceDashboardScope` 新增必填 `informalSelectedRunIds`；
   - `server/ace/dashboard.ts` — 选中但 `includedByDefault !== true`（debug/counterfactual/
     unknown）的 run 进该列表；
   - `src/pages/AceAnalysisPage.tsx` — 非空时在 outcome 图块上方显示 amber 提示条
     （"混入 informal episodes，不可与 formal 指标比较"）；
   - `server/routes/ace.test.ts` — 新增显式选中 debug run 的测试 + 默认 scope 为空断言。
2. `src/pages/AceAnalysisPage.test.tsx` fixture 补新必填字段。

### 全部 10 项历史修复验证完好

fork/submit/launch in-flight ×3、prepareFinalsAppend、recordHasDisagreement 直比、
traceStore uid 集合、saveDraft.reset、setSearch 合并、stateRank 全序、
detectorAnalysisAvailable。

### 仍开放（全部 LOW，酌情）

- probe 失败结果短 TTL；probe 指纹 venv/symlink 盲区（Round 4）。
- server 端花钱幂等 key：launcher 可传 `batchId` 但默认不传（Round 2）——如果要做，
  launcher 生成一次性 UUID batchId 即可，服务端已支持。
- 可选：per-run 表格（AceAnalysisPage 底部）给 informal run 行加标记，与顶部提示条呼应。

## Round 6 — 2026-08-07 01:45

### Round 5 响应验证

- **README tailnet 警告** ✅ 措辞准确（单人 tailnet + trusted ACLs 才可关门；共享/tagged
  设备必须保留），`TRACE_VIEWER_TAILSCALE_IP` 还加了 Self-地址校验 + 单测，超出预期。
- **reviews 队列 disagreement 比较器** ✅ `Number(x === true)` 归一化，一致了。
- `serveTailscale` 抽出可测的 `resolveTailscaleIdentity`/`accessTokenRequired` ✅。

### 本轮 Claude 的直接修改（830 tests + tsc 全绿验证）

1. `server/routes/reviews.ts` — `state` 比较器补全为全序（draft < unreviewed < submitted）：
   原先 (submitted, unreviewed) 两个方向都返回 1，分页顺序未定义（Round 1 遗留的另一半）。
2. `server/routes/ace.ts` + `shared/schema/ace.ts` — dashboard 响应加
   `detectorAnalysisAvailable`（Round 4 #2）：消费者现在能区分"detector 零发现"和
   "分析桥挂了/稳定化到顶"。
3. `src/components/ace/AceDashboard.tsx` — analysis 不可用时显示 amber 提示条
   （"detector 数据缺失而非零失败"）。

### 仍开放

1. **[MEDIUM] headline 指标 informal-run 标记**（dashboard.ts，第四次顺延）——显式选中
   debug/counterfactual run 时 `passRateExecuted`/escalation matrix 混入非正式数据且无标记。
   建议：`buildAceDashboard` 在 scope 内含非 scored run 时输出 `mixedRunKinds: true`，
   前端在 Pass rate 图块上标 informal 徽标（和我这轮加的 detector 提示条同一个模式）。
2. **[LOW] probe 失败结果短 TTL**；probe 指纹 venv/symlink 盲区（Round 4 #3/#4）。
3. 工作区进行中的 aceSidecar/ReviewPanel/ReviewPage 改动下轮验证。

## Round 5 — 2026-08-07 01:10

### 状态

- **94bed08（Tailnet 免 token opt-out）设计 OK**：默认仍开启 token 门，只有显式
  `TRACE_VIEWER_REQUIRE_ACCESS_TOKEN=0` 才关闭。一个要求：README 的 Tailnet 段落请注明
  "只有单人 tailnet 才可以关门；共享/带 tagged 设备的 tailnet 必须保留 token 门"——
  关门后花钱的 run 启动和目录挂载对全 tailnet 开放。
- 工作区进行中的 runCatalog `__identity_conflicts`（身份冲突→ungraded）方向正确，
  正好覆盖 Round 3 #7（重复 batch_id/身份冲突）的一部分；等提交后下轮验证。
- `biome check` 已全绿 ✅；README 测试计数 598→821 我顺手更新了。
- 历史修复 8 项全部完好（fork/submit/launch in-flight、prepareFinalsAppend、
  recordHasDisagreement、traceStore uid 集合、saveDraft.reset、setSearch 合并）。

### 仍开放（从 Round 4 顺延）

1. **[MEDIUM] headline 指标 informal-run 标记**（dashboard.ts，第三次顺延）。
2. **[LOW] dashboard 把 `detectorAnalysisAvailable` 放进响应 payload**。
3. **[LOW] reviews 队列排序比较器** `undefined` vs `false` 两个方向都返回 1
   （`server/routes/reviews.ts` comparator，Round 1 起）——你们正在编辑这个文件，顺手修。
4. **[LOW] probe 失败结果短 TTL**；probe 指纹的 venv/symlink 盲区。

## Round 4 — 2026-08-07 00:45

### Round 3 响应验证（四个提交逐一核验，全部真正闭环 ✅）

- **3dbba5d probe 缓存** ✅ 内容寻址（全部 scenario rows 规范化 + `src/ace/**/*.py` 递归
  digest + probe 脚本 + rubrics），probe 前后双读指纹相等才算 verified——stale success 在
  结构上不可能；单飞无 interleave 窗口；增长有界。缓存命中约几 ms，可接受。
- **125db7e overlay 恢复** ✅ token 写在 `meta.extra.detectorAnalysisToken` 且指纹刻意不含
  它——不会自失效循环；内容变化必先改指纹，所以 token 匹配即 overlay 准确；重放是同步
  无 Python 的，每次 rescan 至多一次，无 thrash。header 不再说谎。
- **d75e31a 稳定化上限** ✅ analyze 3 次、waitForStableScan 60s，到顶抛真错误不吐旧数据。
- **f15fc2c start READY** ✅ POST /api/ace/runs 现在阻塞到持久 READY 标记（launchToken
  64-hex 认证、行缓冲解析健壮、超时 SIGTERM→250ms SIGKILL、stderr 里 token 已脱敏）；
  失败以带类型的 4xx/5xx 返回。**control TOCTOU 也一并修了，且修在正确的层**：
  ac_express 的 `transition_batch_control` 用 per-run flock + 锁内重读 + cancel 不可逆闩，
  冲突映射为 `control_conflict` → 409。

### 仍开放（优先级排序）

1. **[MEDIUM] headline 指标 formal gate（Round 3 #5，未动）** — `dashboard.ts`
   `passRateExecuted` 和 escalation matrix 仍聚合任何显式选中的 run；响应里没有
   informal 标记（client 只能自己从 `scope.availableRuns[].runKind` 推导）。建议：聚合含
   非 scored run 时响应加 `informalRuns: [...]` 或 `mixedRunKinds: true`，前端标注。
2. **[LOW] dashboard 吞掉稳定化到顶错误** — `routes/ace.ts` dashboard 路由 catch 后返回无
   detector 数据的聚合，`detectorAnalysisAvailable` 算了但没放进响应——消费者无法区分
   "detector 全零" 和 "分析失败"。把这个布尔放进 payload 即可。
3. **[LOW] probe 失败结果不缓存** — venv 持续损坏时每次轮询仍 spawn 一个快速失败的解释器
   （单飞限并发 1）。可以给失败结果一个短 TTL（如 30s）。
4. **[LOW] probe 指纹盲区** — venv/site-packages 变化不失效缓存；symlink 的 .py 不进指纹。
5. **[LOW] 重复 `batch_id` 跨目录**（Round 3 #7）与 reviews 队列排序比较器
   `undefined` 不一致（Round 1 起）仍未动。

### 本轮 Claude 的直接修改

1. `src/pages/AceRunsPage.tsx` — run 下拉与 `onStarted` 的 `setSearch` 改为合并现有
   query params 而非整体替换（原先会丢 `scenarioFile`/`scenarioId`，launcher 因 key 变化
   remount，用户填了一半的表单被清空）。

## Round 3 — 2026-08-06 23:50

### 响应验证（ed00530 + analysisCoordinator，质量好的部分）

- **盲评 secret 生命周期** ✅ 机器本地文件、`wx` first-writer-wins、损坏 fail-closed 不再生
  （别名不会静默轮换）、client 只见 20-hex 截断 HMAC。
- **ground truth 契约** ✅ 只有 trace-bound snapshot 算 authoritative（provenance whitelist +
  scenario-id 相等 + digest 交叉验证）；current-catalog fallback 明确标 `reference` 且盲评模式
  转为 `unavailable`，兑现了 README 的"不静默替换"承诺。
- **校准统计面板盲名 bug** ✅ 在 filter 层修对了（assisted 才带 runId）。
- **analyze 双发** ✅ `analysisCoordinator` 单飞正确（fingerprint 读后同步占位，无 interleave
  窗口；失败不缓存；强制刷新排队）。
- **formalMetrics 隔离** ✅ pass^k/passAt1/formalScheduledEpisodes 的 scored-gate fail-closed
  写得很细（replay lineage、synthetic、mixed-kind 降级 unknown 都覆盖）。
- **run control 校验** ✅ 严格 schema + 状态机合理（幂等 cancel、terminal fail-closed）。

### 新发现（按优先级）

1. **[HIGH] Python scoring probe 仍是每请求 spawn** — `server/ace/taskCatalog.ts`
   `loadAceTaskCatalog` → `loadScoringContract` → spawn python（30s timeout），被
   dashboard/tasks/traces/reviews 每请求调用，无 memo 无单飞；并发轮询=并发解释器。
   缓存所需的失效原语你们都算好了（scenario `fileDigest`、grader/split sha256、
   `catalogDigest`），就差用上：按 digest 键 memoize + in-flight dedup。这是第三轮重复提出。
2. **[HIGH] analysisCoordinator 缓存命中 ≠ overlay 还在 store 里** —
   fingerprint 刻意剥离 detector overlay，但 `replaceSource` 的 dedup 拿富化后的 stored trace
   与 fresh parse 深比较——带 `evaluation`/aceFailures 的 production trace 永不相等，任何
   rescan 都会替换对象并抹掉 overlay；fingerprint 未变 → `load()` 继续返回缓存 summary，
   `X-ACE-Detector-Analysis: available` 却在说谎，dashboard 的 detector 失败计数静默清零。
   修法：缓存命中时校验 overlay 仍已应用，或 `replaceSource` dedup 比较剥离 overlay 后的形态。
3. **[MEDIUM] `analyzeUntilStable` 无上限重试** — `while(true)` 逢 fingerprint 漂移就重跑
   10 分钟 bridge job，连续扫描抖动期间 HTTP 请求悬死、analyze 背靠背永动。加迭代上限+背压；
   `waitForStableScan` 同样无 ceiling。
4. **[MEDIUM] control 授权是 TOCTOU 快照** — `batchesWithTraceUids()` 读清单后才
   `bridge.call('control')`，并发 pause/cancel 都过校验、竞态到 bridge；run 完成后仍可收到
   control。viewer 侧只是 advisory——确认 Python harness 侧有再校验，或加 per-run in-flight 锁。
5. **[MEDIUM] headline 指标无 formal gate** — `passRateExecuted`/escalation matrix 只靠默认
   选择隔离 debug run；显式选中 debug/counterfactual run 会把它的结果混进读起来像 formal 的
   字段且响应里无任何标记。建议响应里带 `informal: true` 或前端标注。另外所有 pass rate 均
   为点估计（`scenarioDenominator` 已暴露，可考虑 server 端加 Wilson 区间）。
6. **[LOW] runCatalog `schema_version` 缺失默认 scored** — 不合规 producer manifest 被当
   formal；queued 且无 trace 的 run 的 `scheduledEpisodes` 计入 formalScheduledEpisodes。
7. **[LOW] 重复 `batch_id` 跨目录** — control 端点 `.find` 撞第一个（按 updatedAt），
   lifecycle 校验可能对着错误的 manifest。
8. **[LOW] detectorAnalysis map 键不一致** — map 用 `summary.meta.traceUid ?? traceId`，
   查找用 `identity.traceUid`；uid 只在 identity 里的 production trace 会 503 且理由误导
   （`coordinator_not_configured`）。fail-closed 无害，但排查体验差。
9. **[LOW] 性能** — `productionAnalysisSourceFingerprint` 每次 `load()`/`statusForTrace`
   把全部 production message canonical-JSON 一遍（缓存命中也 O(corpus) 哈希）；可用
   `store.dataVersion` 做外层 key。`replaceSource` 的 per-file O(store) 扫描全量 rescan 是
   O(n²)。
10. **[LOW] reviews 队列排序比较器仍不一致**（Round 1 遗留）— `hasDisagreement`/`state` 的
    `undefined` vs `false` 两个方向都返回 1，违反比较器契约，分页可重复/跳项。
    （你们正在编辑 reviews.ts，顺手修下 `server/routes/reviews.ts` 的 comparator。）

### 本轮 Claude 的直接修改（786 tests + tsc 全绿验证）

1. `server/reviews/calibration.ts` — `recordHasDisagreement` 不再经过 calibration-only 的
   filter，assisted 记录的人机分歧 flag 终于为真（Round 1 #遗留，+测试）。
2. `src/components/review/ReviewPanel.tsx` — autosave 竞态双保险：timer 回调里检查
   `submitInFlight`，提交成功后 `saveDraft.reset()`，不再出现"提交成功却弹 423/409 红错"。
3. `server/store/traceStore.ts` — `replaceSource` dedup 守卫改为比较 uid 集合而非长度
   （重复行折叠到同一 uid 时旧 uid 可能永不删除）。

## Round 2 — 2026-08-06 23:05

### Round 1 响应验证（codex 已修，确认质量好）

- **#1 Tailscale 暴露** ✅ 干净利落：`server/auth.ts`（HMAC session cookie、timing-safe 比较、httpOnly/sameSite strict）+ `serveTailscale.mjs` 自动生成持久 token（0600 文件、`wx` 防竞写、token 只注入 API 进程环境并从 web 进程环境删除）。`app.ts` 里只有 GET `/api/health` 和 POST `/api/auth/session` 公开，其余全部过 `requireAccessSession`，SSE 也覆盖。
- **#2 dataRoots 校验** ✅ `TRACE_VIEWER_ALLOWED_DATA_PARENTS` allowlist，默认限制在项目根的父目录（覆盖 sibling 项目但不放开整个 home）。
- **#8 SSE snapshot 广播** ✅ 改为按连接 `onGap` 回调，不再进全局 journal。
- **#9 前端全量 invalidate** ✅ `src/api/liveInvalidation.ts`：事件→最小 query 家族映射 + 75ms debounce，方向正确。
- **#14 SSRF redirect** ✅ `redirect:'manual'` + 每跳校验 + MAX_REDIRECTS。
- bridge/probe 子进程环境统一收敛到 `childEnvironment.ts`，好。

### Round 1 尚未处理（请继续）

- **#4/#12 花钱路径 double-submit / 部分失败自锁** — **[已修复 by Claude]** 本轮我直接修了三处：
  `AceRunLauncher.submit` 加同步 in-flight ref（`isPending` 要等 re-render，防不住快速双击）；
  `AceExperimentsPage.launchPair` 同样加 ref，且部分失败后不再自锁——重试只补启动失败的
  variant（成功的 variant 保留其 runId，不会重复花钱）；`ReplayTab.fork` 加 ref +
  `onSettled` 复位。**server 端幂等 key 仍然值得做**（客户端防护挡不住网络重试）。
- **#6 `POST /api/ace/runs` 202 之后的 start 失败仍只有 console.error** — client 侧看到
  `queued` 然后行消失，无处可查。建议：launch 失败写进 run 目录或 lineage
  （`lifecycle:"launch_failed"` + message），`/api/ace/runs` 返回它。
- **#7 每请求 spawn Python scoring probe 仍在** — `loadAceTaskCatalog` 被 dashboard/tasks/
  traces/reviews 每请求调用且无 memo/单飞；dashboard 轮询会堆 Python 进程。建议按
  (pack digests + grader/db source digests) memoize + in-flight dedup；digest 你们已经算了，
  缓存键是现成的。
- Round 1 Minor 列表大部分未动（launchLineageStore 写队列毒化、bridge SIGKILL 升级、
  scenarios 端点单文件容错、kappa undefined 判定、ReviewPanel autosave 竞态、
  AceRunsPage 下拉丢 URL 参数、URL-state / 虚拟化约定漂移等），酌情排期。

### Round 2 新发现

- `server/auth.ts` — minor — session cookie 是 access token 的纯函数（HMAC 无过期戳、无
  server 端会话表），意味着 30 天 maxAge 只是客户端约束，泄露的 cookie 在 token 轮换前
  永久有效。本地工具可接受；若要收紧，HMAC 里加一个到期时间戳即可（无状态可验）。
- `server/reviews/traceSource.ts:363` + `server/routes/reviews.test.ts:90` — **当前 tsc 不过**
  （`groundTruth` 的 `{} | null` 不能赋给 `ReviewGroundTruth | undefined`；test 里 `order`
  字段不在类型上）。看起来是你们正在进行的 ground-truth 类型重构的中间态，提醒别忘了收尾
  ——`npm run check` 目前是红的。
- `biome check` 仍未全绿（taskCatalog unused imports、若干 format）。建议收尾时跑一次
  `biome check --write`。

### 本轮 Claude 的直接修改（已验证 683 tests + 三文件 lint 干净）

1. `src/components/ace/AceRunLauncher.tsx` — submit 同步 in-flight ref。
2. `src/pages/AceExperimentsPage.tsx` — launchPair in-flight ref + 部分失败可重试
   （只补失败侧，成功侧复用 runId）；按钮仅在 A、B 都启动后才锁。
3. `src/components/trace/ReplayTab.tsx` — fork in-flight ref（`onSettled` 复位）。

## Round 1 — 2026-08-06 22:40

### 总体评价

四个子系统（bridge 集成 / review-labeling / 网络暴露+SSE / ACE 前端）整体设计水准很高：
进程契约两侧双重校验（allowlist、regression token、exact-fork 拒绝 override、路径包含检查）、
HMAC 盲评 + append-only finals + 原子 draft 重命名、SSE replay journal + 心跳、
launcher 请求构造函数直接 round-trip 真实 server parser 的契约测试——这些都是亮点。

缺陷集中在三类：**(1) 花真钱的路径缺少幂等/确认/校验**；**(2) Tailscale 暴露让文档声明的
"trusted local machine" 安全模型整体失效**；**(3) 崩溃恢复与异步失败路径不可见**。
建议本轮优先处理下面的 Critical 与 Major。

### Critical

1. **Tailscale 模式把整个无鉴权 API 暴露给 tailnet** — `scripts/serveTailscale.mjs:32` + `vite.config.ts`
   README 声称 "keeps the API private on 127.0.0.1"，但绑定到 Tailscale IP 的 Vite 会把所有
   `/api/*` 代理回 localhost:8787，等于 API 对全 tailnet 开放且无任何 token/auth。
   结合下面两条，任何 tailnet 设备可以：花钱启动 ACE run（costCapUsd 上限 $100,000、最多 1000 seeds）、
   挂载任意目录并通过 `/api/traces/:id/raw` 读文件。
   **最低要求**：API 前加 shared-secret token（或校验 Tailscale identity header），
   并给远程客户端加 spend/mutation kill-switch。README 的 "private" 表述在修复前先改掉。

2. **dataRoots 校验只挡了 `/` 和 `$HOME` 两个精确路径** — `server/store/dataRootManager.ts:50`
   `POST /api/data-roots {"path":"/Users"}`、`/private/etc`、`~/.config` 全都能挂载；
   连接器接受 .json/.jsonl/.txt，配合 raw 端点即可外泄 `~/.config` 下的凭据类 JSON。
   另外 root 内部的 symlink 会被跟出边界（chokidar `followSymlinks:true`，只 realpath 了 root 本身，
   `server/store/scan.ts:661` 附近），且远程添加的 root 持久化到 `.trace-viewer/data-roots.json`
   重启后自动恢复（持久化立足点）。**建议**：前缀 allowlist（或至少黑名单目录树 + realpath 每个文件）、
   symlink 不跟出 root、远程添加需要确认。

3. **reviewStore 撕裂尾部"恢复"会在下次 submit 时真正写坏文件** — `server/reviews/reviewStore.ts:141` + `:288`
   crash 留下无换行的半行 `{"torn`，读取时能容忍；但 `submit()` 直接 append，粘成
   `{"torn{"new":...}\n` —— 此后该行以 `\n` 结尾，恢复分支不再适用，所有 `/api/reviews` 永久 500，
   且新 label 丢失。**[已修复 by Claude]**：append 前检查文件尾字节，非 `\n` 则先补 `\n`。
   （补充：mid-file 单行损坏或单个 corrupt draft 也会 fail-closed 整个队列 API——建议改成
   skip + warning，`runs/labels/` 在 git repo 里，一个 merge conflict marker 就能打挂整个子系统。）

4. **Run launcher 双击可双倍花钱** — `src/components/ace/AceRunLauncher.tsx:330,767`
   只有 `disabled={start.isPending}`，React re-render 之前的第二次点击照样触发第二个
   `start.mutateAsync`；launcher 不传 batchId，server 每次请求都 mint 新 runId
   （`server/ace/requests.ts:161`），没有幂等兜底。**建议**：客户端 in-flight ref 守卫 +
   花钱操作加确认步骤；server 端支持客户端提供的幂等 key。

### Major

5. **bridge stdin EPIPE 会 crash 整个 viewer server** — `server/ace/bridge.ts:147`、`server/ace/taskScoringAuthority.ts:227`
   `child.stdin.end(JSON.stringify(params))` 无 error handler；venv 缺失时 python 在读 stdin 前退出，
   payload 超过 pipe buffer（大 promptText / transcriptPrefix）就是 unhandled 'error' event。
   **[已修复 by Claude]**：给 stdin 挂 `error` no-op handler（错误已由 exit/close 路径上报）。

6. **`POST /api/ace/runs` 返回 202 后的 start 失败完全不可见** — `server/routes/ace.ts:665` + `bridge.ts:167`
   失败只 `console.error`；client 看到 `queued`，之后合成行消失，无处可查。
   **建议**：把 launch 失败写进 lineage/run 状态（如 `lifecycle:"launch_failed"` + error message），
   让 `/api/ace/runs` 能返回它。

7. **每个请求都 spawn 一个 Python scoring probe** — `server/ace/taskCatalog.ts:600` 被
   dashboard/tasks/traces/reviews 多路由每请求调用，30s timeout + 16MiB buffer，无 memo 无并发上限；
   dashboard 轮询会堆积 Python 进程。**建议**：按 pack 文件 mtime/hash memoize + 单飞（in-flight dedup）。

8. **SSE：落后 client 的 `snapshot.required` 广播给所有 client 且进入 replay journal** —
   `server/routes/events.ts:88`。一个 laggy client 反复引发全体 invalidate 风暴。
   **建议**：`snapshot.required` 只发给触发的那个连接，不写 journal。

9. **前端 SSE handler 每个事件 invalidate 几乎全部 query** — `src/api/live.tsx:31`
   （只排除 `trace-raw`），`staleTime: Infinity` 的 `useAceAnalysis` 也被打穿；扫描/高并发 batch
   期间就是 refetch 风暴。**建议**：按事件类型映射到具体 query key + debounce/coalesce。

10. **`useAceRun` 对不存在的 run 以 1Hz 永久轮询** — `src/api/ace.ts:80`
    `refetchInterval` 在 `data === undefined`（含永久 error）时返回 1000。
    **[已修复 by Claude]**：error 状态停止轮询。`AcePairedComparison` 与 Lab 的 LiveRunMonitor
    同样受益；Lab 那个"manifest 未出现"文案的无限等待建议再加 give-up/backoff。

11. **ReplayTab fork 的 costCapUsd 无校验** — `src/components/trace/ReplayTab.tsx:89,224`
    清空输入框 → `Number('') === 0`；非法输入 → `NaN` → JSON `null`。其它 launch 路径都有
    0.01–100000 校验，唯独这条花钱路径没有。**[已修复 by Claude]**：复用与 launcher 一致的
    校验逻辑（含 temperature 的 NaN 防护），非法值禁用提交并显示提示。

12. **Experiments 页部分失败后自锁** — `src/pages/AceExperimentsPage.tsx:202,230`
    `Promise.allSettled` 后只要提交过就 `alreadySubmitted=true`，变体 B 失败无法单独重试；
    换 ID 重跑会把成功的 A 再花一遍钱。**建议**：按变体记录成功/失败，允许只重试失败的变体。

13. **校准统计面板在盲评时查询盲名** — `src/pages/ReviewPage.tsx:94`
    未解锁的 calibration item 的 `selected.runId` 是 `blind_run_…` HMAC 别名，存储记录是
    canonical runId，于是主工作流下面板恒显示 0。**建议**：面板在盲评模式下改用全局（不带 runId）
    统计，或等 reveal 后再按 runId 过滤。

14. **URL import 的 SSRF 防护可被 redirect/DNS-rebinding 绕过** — `server/routes/importRoute.ts:37`
    检查一次 DNS 后 `fetch()` 自行重解析并跟随重定向。localhost-only 时可接受（文档也写了 deferred），
    但 Tailscale 暴露后需要 `redirect:'manual'` + 每跳校验。

### Minor（择要）

- `server/ace/launchLineageStore.ts:88` — 一次磁盘写失败让 `writeQueue` 永久 rejected，后续 append 全挂。链式 `.then` 前先 `.catch` 复位。
- `server/app.ts:48` — error middleware 只透传 4xx，`AceBridgeError` 想要的 502 变成 500；且 500 会把内部错误消息（含绝对路径）回给客户端。
- `server/ace/bridge.ts:78` — `envelope.error.code` 未检查 `error` 是对象，`{"ok":false}` 抛裸 TypeError，丢掉 stderr tail 诊断。
- `server/ace/bridge.ts:114` — 超时 kill 只发 SIGTERM 无 SIGKILL 升级，卡死的 python 占着 runId 最长 24h（`run_already_active`）。
- `server/routes/ace.ts:576` — `/api/ace/scenarios` 一个坏 pack 500 整个端点（对比 aceTasks 的优雅降级）。
- `server/routes/ace.ts:41,869` — `publicBridgeResult` 只 basename `*path`/`parent_checkpoint` 键；regression 响应的 `artifact`/`scenarioPack`/`draft` 键漏网（今天恰好是相对路径才没事）。
- `server/ace/analysisBundle.ts:119` — overlay 合并 `failures` 但整体替换 `flags`，同一证据两个投影不一致。
- `server/reviews/calibration.ts:63` — 任一 marginal 为 0 就报 `undefined_single_class`，但 Cohen's kappa 仅在 pe=1 时才真正未定义（如 judge 全 pass、human 5/5 时 κ=0 是有定义的）；line 70 的 guard 是死代码。
- `server/reviews/traceSource.ts:266` — 非 ACE trace 无 corpusId 时默认 `'production'`，普通 corpus 的 label 会写进 ACE 的 `runs/labels/`。
- `src/components/review/ReviewPanel.tsx:224` — submit 时不取消 800ms autosave timer，autosave 后到会在成功提交后显示假的 423/409 红错。
- `server/routes/events.ts:51` — `res.write` 返回值忽略，慢消费者无背压、无 per-client 上限；`eventsRoutes()` 的 store 订阅永不 dispose（多 app 共享 store 的测试会泄漏）。
- `scripts/serveTailscale.mjs:11` — 硬编码 `/usr/local/bin/tailscale`，新 mac 常在别处，直接 throw。
- `src/pages/AceRunsPage.tsx:186` — run 下拉 `setSearch({run})` 整体替换 query string，丢掉 scenarioFile/scenarioId，launcher 因 key 变化 remount，用户填的长 prompt 被清空。
- URL-state 约定漂移：AceRunsPage 的 episode 过滤、AceAnalysisPage 的 runSearch、Experiments 表单都是 useState 不进 URL（本 codebase 的分享机制是 URL round-trip）。
- 虚拟化约定漂移：AceRunsPage 三个表格（activity/durable/triage）与 ReplayTab 的 per-message `<option>` 列表未虚拟化，万级 episode/message 会卡。
- lint：`server/ace/taskCatalog.ts`（unused imports）、`taskScoringAuthority.ts:96`（optional chain）、`server/routes/traces.ts`、`AceDashboard.tsx`、`AceRunsPage.tsx`（format）— `biome check` 未全绿。

### 测试缺口（建议补）

- 花钱路径零交互测试：double-submit、部分失败重试、轮询停止条件（页面测试全是 `renderToStaticMarkup` + `toContain`，点不了按钮）。
- reviewStore 崩溃恢复：torn tail、corrupt mid-file 行、corrupt draft、HTTP 层 409/423。
- `classifyAcePair`/`pairAceRuns`/`pairedPassInterval`（CI 统计核心）无测试；EvaluationTab/StateToolsTab 无测试。
