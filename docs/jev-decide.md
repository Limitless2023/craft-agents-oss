# Jev / `decide` — 决策模型题型速查

Jev 是 TypeSafe AI 的 **System One** 模型，非自回归：输入一段文本或 JSON，**并行**输出带校准概率的类型化判断。它**不能产出文字**——要文字就用 `call_llm`。

Craft 里的入口是 Settings → AI → Decision model，以及 agent 的 `decide` 工具。

**判断该不该用它的那一句话**：答案是**一个固定选项、一个档位、或是否**→ 用 `decide`；答案是**词句**→ 用 `call_llm`。

---

## 三种题型

口诀用上游自己的话：**「挑一个 / 打个分 / 是不是」**。

| 类型 | 中文 | `criteria` 结构 | 数量限制 | 返回 |
|---|---|---|---|---|
| `choice` | **单选题** | **字典**：选项名 → 一句说明 | 2–255 | 最可能的那个 + 全部概率 + `confidence` |
| `score` | **量表题** | **数组**：档位说明，**低档在前** | 2–10 | **期望档位**（小数）+ 各档概率 + `confidence` |
| `noul` | **是非题** | 可省略，最多 `{true, false}` 两句 | — | **一个数**：「是」的概率（无 `confidence`） |

**最可靠的区分法是看数据结构，不是记英文词义**（`packages/shared/src/decisions/types.ts`）：

```ts
ChoiceQuestion  criteria: Record<string, …>   // 字典 → 选项无序，所以得起名字
ScoreQuestion   criteria: Array<string | …>   // 数组 → 档位有序，下标即等级
NoulQuestion    criteria?: { true?, false? }  // 可省略 → 只有两种结果
```

### `noul` 这个怪名字

**= Ber‑noul‑li。** 伯努利分布就是「一次只有两种结果的试验」。

这也解释了它为什么**没有 `confidence` 字段**：那一个概率本身就是确信度——**0.5 最不确定，两端最确定**。代码注释原文：`"Two outcomes, so this describes the distribution completely."`

---

## `score` 深入（最容易用错的一个）

### 返回值是「期望档位」，不是 0–1

```ts
/** Expected level: Σ(level index × probability), 0..(levels-1). */
score: number;
```

**范围是 `0 … 档数−1`，不是 0 到 1。** 四档就是 0–3。

官方例子验算（三档）：

```json
criteria:      ["平静，只是陈述事实", "不爽但还客气", "很愤怒或威胁要走"]
probabilities: { "0": 0.72, "1": 0.25, "2": 0.03 }
score:         0.31      ← 0×0.72 + 1×0.25 + 2×0.03
confidence:    0.62
```

### 例 A：上游自己在用的（最可信的范本）

`packages/server-core/src/decisions/adaptive-thinking.ts` —— 判断下一轮回复需要多少推理，然后据此给思考档位设上限：

```ts
demand: {
  type: 'score',
  instructions: 'How much reasoning does the assistant need for its next reply? ...',
  criteria: [
    'A greeting, a thank-you, or a simple factual question with a short answer',
    'A routine request with clear instructions: a small edit, a lookup, a short summary',
    'A substantial task: multi-step work, non-trivial code, or careful analysis',
    'A hard problem: complex reasoning, debugging, architecture, or ambiguous requirements',
  ],
}
```

消费方式——**四舍五入回整数档，再查表**：

```ts
const CAP_BY_LEVEL = ['low', 'medium', 'high', null]   // null = 保持会话原设置
let cap = CAP_BY_LEVEL[Math.min(3, Math.max(0, Math.round(demand.score)))]
```

注意它还配了两个 `noul` 做**否决和抬底**：`corrects_previous`（用户在反驳上一条 → 保持原档）、`consequential`（要做难撤销的事 → 至少 high）。

> **这就是最常见的组合范式：`score` 定档位，`noul` 做开关和兜底。**

### 例 B：`score` 会骗你的那个情形（双峰）

**期望值不是众数。** 假设三档拿到：

```json
probabilities: { "0": 0.50, "1": 0.00, "2": 0.50 }
score: 1.0
```

`score = 1.0` 读起来是「中档」，**但模型认为中档的概率是 0**。期望值正好落在它最不信的那一档上。

所以：**`score` 只在概率集中时才可信**。这正是 `confidence` 存在的理由——它衡量概率有多集中。上游的硬规则是 **`confidence < 0.5` 就别动**（"Do not act on a coin flip"）：

```ts
if (demand.confidence < ADAPTIVE_THINKING_MIN_CONFIDENCE) return { keep: 'low_confidence' }
```

拿不准时要么看 `probabilities` 原始分布，要么回退到 `call_llm`。

### 例 C：同一个判断，三种题型各写一遍

判断「这个 bug 有多严重」：

```json
// choice —— 拿到「是哪一类」，但丢掉顺序
{ "type": "choice", "criteria": {
    "blocker": "核心流程不可用或有数据损坏风险",
    "major":   "影响部分用户，无法绕开",
    "minor":   "有 workaround",
    "trivial": "文案、对齐这类表面问题" } }

// score —— 拿到连续分值，可排序、可设阈值
{ "type": "score", "criteria": [
    "表面问题：文案、对齐",
    "有 workaround 的小问题",
    "影响部分用户且无法绕开",
    "核心流程不可用或有数据损坏风险" ] }

// noul —— 最省，但只有一个切点
{ "type": "noul", "instructions": "这个 bug 是否应该阻塞发版？" }
```

怎么选：

| 你要做的事 | 用 |
|---|---|
| 把一堆东西**排序**，或「取最严重的 5 个」 | `score`（小数本身就是排序键） |
| 设一个**阈值**（`score >= 2.5` 就升级） | `score` |
| **路由**到某个具体分支（转给哪个组、放进哪个文件夹） | `choice` |
| 只有**一个是非切点** | `noul`（最便宜，没有 confidence 要操心） |

`choice` 做第二个会丢信息：模型不知道 `major` 比 `minor` 更靠近 `blocker`，你也拿不到能比大小的量。

### 例 D：最常见的写法错误——用形容词当档位

上游文档明确警告：**"Describe levels as situations, not adjectives."**

```json
// ❌ 形容词：模型和你没有共同刻度，「中」到底是什么？
criteria: ["低", "中", "高"]

// ✅ 情境：每一档都是可判定的事实
criteria: ["有 workaround", "影响部分用户且无法绕开", "核心流程不可用"]
```

形容词是**刻度的名字**，情境是**可核对的判据**。后者还让 `legend` 字段（档位下标 → 你发过去的那段说明）真正有用。

### 顺带一个好消息：`score` 天生避开了「选项名偏置」

[arXiv 2609.26758](https://arxiv.org/abs/2609.26758) 发现受约束的决策头**跟的是选项名，不是绑在上面的 rubric**：把选项名从 `0`/`1` 改成 `no`/`yes`、rubric 一字不动，每 100 个判断多出约 70 次翻转，AUC 从 .94 掉到 .23（**系统性反转**）；而全程 `type-error rate` 是 0%，schema 合规把判断失效完全盖住了。对照组把名字换成随机字符串，效应消失、准确率不降 → 是**名字的语义倾向**在作祟。

**`score` 的 `criteria` 是数组，标签就是下标 `0/1/2`——正好是那篇论文里表现最好的中性标签形态。** 有命名风险的是 `choice`（和 `noul` 的 `true`/`false` 键）。

规则：**要避免的是「选项名的字面倾向」和「你写的 rubric」互相矛盾**。要么让名字和 rubric 一致，要么用中性名把语义全交给 rubric。

---

## `choice` 要点

- 2–255 个选项；说明可以写 `null`，表示「键名自己说清楚了」
- **类别不穷尽时一定要加 `other` / `unclear`**，否则模型被迫从错的里面挑一个
- 返回的 `choice` 是**最可能**的那个，`probabilities` 之和为 1

## `noul` 要点

- 阈值按**代价**定，不是一律 0.5：
  - 是和否的行动代价相当 → `0.5`
  - **误判为「是」很贵** → `0.8` 以上
  - 真的要紧时，把 `0.2–0.8` 当作「交给人」
- `criteria: { "true": "...", "false": "..." }` 可以把问题问得更锐
- ⚠️ 键名就叫 `true`/`false`，**天生带语义**。实践上：把 `instructions` 写成一个自然语言是非句，让它的「是」**正好等于**你想要的 `true`——别写出「回答是＝其实是否定情况」这种拧着的问法

---

## 共同约束

| 项 | 值 |
|---|---|
| `state` | 文本或 JSON，约 **96 KB / 32k token** 截断；**不支持图片** |
| 每次调用的问题数 | 最多 **20** 个，题型可混用 |
| 批量 `items` | 最多 **200** 条，结果保持输入顺序，每批并发 8 条；失败项带 `error` 字段而非 `answers`，其余照常可用 |
| 延迟 | 约 **0.1–0.5 秒** |
| 成本 | 按输入 token 计（TypeSafe/OpenRouter 约 **$0.04/百万**），**输出免费** |
| 语言 | `instructions` 用**英文**效果最好（`state` 本身不限） |
| 本地 Laya | 英文 checkpoint 只读约 **512 token** 的 state —— 本地跑**务必把 state 写短** |

**`instructions` 可以是一句话，也可以是小对象**，例如 `{ "question": "...", "focus": "..." }`。

### 两条不能忘的红线

1. **`confidence < 0.5` 不要据此行动。**（`noul` 看那个概率离 0.5 有多远）
2. **「答案永远不是许可」**——上游原文 `"An answer is never permission."` 行动前要另行核对（选中的文件夹真的存在吗、这条真的是模型以为的那个吗）。**选择和授权是两件事。**

---

## 效果与批评（外部，2026-10 时点）

- **快和便宜是真的**：中位 0.35 秒/段 vs Fable 的 8.83 秒，成本约 1/580；输入价约为 Claude Fable 5.1 的 1/238
- **但按 TypeSafe 自己的工作流看板，Jev 综合准确率 67.8%，最佳对照是 74.1%** —— 换来的是速度和成本，**不是更准**
- 有真实试点给出过很好的数字（某消费品牌 284 个会话：分流准确率 93%、垃圾全抓、零误报），说明**窄而高频的判断**是它的主场
- `"can't hallucinate"` 的宣传**言过其实**：它不可能吐出非法类型，但**完全可以吐出一个合法而彻底错误的值**；分布外行为与 LLM 不同
- Theo Browne 的反应是一句 "Please don't do this"——担心人们在「通用模型的推理本来才是关键」的地方塞一个分类器

**Craft 这个集成本身目前没有任何第三方评测**（只有上游 release notes）。唯一研究「System One 当 agent 动作闸门」这一形态的论文（[arXiv 2609.28940](https://arxiv.org/abs/2609.28940)）是 n=1 探索性案例，作者自己声明不足以建立统计显著性。

---

## 在 Craft 里的接法

- Provider 默认就是 `typesafe`（`DEFAULT_DECISION_LAYER_SETTINGS.provider`），模型 `jev-1.13.0`，baseUrl `https://api.typesafe.ai`
- **TypeSafe direct 不能复用已有连接的 key**（`reusableConnectionProviders: []`），只有 OpenRouter / Vercel AI Gateway 两个预设支持复用
- 超时默认 **1500ms**（可调 250–60000）。调太紧的话，Guarded 模式里「没能检查」的询问会变多
- 开总开关后**不是 13 项全开**：默认只开 `decideTool` / `taskVerdicts` / `semanticLabels`（这三项「只在被调用时才动」），其余 10 项会自行改变 app 行为，需逐项手动开
- 每次调用记在 `~/.craft-agent/logs/decisions.jsonl`：记问题、概率和 state 的**哈希**，不记 state 原文
- 本地想完全不出机器：Laya 是 Apache 2.0 开源权重（约 4.21 亿参数，ModernBERT-large 骨干），[`ollaya`](https://github.com/ollaya-dev/ollaya) 用 TypeSafe 兼容的 `/v1/systemone` 协议起本地服务，改一个环境变量即可切换

### 隐私

别把密钥、凭据，或本不该离开本机的文件内容放进 `state`。走托管 provider 时这些内容会发出去。

---

[PROTOCOL]: 本文事实取自 `packages/shared/src/decisions/types.ts`、`packages/server-core/src/decisions/*.ts` 与 `apps/electron/resources/docs/decisions.md`；上游改动这些文件时回来核对。
