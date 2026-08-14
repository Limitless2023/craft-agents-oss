/**
 * [INPUT]: 依赖 jotai/utils 的 atomWithStorage
 * [OUTPUT]: trajectoryPanelWidthAtom（右栏宽度，localStorage 持久化）+ 三个宽度约束常量
 * [POS]: 轨迹视图右栏（详情/构成共用同一槽位）的宽度偏好。与 preview-outline-pinned 同族：
 *        持久布局偏好走 atomWithStorage，跨重启保留——拖宽是为了读系统提示词那种长文本，
 *        每次重开都要重拖是纯粹的折磨。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atomWithStorage } from 'jotai/utils'

/** 右栏默认宽度：够看构成条与注入块排行，不够看长文本——所以才要能拖。 */
export const TRAJECTORY_PANEL_DEFAULT_WIDTH = 360
/** 右栏下限：再窄字段名与值就要换行成两行，读起来比不显示还费劲。 */
export const TRAJECTORY_PANEL_MIN_WIDTH = 280
/** 左侧事件流保底宽度：工具行是 `名字 {入参} → 结果` 三段式，再挤就只剩省略号。 */
export const TRAJECTORY_LIST_MIN_WIDTH = 320

export const trajectoryPanelWidthAtom = atomWithStorage(
  'craft-trajectory-panel-width-v1',
  TRAJECTORY_PANEL_DEFAULT_WIDTH,
)
