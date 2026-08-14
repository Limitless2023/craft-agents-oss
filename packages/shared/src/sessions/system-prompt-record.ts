/**
 * [INPUT]: 依赖 node:fs 的 appendFileSync/mkdirSync/readFileSync，依赖 ./storage 的 getSessionPath
 * [OUTPUT]: 对外提供 recordSystemPrompt —— 把 craft 自己拼装的系统提示词落一份 sidecar
 * [POS]: 「轨迹视图」第二档的**记录端**。SDK 会把模型收到的一切写进它自己的 transcript，
 *        唯独系统提示词不写——那一段是 craft 在建请求时拼的，只有 craft 知道。这里补上。
 *        刻意只做"变了才追加"：系统提示词一个会话内通常一成不变，逐轮全量写会让
 *        sidecar 比会话本身还大。读取端在 renderer/lib/trajectory-core.ts。
 *        写失败一律静默——这是可视化用的旁路数据，绝不能让它拖垮一次真实对话。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getSessionPath } from './storage.ts';

/**
 * 进程内"上次写入的指纹"缓存，键为 workspace::session。
 * 有它，稳定不变的系统提示词每个会话只读一次盘、只写一次。
 */
const lastFingerprint = new Map<string, string>();

/** FNV-1a：变更检测够用，且不引入 crypto 依赖（这条路径在每轮请求上）。 */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + text.length.toString(36);
}

export interface SystemPromptRecordMeta {
  /** 本次请求使用的模型，便于分辨"换模型导致提示词变了"。 */
  model?: string;
  /** 来源标记：craft-append = 追加在 Claude Code 预设之后的那段；mini = 精简体。 */
  source?: string;
}

/**
 * 记录一次系统提示词。同一会话内容不变则直接返回（不碰磁盘）。
 *
 * @param workspaceRootPath 工作区根目录
 * @param sessionId 会话 id
 * @param text 系统提示词全文
 */
export function recordSystemPrompt(
  workspaceRootPath: string | undefined,
  sessionId: string | undefined,
  text: string,
  meta: SystemPromptRecordMeta = {}
): void {
  if (!workspaceRootPath || !sessionId || !text) return;

  const key = `${workspaceRootPath}::${sessionId}`;
  const fp = fingerprint(text);
  if (lastFingerprint.get(key) === fp) return;

  try {
    const dir = join(getSessionPath(workspaceRootPath, sessionId), 'meta');
    const file = join(dir, 'system-prompt.jsonl');

    // 进程重启后首次写入：先看盘上最后一条是不是同一份，避免每次开 app 都追加重复行
    if (!lastFingerprint.has(key) && existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').trim().split('\n');
      const last = lines[lines.length - 1];
      if (last) {
        try {
          const parsed = JSON.parse(last) as { sha?: string };
          if (parsed.sha === fp) {
            lastFingerprint.set(key, fp);
            return;
          }
        } catch {
          // 坏行忽略，照常追加新的
        }
      }
    }

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(
      file,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        sha: fp,
        chars: text.length,
        source: meta.source ?? 'craft-append',
        ...(meta.model ? { model: meta.model } : {}),
        text,
      }) + '\n',
      'utf-8'
    );
    lastFingerprint.set(key, fp);
  } catch {
    // 旁路数据写失败不影响对话——静默即可
  }
}
