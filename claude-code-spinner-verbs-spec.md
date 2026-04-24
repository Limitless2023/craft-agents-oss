# Claude Code 随机动词加载提示 —— 复现规范

> 目标：在另一个 agent 项目中复现 Claude Code 运行时那种"每次加载都随机换一个搞怪英文动词"的体验。
> 参考源码：`/Users/limitless/Desktop/Projects/claude-code/` (2026-03-31 快照)

---

## 1. 事实澄清：数量不是 200，是 **187**

Claude Code 的词表实际上是 **187 个不同的现在进行时动词**（不是常说的 200）。另外还有一个配套的 **8 个过去时动词** 用在"turn 完成"时。

- 主词表（现在进行时）：`/Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts`，共 **187** 个
- 完成词表（过去时）：`/Users/limitless/Desktop/Projects/claude-code/src/constants/turnCompletionVerbs.ts`，共 **8** 个

> 实测命令：`grep -cE "^  [\"']" /Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts` → 187

---

## 2. 核心设计原则（很重要，先读这个）

这套系统看起来只是"随机挑个词"，但实际有 4 个关键约束：

1. **每个 turn 只挑一次**，不要每帧重挑。否则加载过程中动词会跳来跳去，用户会晕。
2. **有 todo 时用 todo 的 `activeForm` 覆盖随机词**。比如在做"重构 auth"，就应该显示 `Refactoring…` 而不是 `Flibbertigibbeting…`。
3. **有系统 override 时用 override 覆盖**。比如压缩上下文时应该显示 `Compacting conversation…` 而不是随机词。
4. **词表可以用户配置**：支持 `append`（追加到默认词表）或 `replace`（完全替换）两种模式。

用一个优先级表达就是：

```
message = overrideMessage          // 最高：系统强制，如 "Compacting…"
       ?? currentTodo?.activeForm  // 次高：当前 todo 的进行时描述
       ?? currentTodo?.subject     // 再次：当前 todo 的标题
       ?? randomVerb               // 最低：随机兜底
```

这个优先级链实现在 `/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx:168-170`：

```ts
const leaderVerb = overrideMessage
  ?? currentTodo?.activeForm
  ?? currentTodo?.subject
  ?? randomVerb
```

---

## 3. 词表数据（可直接复制使用）

### 3.1 现在进行时词表（187 个，按字母序）

源文件：`/Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts:16-204`

```ts
export const SPINNER_VERBS = [
  'Accomplishing',   'Actioning',         'Actualizing',       'Architecting',
  'Baking',          'Beaming',           "Beboppin'",         'Befuddling',
  'Billowing',       'Blanching',         'Bloviating',        'Boogieing',
  'Boondoggling',    'Booping',           'Bootstrapping',     'Brewing',
  'Bunning',         'Burrowing',         'Calculating',       'Canoodling',
  'Caramelizing',    'Cascading',         'Catapulting',       'Cerebrating',
  'Channeling',      'Channelling',       'Choreographing',    'Churning',
  'Clauding',        'Coalescing',        'Cogitating',        'Combobulating',
  'Composing',       'Computing',         'Concocting',        'Considering',
  'Contemplating',   'Cooking',           'Crafting',          'Creating',
  'Crunching',       'Crystallizing',     'Cultivating',       'Deciphering',
  'Deliberating',    'Determining',       'Dilly-dallying',    'Discombobulating',
  'Doing',           'Doodling',          'Drizzling',         'Ebbing',
  'Effecting',       'Elucidating',       'Embellishing',      'Enchanting',
  'Envisioning',     'Evaporating',       'Fermenting',        'Fiddle-faddling',
  'Finagling',       'Flambéing',         'Flibbertigibbeting','Flowing',
  'Flummoxing',      'Fluttering',        'Forging',           'Forming',
  'Frolicking',      'Frosting',          'Gallivanting',      'Galloping',
  'Garnishing',      'Generating',        'Gesticulating',     'Germinating',
  'Gitifying',       'Grooving',          'Gusting',           'Harmonizing',
  'Hashing',         'Hatching',          'Herding',           'Honking',
  'Hullaballooing',  'Hyperspacing',      'Ideating',          'Imagining',
  'Improvising',     'Incubating',        'Inferring',         'Infusing',
  'Ionizing',        'Jitterbugging',     'Julienning',        'Kneading',
  'Leavening',       'Levitating',        'Lollygagging',      'Manifesting',
  'Marinating',      'Meandering',        'Metamorphosing',    'Misting',
  'Moonwalking',     'Moseying',          'Mulling',           'Mustering',
  'Musing',          'Nebulizing',        'Nesting',           'Newspapering',
  'Noodling',        'Nucleating',        'Orbiting',          'Orchestrating',
  'Osmosing',        'Perambulating',     'Percolating',       'Perusing',
  'Philosophising',  'Photosynthesizing', 'Pollinating',       'Pondering',
  'Pontificating',   'Pouncing',          'Precipitating',     'Prestidigitating',
  'Processing',      'Proofing',          'Propagating',       'Puttering',
  'Puzzling',        'Quantumizing',      'Razzle-dazzling',   'Razzmatazzing',
  'Recombobulating', 'Reticulating',      'Roosting',          'Ruminating',
  'Sautéing',        'Scampering',        'Schlepping',        'Scurrying',
  'Seasoning',       'Shenaniganing',     'Shimmying',         'Simmering',
  'Skedaddling',     'Sketching',         'Slithering',        'Smooshing',
  'Sock-hopping',    'Spelunking',        'Spinning',          'Sprouting',
  'Stewing',         'Sublimating',       'Swirling',          'Swooping',
  'Symbioting',      'Synthesizing',      'Tempering',         'Thinking',
  'Thundering',      'Tinkering',         'Tomfoolering',      'Topsy-turvying',
  'Transfiguring',   'Transmuting',       'Twisting',          'Undulating',
  'Unfurling',       'Unravelling',       'Vibing',            'Waddling',
  'Wandering',       'Warping',           'Whatchamacalliting','Whirlpooling',
  'Whirring',        'Whisking',          'Wibbling',          'Working',
  'Wrangling',       'Zesting',           'Zigzagging',
]
```

### 3.2 过去时完成词表（8 个）

源文件：`/Users/limitless/Desktop/Projects/claude-code/src/constants/turnCompletionVerbs.ts`

```ts
// 用法：`${verb} for ${duration}` → "Cooked for 5s"
// 所以只挑那些能自然搭配 "for [time]" 的过去时动词
export const TURN_COMPLETION_VERBS = [
  'Baked',
  'Brewed',
  'Churned',
  'Cogitated',
  'Cooked',
  'Crunched',
  'Sautéed',
  'Worked',
]
```

**注意这个词表的选词原则**：源文件第 2 行注释写明 "These verbs work naturally with 'for [duration]'"。也就是说 `Flibbertigibbeted for 5s` 读起来很怪，所以过去时词表远小于现在进行时词表，只选了 8 个万能搭配。

---

## 4. 随机挑选逻辑（React 版本）

源文件：`/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx:166`

```ts
import { useState } from 'react'
import sample from 'lodash-es/sample.js'
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js'

// 关键：useState + 初始化函数
// 这让 sample() 只在组件 mount 时执行一次
// 后续重渲染不会换词（即使是 50ms 一次的动画重渲染）
const [randomVerb] = useState(() => sample(getSpinnerVerbs()))
```

**为什么不用 `useMemo`？** `useMemo` 不保证只计算一次（React 可能扔掉缓存重算），而 `useState` 的初始函数 **严格只跑一次**。这个区别对"整个 turn 锁定同一个词"至关重要。

### 4.1 非 React 环境（纯 TS/JS）等价实现

```ts
// 在一个 turn 开始时调用一次，保存结果
function pickVerb(verbs: string[]): string {
  return verbs[Math.floor(Math.random() * verbs.length)]!
}

// turn 生命周期内持有
class TurnState {
  readonly verb: string
  constructor(verbs: string[]) {
    this.verb = pickVerb(verbs)  // 锁定
  }
}
```

### 4.2 Swarm（多 agent）场景

在多 agent 场景下，每个 teammate 也要自己的动词。`/Users/limitless/Desktop/Projects/claude-code/src/utils/swarm/spawnInProcess.ts:171-172` 在创建 teammate 时就写入：

```ts
{
  spinnerVerb:  sample(getSpinnerVerbs()),     // 创建时锁定
  pastTenseVerb: sample(TURN_COMPLETION_VERBS), // 完成时用
  ...
}
```

所以 teammate 的动词是 **创建时分配、持久化到 state**，而不是组件里挑。这样即使 UI 重建，teammate 的动词也不会变。

---

## 5. 用户配置支持

源文件：`/Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts:3-13`

```ts
export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS                    // 无配置：默认词表
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0          // 替换模式，但空数组 fallback 回默认
      ? config.verbs
      : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs] // 追加模式：默认 + 用户
}
```

设置 schema（`/Users/limitless/Desktop/Projects/claude-code/src/utils/settings/types.ts:668-676`）：

```ts
spinnerVerbs: z
  .object({
    mode: z.enum(['append', 'replace']),
    verbs: z.array(z.string()),
  })
  .optional()
  .describe(
    'Customize spinner verbs. mode: "append" adds verbs to defaults, "replace" uses only your verbs.',
  )
```

用户在 `settings.json` 里可以这样写：

```json
{
  "spinnerVerbs": {
    "mode": "append",
    "verbs": ["Hacking", "Refactoring", "Debugging"]
  }
}
```

或者完全替换成中文：

```json
{
  "spinnerVerbs": {
    "mode": "replace",
    "verbs": ["冥想中", "酝酿中", "炖煮中", "捣鼓中"]
  }
}
```

**需要复现的行为**：`replace` 模式遇到空数组要 fallback 回默认词表，不能真的用空数组。这是防御式 guard。

---

## 6. 显示时的修饰

源文件：`/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx:171`

```ts
const message = effectiveVerb + '…'
```

- 动词后面加 **省略号（U+2026，单字符 `…`）**，不是三个点 `...`。
- 省略号也是单字符，`stringWidth` 算作 1 列宽。

然后这个 `message` 送进 `GlimmerMessage`，上面跑流光高亮动画（详见 `claude-code-spinner-analysis.md`）。

---

## 7. 复现最小实现（~60 行）

如果另一个 agent 只想要"随机动词 + 每 turn 锁定"这个核心功能，不要流光动画，最小代码就是：

```ts
// spinnerVerbs.ts
export const SPINNER_VERBS = [
  'Accomplishing', 'Baking', 'Brewing', 'Cogitating', 'Cooking',
  // ... 复制上面第 3.1 节的完整 187 个
] as const

export const TURN_COMPLETION_VERBS = [
  'Baked', 'Brewed', 'Churned', 'Cogitated',
  'Cooked', 'Crunched', 'Sautéed', 'Worked',
] as const

// verbPicker.ts
export function pickRandomVerb<T>(verbs: readonly T[]): T {
  return verbs[Math.floor(Math.random() * verbs.length)]!
}

// turn.ts
export class Turn {
  readonly startTime = Date.now()
  readonly progressVerb: string  // 加载中显示
  readonly completionVerb: string // 完成后显示

  constructor(
    private readonly overrideMessage?: string,
    private readonly todoActiveForm?: string,
  ) {
    this.progressVerb = pickRandomVerb(SPINNER_VERBS)
    this.completionVerb = pickRandomVerb(TURN_COMPLETION_VERBS)
  }

  // 加载中消息
  getLoadingMessage(): string {
    const verb =
      this.overrideMessage ??
      this.todoActiveForm ??
      this.progressVerb
    return `${verb}…`
  }

  // 完成消息
  getCompletionMessage(): string {
    const seconds = Math.round((Date.now() - this.startTime) / 1000)
    return `${this.completionVerb} for ${seconds}s`
  }
}

// 使用
const turn = new Turn()          // turn 开始时创建一次
console.log(turn.getLoadingMessage())
// → "Flibbertigibbeting…"  (整个 turn 都是这个词)

// turn 结束时
console.log(turn.getCompletionMessage())
// → "Cooked for 12s"
```

**三个关键点**：
1. `Turn` 实例在 **turn 开始时** 创建一次，贯穿整个 turn 生命周期。
2. `progressVerb` 和 `completionVerb` 是 `readonly`，锁定后不再变。
3. `getLoadingMessage()` 每次调用都返回同一个词（因为读的是锁定的 ref）。

---

## 8. 风格选词原则（如果要自建词表）

观察默认 187 个词的选词模式，可以总结出 Claude Code 团队的审美：

1. **全部是现在进行时 `-ing` 形式**（`Cooking`、`Brewing`），读起来像正在做事。
2. **大量生僻但不低俗的搞怪词**：`Flibbertigibbeting`、`Discombobulating`、`Prestidigitating`、`Whatchamacalliting`。这些词用户不一定懂，但明显能看出是在开玩笑。
3. **烹饪隐喻占比很高**：`Baking`、`Brewing`、`Caramelizing`、`Drizzling`、`Fermenting`、`Frosting`、`Garnishing`、`Julienning`、`Kneading`、`Leavening`、`Marinating`、`Proofing`、`Sautéing`、`Seasoning`、`Simmering`、`Stewing`、`Tempering`、`Whisking`、`Zesting`。把"计算"类比成"做菜"，传递"慢工出细活"的感觉。
4. **自然/物理隐喻**：`Billowing`、`Cascading`、`Crystallizing`、`Evaporating`、`Germinating`、`Hatching`、`Nucleating`、`Photosynthesizing`、`Precipitating`、`Sprouting`、`Sublimating`、`Undulating`。
5. **动物/动作**：`Galloping`、`Pouncing`、`Scampering`、`Slithering`、`Waddling`、`Moonwalking`、`Jitterbugging`。
6. **少量彩蛋词**：`Clauding`（Claude 自己）、`Gitifying`（git 梗）、`Hyperspacing`、`Quantumizing`、`Reticulating`（致敬 SimCity 的 "Reticulating splines"）。
7. **避免**负面词（没有 `Failing`、`Crashing`、`Erroring`），也避免尴尬词。
8. **允许带引号/破折号/变音符**：`"Beboppin'"`、`'Dilly-dallying'`、`'Flambéing'`、`'Sautéing'`。实现时注意 UTF-8 和 grapheme 宽度。

如果要给另一个 agent 做中文词表，可以参考这个风格：**烹饪/自然/搞怪 + 避免负面 + 全部现在进行时**。比如：

```ts
'冥思中', '酝酿中', '炖煮中', '熬制中', '琢磨中',
'推演中', '捣鼓中', '翻找中', '编织中', '发酵中',
'蒸腾中', '孵化中', '雕琢中', '盘算中', '鼓捣中',
```

---

## 9. 关联文件索引（另一个 agent 想深入时用）

| 目的 | 文件 | 行 |
|---|---|---|
| 主词表（187） | `/Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts` | 16-204 |
| 读词表（含配置） | `/Users/limitless/Desktop/Projects/claude-code/src/constants/spinnerVerbs.ts` | 3-13 |
| 过去时词表（8） | `/Users/limitless/Desktop/Projects/claude-code/src/constants/turnCompletionVerbs.ts` | 3-12 |
| 主 spinner 挑选 | `/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx` | 166 |
| 优先级链（override > todo > random） | `/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx` | 168-170 |
| Brief spinner 兜底挑选 | `/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner.tsx` | 449 |
| Teammate spinner 挑选 | `/Users/limitless/Desktop/Projects/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx` | 80-81 |
| Swarm 创建时分配 | `/Users/limitless/Desktop/Projects/claude-code/src/utils/swarm/spawnInProcess.ts` | 171-172 |
| 用户配置 schema | `/Users/limitless/Desktop/Projects/claude-code/src/utils/settings/types.ts` | 668-676 |
| 配置文档 | `/Users/limitless/Desktop/Projects/claude-code/src/skills/bundled/updateConfig.ts` | 101 |

---

## 10. 实现 Checklist（另一个 agent 对着勾）

- [ ] 复制 187 个现在进行时动词到常量文件
- [ ] 复制 8 个过去时动词到常量文件
- [ ] 实现 `getSpinnerVerbs()`：支持 `append` / `replace` 两种用户配置模式
- [ ] `replace` 空数组要 fallback 回默认
- [ ] Turn/Session 创建时用 `sample()` 挑一次，锁定到 ref/readonly 字段
- [ ] 显示时优先级：`override > todo.activeForm > todo.subject > randomVerb`
- [ ] 消息后缀用单字符省略号 `…` (U+2026)，不是 `...`
- [ ] 完成消息用过去时词表 + `for ${seconds}s` 格式
- [ ] 多 agent 场景：teammate 的动词在创建 state 时就写入，不在 UI 层挑
- [ ] 避免 `useMemo`，用 `useState(() => sample(...))` 或等价的"一次性初始化"机制

---

## 11. 一句话总结给另一个 agent

> "有一个 187 词的动词池，turn 开始时用 `sample()` 挑一个锁定，显示时按 `override → todo → random` 优先级降级，加省略号结尾。支持用户 `append`/`replace` 配置。就这样。"
