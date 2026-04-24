# CLI Hooks Integration — Vibehood / Vibe Island Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Craft Agents call external CLI hook commands (Vibehood, Vibe Island bridges) on agent events, so these apps can track session progress — same as they do with Claude Code.

**Architecture:** Read `~/.claude/settings.json` hooks config at agent startup, convert `{ type: "command" }` entries into async SDK hook callbacks that spawn child processes with event JSON on stdin. Merge these into the existing hooks pipeline in `claude-agent.ts`. Replace `--source=claude` with `--source=craft-agents` so bridge apps can distinguish the source.

**Tech Stack:** Node.js `child_process.spawn`, TypeScript, existing `SdkAutomationCallbackMatcher` type system.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared/src/automations/cli-hooks.ts` | **Create** | Read `~/.claude/settings.json`, convert command hooks to SDK callbacks |
| `packages/shared/src/automations/__tests__/cli-hooks.test.ts` | **Create** | Unit tests for CLI hooks loading and callback execution |
| `packages/shared/src/agent/claude-agent.ts` | **Modify** (~line 1257) | Merge CLI hooks into SDK hooks pipeline |

---

### Task 1: Create `cli-hooks.ts` — Settings Parser + Command Executor

**Files:**
- Create: `packages/shared/src/automations/cli-hooks.ts`
- Test: `packages/shared/src/automations/__tests__/cli-hooks.test.ts`

The module does two things:
1. Reads `~/.claude/settings.json`, extracts hooks with `type: "command"`
2. Converts each to an `SdkAutomationCallbackMatcher` that spawns the command and pipes event data via stdin

- [ ] **Step 1: Write the test file with core test cases**

```typescript
// packages/shared/src/automations/__tests__/cli-hooks.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadCliHooks, replaceSource } from '../cli-hooks.ts';

describe('cli-hooks', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-hooks-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('replaceSource', () => {
    it('should replace --source=claude with --source=craft-agents', () => {
      expect(replaceSource('/path/to/bridge --source=claude'))
        .toBe('/path/to/bridge --source=craft-agents');
    });

    it('should replace --source claude with --source craft-agents', () => {
      expect(replaceSource('/path/to/bridge --source claude'))
        .toBe('/path/to/bridge --source craft-agents');
    });

    it('should leave commands without --source unchanged', () => {
      expect(replaceSource('/path/to/script.sh'))
        .toBe('/path/to/script.sh');
    });
  });

  describe('loadCliHooks', () => {
    it('should return empty object when settings file does not exist', () => {
      const result = loadCliHooks(join(tempDir, 'nonexistent.json'));
      expect(result).toEqual({});
    });

    it('should return empty object when no hooks in settings', () => {
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({ permissions: {} }));
      const result = loadCliHooks(join(tempDir, 'settings.json'));
      expect(result).toEqual({});
    });

    it('should parse command hooks and return SdkAutomationCallbackMatcher entries', () => {
      const settings = {
        hooks: {
          Notification: [{
            hooks: [{ command: '/usr/bin/test-bridge --source=claude', type: 'command', timeout: 5 }],
            matcher: '*',
          }],
          Stop: [{
            hooks: [{ command: '/usr/bin/other-bridge', type: 'command' }],
          }],
        },
      };
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings));
      const result = loadCliHooks(join(tempDir, 'settings.json'));

      // Should have entries for both event types
      expect(Object.keys(result)).toContain('Notification');
      expect(Object.keys(result)).toContain('Stop');

      // Each entry should have the correct matcher structure
      expect(result.Notification).toHaveLength(1);
      expect(result.Notification![0].matcher).toBe('*');
      expect(result.Notification![0].hooks).toHaveLength(1);
      expect(typeof result.Notification![0].hooks[0]).toBe('function');

      expect(result.Stop).toHaveLength(1);
      expect(result.Stop![0].hooks).toHaveLength(1);
    });

    it('should skip non-command hook entries', () => {
      const settings = {
        hooks: {
          Notification: [{
            hooks: [{ command: '/usr/bin/bridge', type: 'command' }],
            matcher: '*',
          }],
        },
      };
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings));
      const result = loadCliHooks(join(tempDir, 'settings.json'));
      expect(result.Notification).toHaveLength(1);
    });

    it('should handle malformed JSON gracefully', () => {
      writeFileSync(join(tempDir, 'settings.json'), '{ broken json');
      const result = loadCliHooks(join(tempDir, 'settings.json'));
      expect(result).toEqual({});
    });

    it('should merge multiple matchers for same event', () => {
      const settings = {
        hooks: {
          PreToolUse: [
            { hooks: [{ command: '/usr/bin/bridge-a --source=claude', type: 'command' }], matcher: 'Bash' },
            { hooks: [{ command: '/usr/bin/bridge-b --source claude', type: 'command' }], matcher: '*' },
          ],
        },
      };
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings));
      const result = loadCliHooks(join(tempDir, 'settings.json'));
      expect(result.PreToolUse).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/automations/__tests__/cli-hooks.test.ts`
Expected: FAIL — module `../cli-hooks.ts` not found

- [ ] **Step 3: Implement `cli-hooks.ts`**

```typescript
// packages/shared/src/automations/cli-hooks.ts
/**
 * CLI Hooks — 读取 ~/.claude/settings.json 的 command hooks，
 * 转换为 SDK hook 回调，使 Craft Agents 能通知 Vibehood/Vibe Island 等外部应用。
 *
 * [INPUT]: 依赖 ~/.claude/settings.json 的 hooks 配置
 * [OUTPUT]: 对外提供 loadCliHooks(), replaceSource()
 * [POS]: automations 模块的 CLI 桥接层，被 claude-agent.ts 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, SdkAutomationCallbackMatcher, SdkAutomationInput } from './types.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('cli-hooks');

// ============================================================================
// 源标识替换
// ============================================================================

/** 将 --source=claude 或 --source claude 替换为 craft-agents */
export function replaceSource(command: string): string {
  return command
    .replace(/--source[=\s]claude\b/g, (match) =>
      match.includes('=') ? '--source=craft-agents' : '--source craft-agents'
    );
}

// ============================================================================
// 命令执行
// ============================================================================

/**
 * 生成一个 SDK hook 回调：spawn 命令，将事件 JSON 写入 stdin。
 * 不阻塞 agent — 超时后静默放弃。
 */
function createCommandCallback(
  command: string,
  timeoutSec: number = 10,
): (input: SdkAutomationInput, toolUseId: string, options: { signal?: AbortSignal }) => Promise<{ continue: boolean }> {
  const adjustedCommand = replaceSource(command);

  return async (input, _toolUseId, _options) => {
    try {
      const child = spawn('sh', ['-c', adjustedCommand], {
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: timeoutSec * 1000,
      });

      // 将事件数据写入 stdin
      const payload = JSON.stringify(input);
      child.stdin?.write(payload);
      child.stdin?.end();

      // Fire-and-forget — 不等待完成
      child.on('error', (err) => {
        log.debug(`[cli-hooks] Command error: ${err.message}`);
      });
    } catch (err) {
      log.debug(`[cli-hooks] Failed to spawn: ${err}`);
    }

    return { continue: true };
  };
}

// ============================================================================
// 配置解析
// ============================================================================

/** settings.json 中单个 hook 条目的结构 */
interface SettingsHookEntry {
  command?: string;
  type?: string;
  timeout?: number;
}

/** settings.json 中单个 matcher 条目的结构 */
interface SettingsMatcherEntry {
  hooks?: SettingsHookEntry[];
  matcher?: string;
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
  const filePath = settingsPath ?? join(homedir(), '.claude', 'settings.json');

  if (!existsSync(filePath)) {
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    log.debug(`[cli-hooks] Failed to parse ${filePath}`);
    return {};
  }

  const hooks = parsed.hooks as Record<string, SettingsMatcherEntry[]> | undefined;
  if (!hooks || typeof hooks !== 'object') {
    return {};
  }

  const result: Partial<Record<AgentEvent, SdkAutomationCallbackMatcher[]>> = {};

  for (const [eventName, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue;

    const sdkMatchers: SdkAutomationCallbackMatcher[] = [];

    for (const matcher of matchers) {
      const commandHooks = (matcher.hooks ?? []).filter(
        (h: SettingsHookEntry) => h.type === 'command' && h.command,
      );

      if (commandHooks.length === 0) continue;

      const callbacks = commandHooks.map((h: SettingsHookEntry) =>
        createCommandCallback(h.command!, h.timeout),
      );

      sdkMatchers.push({
        ...(matcher.matcher ? { matcher: matcher.matcher } : {}),
        hooks: callbacks,
      });
    }

    if (sdkMatchers.length > 0) {
      result[eventName as AgentEvent] = sdkMatchers;
    }
  }

  const eventCount = Object.keys(result).length;
  if (eventCount > 0) {
    log.debug(`[cli-hooks] Loaded hooks for ${eventCount} event types`);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && bun test src/automations/__tests__/cli-hooks.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/automations/cli-hooks.ts packages/shared/src/automations/__tests__/cli-hooks.test.ts
git commit -m "feat(automations): add CLI hooks loader — reads ~/.claude/settings.json command hooks"
```

---

### Task 2: Integrate CLI Hooks into ClaudeAgent

**Files:**
- Modify: `packages/shared/src/agent/claude-agent.ts` (~line 1257-1270, the hooks merge section)

- [ ] **Step 1: Add import for loadCliHooks**

At the top of `claude-agent.ts`, near the other automation imports, add:

```typescript
import { loadCliHooks } from '../automations/cli-hooks.ts';
```

- [ ] **Step 2: Merge CLI hooks after user hooks merge**

Find the hook merge section (around line 1257). After the existing user hooks merge loop, add CLI hooks merge:

```typescript
          // ─── Existing code (do not modify) ─────────────────────
          // Merge internal hooks with user hooks from automations.json
          // Internal hooks run first (permissions), then user hooks
          const mergedHooks: Record<string, SdkAutomationCallbackMatcher[]> = { ...internalHooks };
          for (const [event, matchers] of Object.entries(userHooks) as [string, SdkAutomationCallbackMatcher[]][]) {
            if (!matchers) continue;
            if (mergedHooks[event]) {
              mergedHooks[event] = [...mergedHooks[event]!, ...matchers];
            } else {
              mergedHooks[event] = matchers;
            }
          }

          // ─── NEW: Merge CLI hooks from ~/.claude/settings.json ───
          // Enables Vibehood, Vibe Island, and other CLI hook apps
          const cliHooks = loadCliHooks();
          for (const [event, matchers] of Object.entries(cliHooks) as [string, SdkAutomationCallbackMatcher[]][]) {
            if (!matchers) continue;
            if (mergedHooks[event]) {
              mergedHooks[event] = [...mergedHooks[event]!, ...matchers];
            } else {
              mergedHooks[event] = matchers;
            }
          }

          return mergedHooks;
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck` (from repo root)
Expected: PASS with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/agent/claude-agent.ts
git commit -m "feat(agent): integrate CLI hooks — Vibehood/Vibe Island bridge support"
```

---

### Task 3: Build, Patch, and Verify

**Files:** None (build + manual verification)

- [ ] **Step 1: Build the renderer**

```bash
export https_proxy=http://127.0.0.1:7893
export http_proxy=http://127.0.0.1:7893
bun run --filter '@craft-agent/electron' build:renderer
```

Expected: Build completes without errors

- [ ] **Step 2: Patch the running app**

```bash
bash patch-app.sh
```

Expected: "=== Done! ===" output

- [ ] **Step 3: Manual verification**

1. Quit Craft Agents (Cmd+Q) and reopen
2. Start a new session, send a message
3. Check if Vibehood/Vibe Island show activity from Craft Agents
4. Verify the source shows as `craft-agents` (not `claude`)

- [ ] **Step 4: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: verify CLI hooks integration works end-to-end"
```
