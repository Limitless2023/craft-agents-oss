# Brief：做一版「Jev 决策题型」交互页

> 给 Craft Agents 的任务书。模型用 **Opus 5.5**。
> 这是「再做一版」——已有一版参考实现（见文末），**不要照抄，请给出你自己的解法**。

## 任务

做一个**交互页面**，讲清 Jev（TypeSafe AI 的 System One 模型）`decide` 工具的三种题型，重点是让 `score` 那个反直觉的坑变得一眼就懂。

目标读者：**已经接好 key、马上要动手写 `decide` 问题的人**。不是科普，不要从「什么是 AI」讲起。

### 唯一的必达目标

让读者亲手体会到这件事：

> **`score` 返回的是「期望档位」= Σ(档位下标 × 概率)，而期望值不是众数——概率双峰时，它会落在模型最不信的那一档上。**

三档拿到 `{0: .50, 1: .00, 2: .50}` 时 `score` 正好是 `1.00`，读起来是「中档」，而模型给中档的概率是 **0**。

**这一点用文字讲很费劲，用能拨的控件讲一秒就懂。** 页面的核心应该是一个可操作的东西，而不是一段说明。怎么做是你的选择。

## 输出形态

**首选做成本仓库的 `viz` 组件**，这样它在对话里就是活的：

1. 写 HTML 到 `<cwd>/.craft/visualizations/jev-decide.html`
2. 回答里输出 ` ```viz ` 围栏，围栏体 = 那个文件的绝对路径（一行）

技能已装在 `~/.agents/skills/visualize/`，按它的 `SKILL.md` 写。两条硬约束记住：

- **全部内联，不许任何 CDN / 外部网络源**（CSP 不放任何网络源，连 CDN 白名单都删掉了）
- iframe 是 `sandbox="allow-scripts"`，**没有** `allow-same-origin`
- 主题跟随宿主：用宿主注入的 CSS 变量，别写死颜色。注意 Craft 的品牌色变量叫 `--accent`（没有 `--primary`）

做完可以在 Preview 面板或全屏 overlay 里打开检查；也可以用头部的 Download 导出独立 HTML。

## 事实依据（都已核实，可直接用，不要再猜）

来源：`packages/shared/src/decisions/types.ts`、`packages/server-core/src/decisions/*.ts`、`apps/electron/resources/docs/decisions.md`（本仓库 @ v0.14.1）。**有疑问就去读这三处，别编。**

### 三种题型

| 类型 | 中文 | `criteria` 结构 | 数量 | 返回 |
|---|---|---|---|---|
| `choice` | 单选题 | **字典**：选项名 → 一句说明（可为 `null`） | 2–255 | 最可能的那个 + 全部概率 + `confidence` |
| `score` | 量表题 | **数组**：档位说明，**低档在前** | 2–10 | **期望档位**（小数）+ 各档概率 + `confidence` |
| `noul` | 是非题 | 可省略，最多 `{true, false}` | — | 一个数：「是」的概率（**无 `confidence`**） |

口诀（上游原话）：**挑一个 / 打个分 / 是不是**。

**最可靠的区分法是看数据结构**，不是记英文词义：

```ts
ChoiceQuestion  criteria: Record<string, …>   // 字典 → 选项无序，所以得起名字
ScoreQuestion   criteria: Array<string | …>   // 数组 → 档位有序，下标即等级
NoulQuestion    criteria?: { true?, false? }  // 可省略 → 只有两种结果
```

### `noul` 的词源

**= Ber-noul-li。** 伯努利分布 = 一次只有两种结果的试验。这也解释了它为什么没有 `confidence`：那一个概率本身就是确信度，**0.5 最不确定，两端最确定**。代码注释原话：`"Two outcomes, so this describes the distribution completely."`

### `score` 的确切语义

类型定义里的注释，照抄：

```ts
/** Expected level: Σ(level index × probability), 0..(levels-1). */
score: number;
```

**范围是 `0 … 档数−1`，不是 0–1。** 官方三档例子验算：

```
criteria       ["平静，只陈述事实", "不爽但还客气", "很愤怒或威胁要走"]
probabilities  { "0": 0.72, "1": 0.25, "2": 0.03 }
score          0.31   ← 0×0.72 + 1×0.25 + 2×0.03
confidence     0.62
```

### 上游自己在用的范本（最可信的参考）

`packages/server-core/src/decisions/adaptive-thinking.ts`：

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

消费方式——**四舍五入回整数档再查表**：

```ts
const CAP_BY_LEVEL = ['low', 'medium', 'high', null]   // null = 保持会话原设置
let cap = CAP_BY_LEVEL[Math.min(3, Math.max(0, Math.round(demand.score)))]
```

它另配两个 `noul` 做否决与抬底（`corrects_previous` → 保持原档；`consequential` → 至少 high）。
**这就是最常用的范式：`score` 定档位，`noul` 做开关和兜底。**

### 选型判据

唯一判据：**选项之间有没有顺序。**

- 要**排序**或「取最严重的 5 个」→ `score`（小数就是排序键）
- 要设**阈值**（`score >= 2.5` 升级）→ `score`
- 要**路由**到具体分支（转哪个组、放哪个文件夹）→ `choice`
- 只有**一个是非切点** → `noul`（最便宜，没有 confidence 要操心）

用 `choice` 做严重度分级会丢信息：模型不知道 `major` 比 `minor` 更靠近 `blocker`。

### 写 `score` 的两条规矩

1. **档位写情境，不写形容词。** 上游原话 "Describe levels as situations, not adjectives."
   - ✕ `["低", "中", "高"]` —— 刻度的名字，你和模型没有共同标准
   - ✓ `["有 workaround", "影响部分用户且无法绕开", "核心流程不可用"]` —— 可核对的事实
2. **低档在前**（`lowest first`）。顺序反了语义全反，而且**不报任何错**。

### 「选项名偏置」——值得讲，因为它反直觉

[arXiv 2609.26758](https://arxiv.org/abs/2609.26758) 发现受约束的决策头**跟的是选项名，不是绑在上面的 rubric**：

- 只把选项名从 `0/1` 改成 `no/yes`、rubric 一字不动 → 每 100 个判断多出约 **70 次翻转**，AUC 从 **.94 掉到 .23**（**系统性反转**，不是变随机）
- 全程 `type-error rate` 是 **0%** —— schema 合规把判断失效完全盖住了
- 对照组把名字换成随机字符串 → 效应消失、准确率不降，证明是**名字的语义倾向**在作祟

推论（值得在页面里点出来）：**`score` 的 criteria 是数组、标签就是下标 `0/1/2`，正好是论文里表现最好的中性标签形态——它天生避开了这个偏置。** 有命名风险的是 `choice`，以及 `noul` 那对天生带语义的 `true`/`false` 键。

规则：**要避免的是「选项名的字面倾向」和「你写的 rubric」互相矛盾。** 要么让名字和 rubric 一致，要么用中性名把语义全交给 rubric。

### 阈值与红线

`noul` 阈值**按代价定**，不是一律 0.5：

| 情形 | 阈值 |
|---|---|
| 是和否的行动代价相当 | `0.5` |
| 误判为「是」很贵 | `≥ 0.8` |
| 真的要紧 | 把 `0.2–0.8` 当作「交给人」 |

三条红线：

1. **`confidence < 0.5` 不要据此行动**（上游原话 "Do not act on a coin flip"）。`noul` 看那个概率离 0.5 有多远
2. **类别不穷尽时一定要加 `other` / `unclear`**，否则模型被迫从错的里面挑一个
3. **「答案永远不是许可」**——原文 `"An answer is never permission."` 行动前另行核对。**选择和授权是两件事**

### 硬限制

| 项 | 值 |
|---|---|
| `state` | 文本或 JSON，约 96 KB / 32k token 截断；**不支持图片** |
| 每次调用问题数 | 最多 **20** 个，题型可混用 |
| 批量 `items` | 最多 **200** 条，保持输入顺序，每批并发 8；失败项带 `error` 而非 `answers`，其余照常可用 |
| 延迟 | 约 0.1–0.5 秒 |
| 成本 | 按输入 token（约 $0.04/百万），**输出免费** |
| `instructions` | 一句话或小对象 `{question, focus}`；用**英文**效果最好 |
| 本地 Laya | 英文 checkpoint 只读约 **512 token** 的 state，本地跑务必把 state 写短 |

隐私：别把密钥、凭据或不该离开本机的文件内容放进 `state`。每次调用记在 `~/.craft-agent/logs/decisions.jsonl`——记问题、概率和 state 的**哈希**，不记原文。

## ⚠️ 不许做的事

1. **不要编 `confidence` 的计算公式。** Jev 没公开它，只知道它衡量「概率有多集中」、阈值 0.5。页面里若要显示自算的集中度指标（比如最高单档概率），**必须明确标注这是演示用的自算值，不是 Jev 返回的 `confidence`**。
2. **不要把 `score` 说成 0–1。** 这是整页最核心的事实，错了全盘皆错。
3. **不要宣称 Jev "不会幻觉"。** 准确说法是：它**不可能吐出非法类型，但完全可以吐出一个合法而彻底错误的值**。按 TypeSafe 自己工作流看板的数字，Jev 综合准确率 67.8%，最佳对照是 74.1%——**它换来的是速度和成本，不是更准**。
4. **不要用形容词当例子里的档位**——页面自己就在教这条规矩，示例得自洽。

## 参考实现

- 文字版：`docs/jev-decide.md`（同一仓库）
- 交互版：https://claude.ai/artifact/9Dhz7AwBPHutsUiFSMTLrr
  核心是一个「期望档位实验台」：3/4/5 档可切，每档一个权重滑块，实时显示归一化概率柱状图 + 期望值标记落在哪 + `Math.round(score)` 得到哪一档，并带「集中 / 双峰 / 均匀」三个预设；双峰时弹出警告说明这个数不能用。

**再做一版的意思是换个讲法，不是复刻。** 上面那版把赌注全压在一个仪表上；你可以压在别处——比如做成「给你一堆真实工单，你来选题型，选错了演示会丢什么信息」的练习，或者直接做一个能粘贴 criteria 草稿、当场指出「这档写成形容词了」的检查器。挑一个你认为最能让人记住的切口，做深。

---

[PROTOCOL]: 本 brief 的事实随 `packages/shared/src/decisions/` 与 `apps/electron/resources/docs/decisions.md` 变化，上游改动时回来核对。
