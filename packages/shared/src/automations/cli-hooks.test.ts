import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadCliHooks, replaceSource } from './cli-hooks'

describe('cli-hooks', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-hooks-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('replaceSource', () => {
    it('should replace --source=claude with --source=craft-agents', () => {
      expect(replaceSource('/path/to/bridge --source=claude'))
        .toBe('/path/to/bridge --source=craft-agents')
    })

    it('should replace --source claude with --source craft-agents', () => {
      expect(replaceSource('/path/to/bridge --source claude'))
        .toBe('/path/to/bridge --source craft-agents')
    })

    it('should leave commands without --source unchanged', () => {
      expect(replaceSource('/path/to/script.sh'))
        .toBe('/path/to/script.sh')
    })
  })

  describe('loadCliHooks', () => {
    it('should return empty object when settings file does not exist', () => {
      const result = loadCliHooks(join(tempDir, 'nonexistent.json'))
      expect(result).toEqual({})
    })

    it('should return empty object when no hooks in settings', () => {
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({ permissions: {} }))
      const result = loadCliHooks(join(tempDir, 'settings.json'))
      expect(result).toEqual({})
    })

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
      }
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings))
      const result = loadCliHooks(join(tempDir, 'settings.json'))

      expect(Object.keys(result)).toContain('Notification')
      expect(Object.keys(result)).toContain('Stop')

      expect(result.Notification).toHaveLength(1)
      expect(result.Notification![0].matcher).toBe('*')
      expect(result.Notification![0].hooks).toHaveLength(1)
      expect(typeof result.Notification![0].hooks[0]).toBe('function')

      expect(result.Stop).toHaveLength(1)
      expect(result.Stop![0].hooks).toHaveLength(1)
    })

    it('should skip non-command hook entries', () => {
      const settings = {
        hooks: {
          Notification: [{
            hooks: [{ command: '/usr/bin/bridge', type: 'command' }],
            matcher: '*',
          }],
        },
      }
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings))
      const result = loadCliHooks(join(tempDir, 'settings.json'))
      expect(result.Notification).toHaveLength(1)
    })

    it('should handle malformed JSON gracefully', () => {
      writeFileSync(join(tempDir, 'settings.json'), '{ broken json')
      const result = loadCliHooks(join(tempDir, 'settings.json'))
      expect(result).toEqual({})
    })

    it('should merge multiple matchers for same event', () => {
      const settings = {
        hooks: {
          PreToolUse: [
            { hooks: [{ command: '/usr/bin/bridge-a --source=claude', type: 'command' }], matcher: 'Bash' },
            { hooks: [{ command: '/usr/bin/bridge-b --source claude', type: 'command' }], matcher: '*' },
          ],
        },
      }
      writeFileSync(join(tempDir, 'settings.json'), JSON.stringify(settings))
      const result = loadCliHooks(join(tempDir, 'settings.json'))
      expect(result.PreToolUse).toHaveLength(2)
    })
  })
})
