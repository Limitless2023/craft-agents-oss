/**
 * [INPUT]: 依赖 ./viz-assets 的 VIZ_BASE_CSS（Codex visualize 设计系统样式）
 * [OUTPUT]: 对外提供 buildVizDocument（片段→完整沙箱文档）、parseVizFence（fence 体解析）、
 *          readVizTheme / clampVizHeight / classifyVizReadError、
 *          VIZ_CSP / VIZ_IFRAME_SANDBOX / VIZ_MAX_FILE_BYTES 等常量
 * [POS]: markdown 模块"对话内交互可视化"的纯逻辑层（无 React），被 MarkdownVizBlock 消费；
 *        改编自 KouriVar/Craft-Agents widget-runtime/inline-host.ts，差异：CSP 无 CDN 白名单
 *        （彻底断网）、不内嵌 lucide/floating-ui 运行时、fence 语法替代 ::inline-vis 指令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { VIZ_BASE_CSS } from './viz-assets'

// ============================================================================
// 安全常量（红线 S1/S2：sandbox 仅 allow-scripts；CSP 无任何网络源）
// ============================================================================

/** iframe sandbox 属性。绝不可追加 allow-same-origin / allow-popups / allow-top-navigation。 */
export const VIZ_IFRAME_SANDBOX = 'allow-scripts'

/**
 * 文档级 CSP：无任何外部源（收紧于参考实现的 CDN 白名单——数据与代码必须全部内联，
 * 消除"经 CDN 图片 URL 查询串外带数据"的窄通道）。
 */
export const VIZ_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'font-src data:',
  'img-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const VIZ_MIN_HEIGHT = 48
export const VIZ_MAX_HEIGHT = 20_000
/** 单文件上限 2 MB（spec S5；file:read 无上限，前端读回后校验）。 */
export const VIZ_MAX_FILE_BYTES = 2 * 1024 * 1024

/** postMessage 来源标识（红线 S7：双向都必须校验）。 */
export const VIZ_HOST_SOURCE = 'craft-widget-host'
export const VIZ_WIDGET_SOURCE = 'craft-widget'

// ============================================================================
// fence 体解析：```viz 代码块的第一个非空行 = 可视化文件的绝对路径
// ============================================================================

export interface VizFenceTarget {
  /** 绝对文件路径（file:read 只接受绝对路径）。 */
  file: string
}

/**
 * 解析 ```viz fence 体。约定：第一个非空行是绝对路径，允许 `file:` 前缀，
 * 其余行忽略（前向兼容未来属性）。非绝对路径返回 null——渲染层给出错误卡片，
 * 绝不让整条消息崩溃（spec 5.2.5）。
 */
export function parseVizFence(code: string): VizFenceTarget | null {
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const file = line.replace(/^file\s*:\s*/i, '').trim()
    if (!file.startsWith('/')) return null
    return { file }
  }
  return null
}

// ============================================================================
// 主题快照：从宿主根元素读取设计变量，推送给 iframe（G4）
// ============================================================================

/** 与参考实现一致的设计变量清单（同源 fork，token 命名相同）。 */
const THEME_TOKEN_NAMES = [
  'background',
  'foreground',
  'accent',
  'info',
  'success',
  'destructive',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'border',
  'input',
  'ring',
  'font-size-base',
  'font-default',
  'shadow-minimal',
] as const

export type VizThemeSnapshot = {
  mode: 'light' | 'dark'
  tokens: Record<string, string>
}

/**
 * 语义翻译层：Craft 宿主的品牌主色叫 `--accent`（无 `--primary`），而 Codex
 * visualize.css 的主色叫 `--primary`（`--viz-series-1` 等图表系列色由它派生）。
 * 桥若只"搬运"不"翻译"，沙箱里 `--primary` 永远落回 css 默认蓝。
 * 在快照层做一次别名映射，三个注入点（初始注入 / 桥脚本 applyTheme / standalone
 * 导出）自动继承，单点修复。
 */
export function withVizSemanticAliases(tokens: Record<string, string>): Record<string, string> {
  const out = { ...tokens }
  if (out['accent'] && !out['primary']) out['primary'] = out['accent']
  return out
}

export function readVizTheme(root: HTMLElement = document.documentElement): VizThemeSnapshot {
  const styles = getComputedStyle(root)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKEN_NAMES) {
    const value = styles.getPropertyValue(`--${name}`).trim()
    if (value) tokens[name] = value
  }
  return {
    mode: root.classList.contains('dark') ? 'dark' : 'light',
    tokens: withVizSemanticAliases(tokens),
  }
}

/** 高度 clamp（G5：异常值收敛到 [48, 20000]）。非法输入返回 null。 */
export function clampVizHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(VIZ_MIN_HEIGHT, Math.min(VIZ_MAX_HEIGHT, Math.ceil(value)))
}

// ============================================================================
// 读文件错误分类（spec 5.3.4：前端按类展示不同文案）
// ============================================================================

export type VizReadError = 'access-denied' | 'not-found' | 'read-failed' | 'too-large' | 'invalid-path'

/** file:read 的错误是裸字符串 message，按子串归类三档；未知一律 read-failed。 */
export function classifyVizReadError(message: string): VizReadError {
  const lower = message.toLowerCase()
  if (lower.includes('access denied') || lower.includes('not allowed')) return 'access-denied'
  if (lower.includes('enoent') || lower.includes('no such file') || lower.includes('not found')) return 'not-found'
  return 'read-failed'
}

// ============================================================================
// 文档组装：片段 → 完整 srcdoc 文档（CSP + 基础样式 + 主题 + 桥脚本）
// ============================================================================

/**
 * iframe 内桥脚本：主题应用、ResizeObserver 高度汇报、window.openai/craft 兼容面
 * （sendFollowUpMessage v1 由宿主统一回执 unsupported，二期接确认对话框即可启用）。
 */
const BRIDGE_SCRIPT = `
(() => {
  const HOST_SOURCE = '${VIZ_HOST_SOURCE}';
  const WIDGET_SOURCE = '${VIZ_WIDGET_SOURCE}';
  const pendingFollowUps = new Map();
  let followUpId = 0;
  let measureFrame = 0;
  let lastHeight = 0;

  const post = (message) => {
    try { window.parent.postMessage({ source: WIDGET_SOURCE, ...message }, '*'); } catch {}
  };

  const applyTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    document.documentElement.dataset.theme = theme.mode === 'dark' ? 'dark' : 'light';
    const tokens = theme.tokens && typeof theme.tokens === 'object' ? theme.tokens : {};
    for (const [name, value] of Object.entries(tokens)) {
      if (typeof value === 'string') document.documentElement.style.setProperty('--' + name, value);
    }
    const surface = typeof tokens.background === 'string' ? tokens.background : 'transparent';
    document.documentElement.style.setProperty('--craft-host-background', surface);
  };

  const measure = () => {
    if (measureFrame) cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0;
      const body = document.body;
      const bodyRect = body ? body.getBoundingClientRect() : { top: 0, height: 0 };
      let contentBottom = bodyRect.height;
      if (body) {
        for (const child of body.children) {
          const style = getComputedStyle(child);
          if (style.position === 'fixed' || style.display === 'none') continue;
          const rect = child.getBoundingClientRect();
          contentBottom = Math.max(contentBottom, rect.bottom - bodyRect.top);
        }
      }
      const height = Math.ceil(Math.max(1, contentBottom));
      if (height !== lastHeight) {
        lastHeight = height;
        post({ type: 'resize', height });
      }
    });
  };

  const sendFollowUpMessage = (payload) => {
    const value = typeof payload === 'string' ? { prompt: payload } : payload;
    const prompt = value && typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt) return Promise.reject(new TypeError('sendFollowUpMessage requires a non-empty prompt.'));
    const requestId = 'follow-up-' + (++followUpId);
    return new Promise((resolve) => {
      pendingFollowUps.set(requestId, resolve);
      post({ type: 'sendFollowUpMessage', requestId, message: { prompt } });
    });
  };

  window.openai = { ...(window.openai || {}), sendFollowUpMessage };
  window.craft = { ...(window.craft || {}), sendFollowUpMessage };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.source !== HOST_SOURCE) return;
    if (data.type === 'theme') {
      applyTheme(data.theme);
      measure();
      return;
    }
    if (data.type === 'followUpResult' && typeof data.requestId === 'string') {
      const resolve = pendingFollowUps.get(data.requestId);
      if (!resolve) return;
      pendingFollowUps.delete(data.requestId);
      resolve(data.ok ? { ok: true } : { ok: false, error: data.error || 'cancelled' });
    }
  });

  const initialize = () => {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } else {
      window.setInterval(measure, 500);
    }
    window.addEventListener('load', measure, { once: true });
    post({ type: 'ready' });
    measure();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
`

const HOST_SURFACE_STYLES = [
  ':root { background-color: var(--craft-host-background, transparent) !important; }',
  'html > body { padding: 0 !important; }',
].join('\n')

/** 防止片段/脚本里的 </script> 提前闭合内联 script 标签。 */
export function safeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/**
 * 把 HTML 片段包装成完整的 srcdoc 文档：CSP meta + 基础样式 + 主题初值 + 桥脚本。
 * 片段若自带 <html>（技能约定不该出现，但要容错），把 head 内容注进去而非二次包裹。
 */
export function buildVizDocument(fragment: string, theme: VizThemeSnapshot): string {
  const themeVars = Object.entries(theme.tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(' ')
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${VIZ_CSP}">`,
    `<style>${VIZ_BASE_CSS}\n${HOST_SURFACE_STYLES}\n:root { ${themeVars} --craft-host-background: ${theme.tokens.background || 'transparent'}; }</style>`,
  ].join('')
  const scripts = `<script>${safeInlineScript(BRIDGE_SCRIPT)}</script>`

  if (/<html[\s>]/i.test(fragment)) {
    let documentHtml = /<head[\s>]/i.test(fragment)
      ? fragment.replace(/<head([^>]*)>/i, `<head$1>${head}`)
      : fragment.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`)
    documentHtml = /<\/body>/i.test(documentHtml)
      ? documentHtml.replace(/<\/body>/i, `${scripts}</body>`)
      : `${documentHtml}${scripts}`
    return documentHtml
  }

  return `<!doctype html><html data-theme="${theme.mode}"><head>${head}</head><body>${fragment}${scripts}</body></html>`
}

/**
 * 导出用：片段 → 可独立在浏览器打开的自包含文档（方案 2）。
 * 与宿主文档的差异：无桥脚本（没有宿主可通信），主题按导出时快照**烘焙**进文档
 * （离开应用后不再跟随），补 charset/viewport/title。CSP 保持同一份——独立文件
 * 被分享出去后依然断网，行为可预期。
 */
export function buildStandaloneVizDocument(fragment: string, theme: VizThemeSnapshot, title: string): string {
  const themeVars = Object.entries(theme.tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(' ')
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${VIZ_CSP}">`,
    `<title>${title.replace(/</g, '&lt;')}</title>`,
    `<style>${VIZ_BASE_CSS}\n:root { ${themeVars} }\nbody { margin: 24px auto; max-width: 960px; padding: 0 16px; background: var(--background, #fff); }</style>`,
  ].join('')
  return `<!doctype html><html data-theme="${theme.mode}"><head>${head}</head><body>${fragment}</body></html>`
}
