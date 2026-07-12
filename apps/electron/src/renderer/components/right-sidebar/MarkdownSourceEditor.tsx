/**
 * [INPUT]: 依赖 @codemirror/{state,view,language,commands,lang-markdown} + @lezer/highlight；
 *          react（ref 挂载 EditorView，实例生命周期 = 组件生命周期）
 * [OUTPUT]: 对外提供 MarkdownSourceEditor 组件（带 md 语法高亮的源码编辑器：
 *          ⌘S 保存 / Esc 取消 / ⌘B 加粗 / ⌘I 斜体 / 列表自动续行 / 软换行）
 * [POS]: right-sidebar 的编辑输入面；被 PreviewPanel 编辑模式消费，替代裸 textarea。
 *        非受控挂载（按 filePath key 重建）：value 只做初始文档，变更经 onChange 上报草稿。
 *        保真原则：源码编辑，不碰用户未改动的字节——与 WYSIWYG 的全文规范化划清界限。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'

// ============================================================
// 主题：全部取 CSS 变量——亮暗主题自动跟随，无需双份定义
// ============================================================
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'transparent',
    color: 'hsl(var(--foreground) / 0.9)',
  },
  // 正文用应用阅读字体（中文长文源码编辑等宽反而难读）；代码 token 单独等宽
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': { caretColor: 'hsl(var(--foreground))', padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--foreground) / 0.12) !important',
  },
  '.cm-placeholder': { color: 'hsl(var(--muted-foreground) / 0.4)' },
})

// md 语法着色："有格式的源码"（Obsidian 源码模式感）：
// 标题分级放大、格式标记（#/>/**/`- `）淡化退后、代码等宽有底、链接着色
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.5em', color: 'hsl(var(--foreground))' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.3em', color: 'hsl(var(--foreground))' },
  { tag: tags.heading3, fontWeight: '700', fontSize: '1.15em', color: 'hsl(var(--foreground))' },
  { tag: tags.heading, fontWeight: '700', color: 'hsl(var(--foreground))' }, // h4-h6 兜底
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  // 格式标记淡化：# > ** ` - 等语法符号退到背景，内容站到前景
  { tag: tags.processingInstruction, color: 'hsl(var(--muted-foreground) / 0.5)' },
  { tag: tags.punctuation, color: 'hsl(var(--muted-foreground) / 0.6)' },
  { tag: tags.monospace, fontFamily: MONO, fontSize: '0.9em', color: 'hsl(var(--foreground))', backgroundColor: 'hsl(var(--foreground) / 0.07)', borderRadius: '3px' },
  { tag: tags.link, color: 'hsl(var(--primary))', textDecoration: 'underline' },
  { tag: tags.url, color: 'hsl(var(--primary) / 0.8)', fontFamily: MONO, fontSize: '0.9em' },
  { tag: tags.quote, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'hsl(var(--muted-foreground) / 0.6)' },
  { tag: tags.list, color: 'hsl(var(--foreground) / 0.9)' },
  { tag: tags.meta, color: 'hsl(var(--muted-foreground) / 0.6)' },
  { tag: tags.comment, color: 'hsl(var(--muted-foreground) / 0.7)', fontFamily: MONO, fontSize: '0.9em' },
])

// ============================================================
// ⌘B/⌘I：选区两侧包裹/解除标记（有则删、无则加；空选区放置光标于标记内）
// ============================================================
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length))
    if (before === marker && after === marker) {
      // 已包裹 → 解除
      return {
        changes: [
          { from: range.from - marker.length, to: range.from },
          { from: range.to, to: range.to + marker.length },
        ],
        range: range.extend(range.from - marker.length, range.to - marker.length),
      }
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: range.extend(range.from + marker.length, range.to + marker.length),
    }
  })
  view.dispatch(changes, { scrollIntoView: true, userEvent: 'input' })
  return true
}

export function MarkdownSourceEditor({
  initialValue,
  onChange,
  onSave,
  onCancel,
  placeholder,
}: {
  initialValue: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  placeholder?: string
}) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  // 回调走 ref——EditorView 只创建一次，闭包不过期
  const callbacksRef = React.useRef({ onChange, onSave, onCancel })
  React.useEffect(() => {
    callbacksRef.current = { onChange, onSave, onCancel }
  }, [onChange, onSave, onCancel])

  React.useEffect(() => {
    if (!hostRef.current) return
    const extensions: Extension[] = [
      history(),
      keymap.of([
        { key: 'Mod-s', run: () => { callbacksRef.current.onSave(); return true } },
        { key: 'Escape', run: () => { callbacksRef.current.onCancel(); return true } },
        { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
        { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      markdown({ base: markdownLanguage, addKeymap: true }), // 列表/引用自动续行
      syntaxHighlighting(mdHighlight),
      editorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacksRef.current.onChange(update.state.doc.toString())
      }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ]
    const view = new EditorView({
      state: EditorState.create({ doc: initialValue, extensions }),
      parent: hostRef.current,
    })
    view.focus()
    return () => view.destroy()
    // 仅挂载时创建——文档切换由父级用 key 重建组件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="h-full" />
}
