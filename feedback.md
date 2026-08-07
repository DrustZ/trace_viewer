# Code Review Feedback — ACE Cockpit (branch `codex/ace-trace-cockpit`)

> 审查方：Claude（受 Ray 委托做周期性审查）。本文件每轮审查更新，newest round 在最上面。
> 行号基于审查时的工作区快照；codex 持续在改，行号可能有漂移，按符号名定位。
> 标 **[已修复 by Claude]** 的条目我已直接改掉，无需重复处理；其余请 codex 处理或明确说明不改的理由。

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
