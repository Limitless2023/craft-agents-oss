/**
 * [INPUT]: 依赖 jotai/utils 的 atomWithStorage
 * [OUTPUT]: expandLongResponsesAtom（全局 boolean，localStorage 持久化）
 * [POS]: 聊天回复卡片的高度策略偏好。默认 false = 上游行为（超过 540px 在卡片内
 *        滚动，保持消息列表紧凑）；true = 完全展开，交给页面主滚动条——大屏
 *        （外接显示器）上垂直空间充裕时，卡片内嵌滚动反而割裂阅读。
 *        与 background-finished chip 同款：renderer-only 外观偏好，
 *        atomWithStorage 持久化、多窗口共享、不走 RPC/磁盘配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atomWithStorage } from 'jotai/utils'

/** 长回复是否完全展开（不限高）。默认 false = 保持上游的 540px 内滚。 */
export const expandLongResponsesAtom = atomWithStorage<boolean>(
  'craft-expand-long-responses',
  false
)
