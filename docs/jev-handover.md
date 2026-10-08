# Handover：Jev 决策模型在 Craft Agents 里的接入

> 对应上游 **v0.14.0 引入 / v0.14.1 打磨**，本仓库基线 v0.14.1（2026-10-08 整理）。
> 题型（`choice` / `score` / `noul`）怎么写另见 `docs/jev-decide.md`，本文只讲**接入、能力、使用**。

## 一句话

Jev 是 TypeSafe AI 的 **System One** 模型：输入文本或 JSON，**并行**输出带校准概率的类型化判断，约 0.25 秒，**不产出文字**。Craft 把它当成一个**零权限的决策层**——答案只能增加摩擦或信息，**永远不能移除一次询问**。

---

## 一、接入方式

### 配置与落盘

| 项 | 位置 |
|---|---|
| 设置界面 | Settings → AI → Decision model（`renderer/pages/settings/AiSettingsPage.tsx`） |
| 设置落盘 | `StoredConfig.decisionLayer`（`packages/shared/src/config/storage.ts:94`），读写走 `getDecisionLayerSettings` / `setDecisionLayerSettings` |
| **API key** | **不在配置里**——走凭据库：`getCredentialManager().setDecisionApiKey(provider, key)`，按 provider 分别存（`~/.craft-agent/credentials.enc`） |
| 总开关 | `enabled`，**没有环境变量旁路**。关 = 行为与没有这一层完全一致 |
| 调用日志 | `~/.craft-agent/logs/decisions.jsonl`：记问题、概率、**state 的哈希**，不记 state 原文 |

### 五个 provider

`packages/shared/src/decisions/providers.ts`：

| id | 标签 | baseUrl | 默认模型 | 要 key |
|---|---|---|---|---|
| `typesafe` | TypeSafe AI (direct) | `https://api.typesafe.ai` | `jev-1.13.0` | **是** |
| `openrouter` | OpenRouter | `https://openrouter.ai/api` | `typesafe/jev-1.13` | 是（可复用已有连接） |
| `vercel-ai-gateway` | Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | 是（可复用已有连接） |
| `laya` | Laya (local, open source) | `http://127.0.0.1:8000` | `auto` | 否 |
| `custom` | Custom (Jev-compatible server) | 自填 | `jev-1.13.0` | 否 |

**默认 provider 就是 `typesafe`**（`DEFAULT_DECISION_LAYER_SETTINGS.provider`）。

⚠️ **`typesafe` direct 的 `reusableConnectionProviders` 是空数组**——不能复用已有 LLM 连接的 key，必须单独填。只有 OpenRouter / Vercel 两个预设支持复用。

**Laya（本地）的两个专有限制**，写在 preset 注释里：
- `laya-serve` 把未知模型 id 交给它的 router（`auto`）：英文走英文 checkpoint，其余走多语言；`english` / `multilingual` / `typed-decisions` 可钉死某个 checkpoint，实际服务的 checkpoint 每次调用都记录
- **`maxStateBytes: 48 KB`**——`laya-serve` 超过 50,000 字符直接 413。托管 provider 的上限是约 96 KB
- 装法：`pip install "laya[serve]" && laya-serve`，健康检查 `/health`

### IPC 通道（8 条）

`packages/shared/src/protocol/channels.ts:345`：

```
decisions:getSettings   decisions:setSettings
decisions:getStatus     decisions:getUsage
decisions:setApiKey     decisions:deleteApiKey
decisions:test          decisions:probeServer
```

handler 在 `packages/server-core/src/handlers/rpc/decisions.ts`。
⚠️ 这 8 条都在 `apps/electron/src/shared/__tests__/ipc-channels.test.ts` 的快照里——**加通道必须同步更新那个数组**（`EXPECTED_COUNT` 由长度派生）。v0.14.1 上游自己漏了 `decisions:getUsage`，我们补的（提交 `05831ebe`）。

### 代码分布

```
packages/shared/src/decisions/
  types.ts       题型与答案的类型定义；超时常量（默认 1500ms，范围 250–60000）
  settings.ts    13 个功能开关 + 默认值 + normalize
  providers.ts   5 个 provider 预设
  status.ts      连通状态、可复用连接、测试结果
  usage.ts       解析 decisions.jsonl，按功能汇总 calls/failures/changed
  records.ts     日志记录结构

packages/server-core/src/decisions/     ← 15 个决策点，一个功能一个文件
  guarded-mode.ts  permission-risks.ts  adaptive-thinking.ts  mid-turn-messages.ts
  smart-titles.ts  suggestions.ts       turn-outcome.ts       large-results.ts
  relevance.ts     semantic-labels.ts   automation-condition.ts
  task-verdict.ts  task-repairs.ts      decision-point.ts     tool-callbacks.ts

packages/shared/src/agent/core/guarded-mode.ts   ← 权限闸门的判定逻辑
  调用点：claude-agent.ts:1439、pi-agent.ts:1363

packages/session-tools-core/src/handlers/decide.ts   ← agent 的 decide 工具
```

---

## 二、能力

### 13 个功能开关，默认只开 3 个

`settings.ts:122`。上游的理由写在那行上面：**前三项「只在被调用时才动」**（agent 主动调工具 / 出现无法解析的 verdict / 你确实写了语义规则），**后十项会自行改变 app 行为**，所以默认关。

| 开关 | 默认 | 做什么 |
|---|---|---|
| `decideTool` | **开** | agent 的 `decide` 工具（分类 / 路由 / 打分，一次最多 200 项） |
| `taskVerdicts` | **开** | 编排器文本里没有可解析的 `VERDICT:` 时，用模型读出结论 |
| `semanticLabels` | **开** | 标签自动规则可以写成一句问话而非正则 |
| `turnOutcome` | 关 | 回合是「收尾 / 等你 / 卡住」→ 决定是否标 Needs Review、任务节点是否算完成 |
| `guardedMode` | 关 | 提供 Guarded 权限模式（见下） |
| `riskBadges` | 关 | 权限弹窗上的风险徽标（纯信息） |
| `automationConditions` | 关 | 自动化的 `semanticCondition`：条件不达阈值就跳过该次运行 |
| `taskRepairs` | 关 | FAIL verdict 没点名子任务时，只修它的理由牵连到的那几个 |
| `smartTitles` | 关 | 跳过寒暄不起标题；自动标题过时了刷新 |
| `adaptiveThinking` | 关 | 简单回合降思考档（**永不超过**会话设定） |
| `midTurnMessages` | 关 | 中途消息：纠正 → steer 进去；另一件事 → 排队；拆成两条发的合并 |
| `largeResults` | 关 | 大工具结果挑出 agent 真正要的几段，跳过整体摘要 |
| `suggestions` | 关 | 指出消息明显需要的 skill 或未启用的数据源（**不替你开**） |

`decideTool` 的闸门贯穿到系统提示词：`isDecisionFeatureActive('decideTool')` 同时决定工具是否挂载（`session-scoped-tools.ts:269`、`pi/session-tool-defs.ts:26`）和提示词里是否介绍它（`prompts/system.ts:636`）。

### Guarded 模式的保护机制（三道）

这是整个接入里最该理解的部分，因为它决定了最坏能坏到哪。

**① 零权限，由控制流保证。** `needsGuardedModeCheck`（`agent/core/guarded-mode.ts:156`）只在常规权限检查**已经返回 `allow` / `modify`** 时才触发：

```ts
if (!check || (result.type !== 'allow' && result.type !== 'modify') || !isGuardableTool(ctx.toolName)) return false;
if (getPermissionModeDiagnostics(ctx.sessionId).permissionMode !== 'guarded') return false;
```

→ 模型**只被问到「按老规矩本来就会放过的调用」**。它能把 allow 变成一次询问，反过来做不到。`settings.ts` 的注释原话："an answer can add friction or information, never remove a prompt."

**② 只有四类工具会被送审**（`guarded-mode.ts:138`）：

```ts
toolName === 'Bash' || FILE_WRITE_TOOLS.has(toolName)
  || toolName.startsWith('mcp__') || toolName.startsWith('api_')
```

其余工具根本不进这条路。**Execute 模式整条路都不走**，永不咨询决策模型。

**③ 有一条不问模型的确定性路径**（`guarded-mode.ts:188`）：

```ts
if (call.alwaysAsk) { risks = [call.alwaysAsk] }        // 直接定风险，零模型调用
else { const verdict = await check.check(call, ...) }   // 才问模型
```

工作目录外的写入、会话 plans/data 目录外的写入走上面那条，直接问你。

**失败时的行为**：检查跑不动 → Guarded 会话退化成 **Ask to Edit**。
⚠️ v0.14.1 修的正是这里的一个 bug：此前**模型超时或失败时 Guarded 调用会不经检查直接跑**（等于 Execute）。现在会问你，且提示里说明「这次调用没能被检查」。

---

## 三、使用方法

### 1. 接 key

Settings → AI → Decision model → 选 provider → 填 key。TypeSafe direct **不能复用已有连接**，得单独填。填完用 `decisions:test` / `decisions:probeServer`（界面上的测试按钮）验连通。

### 2. 按顺序开功能，不要一次全开

**先开 `riskBadges`。** 纯信息、不改任何行为——标错了最多是标签不准，正好让你零风险观察它判断得准不准。

**再开 `adaptiveThinking`。** 只会**往下**降档、永不超过你设的上限，省钱且有体感。v0.14.1 起它还会读上一条回复的结尾和附件文件名（**不读内容**）；你在反驳上一条时保持原档；要做难撤销的事至少 High。

**`guardedMode` 单独试，并有预期。** 价值是「像 Execute 一样顺、危险的会拦」；代价是每个 Bash / MCP 写 / 非 GET API 调用多一次约 0.25 秒往返。Bash 密集的任务会有体感。

**`midTurnMessages` 最后开。** 判错的后果是消息进错队列，而这条路径上游在 v0.13.4 和 v0.13.6 刚各修过一次 bug。

### 3. 用 7 日统计盘做保留决策（v0.14.1 新增）

Advanced settings 里每个开关下面显示**过去 7 天的 checks / changes / failures**（`usage.ts:182` 的 `DecisionToggleUsage`，数据来自解析 `decisions.jsonl`），**跑了 30 次检查什么都没改会明说**。

> 这是判断每一项值不值得留着的正确仪器——比凭感觉强。开了一周没改变过任何事情的功能，关掉。

### 4. 超时旋钮

默认 **1500ms**，范围 250–60000（`types.ts:228`）。调太紧 → Guarded 里「没能检查」的询问变多。
v0.14.1 另外把「空闲 30 秒后的第一次检查」放宽到 **2800ms**——冷启动时失败率曾高到 6–12%（常态约 1%）。

### 5. 读答案的三条红线

1. **`confidence < 0.5` 不要据此行动**（原话 "Do not act on a coin flip"）。`noul` 没有 confidence，看那个概率离 0.5 有多远
2. **类别不穷尽时一定要加 `other` / `unclear`**，否则模型被迫从错的里面挑一个
3. **「答案永远不是许可」**（`"An answer is never permission."`）——行动前另行核对。**选择和授权是两件事**

### 6. 隐私边界

- 托管 provider：`state` 会发出去。**别放密钥、凭据，或本不该离开本机的文件内容**
- 想完全不出本机：用 `laya` provider。Laya 是 Apache 2.0 开源权重（约 4.21 亿参数，ModernBERT-large 骨干），但**英文 checkpoint 只读约 512 token 的 state**，本地跑必须把 state 写短
- 日志只存 state 的哈希，不存原文

---

## 四、效果预期（外部证据，2026-10 时点）

**别指望它更准——它换的是速度和成本。**

- 中位 0.35 秒/段 vs Fable 的 8.83 秒；输入价约为 Claude Fable 5.1 的 1/238（约 $0.04/百万，**输出免费**）
- **但按 TypeSafe 自己工作流看板的数字：Jev 综合准确率 67.8%，最佳对照 74.1%**
- 真实试点在窄而高频的任务上很好（某消费品牌 284 个会话：分流准确率 93%、垃圾全抓、零误报）
- `"can't hallucinate"` 的宣传言过其实：**不可能吐出非法类型，但完全可以吐出一个合法而彻底错误的值**；分布外行为与 LLM 不同
- ⚠️ [arXiv 2609.26758](https://arxiv.org/abs/2609.26758)：受约束的决策头**跟的是选项名、不是绑在上面的 rubric**。只改选项名（`0/1` → `no/yes`）、rubric 不动 → AUC 从 .94 掉到 .23，而 `type-error rate` 全程 **0%**，schema 合规把判断失效完全盖住。写 `choice` 时务必让**选项名和 rubric 语义一致**（`score` 的数组式 criteria 天然避开此坑）

**Craft 这个集成本身没有第三方评测**，只有上游 release notes。唯一研究「System One 当 agent 动作闸门」这一形态的论文（[arXiv 2609.28940](https://arxiv.org/abs/2609.28940)）是 n=1 探索性案例，作者自声明不足以建立统计显著性。

---

## 五、维护注意

| 事项 | 说明 |
|---|---|
| 加 IPC 通道 | 必须同步 `ipc-channels.test.ts` 的快照数组，否则测试红且分不清是谁的锅 |
| 决策点新增 | 一个功能一个文件放 `server-core/src/decisions/`，开关加进 `settings.ts` 的 `DecisionLayerFeatureToggles` + `DECISION_LAYER_FEATURES` 数组 + `usage.ts` 的 `DECISION_RECORD_TAGS` |
| 新功能默认值 | 「会自行改变 app 行为」的一律默认 **关**——这是上游定的调性，别破 |
| 零权限不变量 | 任何新决策点都不能让答案**移除**一次询问。Guarded 的做法是只在 `allow`/`modify` 之后介入，照抄这个形状 |
| 本地 Laya | state 上限 48 KB（preset 的 `maxStateBytes`），比托管的 96 KB 小一半，分支逻辑别漏 |

---

[PROTOCOL]: 事实取自 `packages/shared/src/decisions/`、`packages/server-core/src/decisions/`、`packages/shared/src/agent/core/guarded-mode.ts`、`packages/server-core/src/handlers/rpc/decisions.ts` 与 `apps/electron/resources/docs/decisions.md`（@ v0.14.1）。上游改动这些处时回来核对，并同步根 CLAUDE.md 的基线条目。
