/**
 * CLI Hooks — 读取 ~/.claude/settings.json 的 command hooks，
 * 转换为 SDK hook 回调，使 Craft Agents 能通知 Vibehood/Vibe Island 等外部应用。
 *
 * [INPUT]: 依赖 ~/.claude/settings.json 的 hooks 配置
 * [OUTPUT]: 对外提供 loadCliHooks(), replaceSource()
 * [POS]: automations 模块的 CLI 桥接层，被 claude-agent.ts 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, SdkAutomationCallbackMatcher, SdkAutomationInput } from './types'
import { createLogger } from '../utils/debug'

const log = createLogger('cli-hooks')

// ============================================================================
// 命令执行
// ============================================================================

/**
 * 生成一个 SDK hook 回调：spawn 命令，将事件 JSON 写入 stdin。
 * 不阻塞 agent — 超时后静默放弃。
 * 保持命令原样执行，不修改 --source 参数（bridge 二进制只认预定义源）。
 */
function createCommandCallback(
  command: string,
  timeoutSec: number = 10,
): (input: SdkAutomationInput, toolUseId: string, options: { signal?: AbortSignal }) => Promise<{ continue: boolean }> {
  return async (input, _toolUseId, _options) => {
    try {
      const child = spawn('sh', ['-c', command], {
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: timeoutSec * 1000,
      })

      // 将事件数据写入 stdin
      const payload = JSON.stringify(input)
      child.stdin?.write(payload)
      child.stdin?.end()

      // Fire-and-forget — 不等待完成
      child.on('error', (err) => {
        log.debug(`[cli-hooks] Command error: ${err.message}`)
      })
    } catch (err) {
      log.debug(`[cli-hooks] Failed to spawn: ${err}`)
    }

    return { continue: true }
  }
}

// ============================================================================
// 配置解析
// ============================================================================

/** settings.json 中单个 hook 条目的结构 */
interface SettingsHookEntry {
  command?: string
  type?: string
  timeout?: number
}

/** settings.json 中单个 matcher 条目的结构 */
interface SettingsMatcherEntry {
  hooks?: SettingsHookEntry[]
  matcher?: string
}

/**
 * 读取 settings.json，提取 command 类型的 hooks，转换为 SDK 回调。
 *
 * @param settingsPath — 配置文件路径，默认 ~/.claude/settings.json
 * @returns 按事件类型分组的 SdkAutomationCallbackMatcher 映射
 */
export function loadCliHooks(
  settingsPath?: string,
): Partial<Record<AgentEvent, SdkAutomationCallbackMatcher[]>> {
  const filePath = settingsPath ?? join(homedir(), '.claude', 'settings.json')

  if (!existsSync(filePath)) {
    return {}
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    log.debug(`[cli-hooks] Failed to parse ${filePath}`)
    return {}
  }

  const hooks = parsed.hooks as Record<string, SettingsMatcherEntry[]> | undefined
  if (!hooks || typeof hooks !== 'object') {
    return {}
  }

  const result: Partial<Record<AgentEvent, SdkAutomationCallbackMatcher[]>> = {}

  for (const [eventName, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue

    const sdkMatchers: SdkAutomationCallbackMatcher[] = []

    for (const matcher of matchers) {
      const commandHooks = (matcher.hooks ?? []).filter(
        (h: SettingsHookEntry) => h.type === 'command' && h.command,
      )

      if (commandHooks.length === 0) continue

      const callbacks = commandHooks.map((h: SettingsHookEntry) =>
        createCommandCallback(h.command!, h.timeout),
      )

      sdkMatchers.push({
        ...(matcher.matcher ? { matcher: matcher.matcher } : {}),
        hooks: callbacks,
      })
    }

    if (sdkMatchers.length > 0) {
      result[eventName as AgentEvent] = sdkMatchers
    }
  }

  const eventCount = Object.keys(result).length
  if (eventCount > 0) {
    log.debug(`[cli-hooks] Loaded hooks for ${eventCount} event types`)
  }

  return result
}
