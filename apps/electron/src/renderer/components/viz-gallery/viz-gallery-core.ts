/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: 对外提供 collectVizRoots（workspace/会话 cwd 去重）、isGalleryVizFile
 *          （画廊收录过滤：.html 且非 -standalone 导出副本）、entryDisplayName、
 *          VizGalleryEntry 类型
 * [POS]: viz-gallery 的纯逻辑层，被 VizGalleryPage 消费，可单测；扫描目标 =
 *        每个根目录下的 .craft/visualizations/（与 visualize 技能的落盘约定同构）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export interface VizGalleryEntry {
  /** 可视化文件绝对路径。 */
  path: string
  /** 文件名（含 .html）。 */
  name: string
  /** 所属扫描根目录（workspace 根或某会话 cwd）。 */
  root: string
}

/** workspace 根 + 各会话工作目录，去重去空，保持首次出现顺序。 */
export function collectVizRoots(
  workspaceRoot: string | undefined,
  workingDirs: Iterable<string | undefined>
): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const dir of [workspaceRoot, ...workingDirs]) {
    if (!dir) continue
    const normalized = dir.endsWith('/') ? dir.slice(0, -1) : dir
    if (seen.has(normalized)) continue
    seen.add(normalized)
    roots.push(normalized)
  }
  return roots
}

/** 画廊收录规则：.html/.htm，排除导出的 -standalone 副本（它们是分享用衍生物）。 */
export function isGalleryVizFile(name: string): boolean {
  return /\.html?$/i.test(name) && !/-standalone\.html?$/i.test(name)
}

/** 卡片显示名：去掉扩展名。 */
export function entryDisplayName(name: string): string {
  return name.replace(/\.html?$/i, '')
}
