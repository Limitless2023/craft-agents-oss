import * as React from 'react'

export type GlimmerMode = 'requesting' | 'thinking' | 'responding' | 'tool_use'

export interface GlimmerTextProps {
  /** Text to display with glimmer effect */
  text: string
  /** Animation mode — controls speed, direction, and color */
  mode: GlimmerMode
  /** Animation time in ms (from useAnimationLoop) */
  time: number
  /** Stalled intensity 0-1 (0 = normal, 1 = fully red) */
  stalledIntensity?: number
  /** Flash opacity for tool_use sine pulse (0-1) */
  flashOpacity?: number
  /** Thinking shimmer opacity (0-1) */
  thinkingOpacity?: number
}

/**
 * GlimmerText — Text with a scanning shimmer highlight.
 *
 * Uses CSS background-clip: text with a linear gradient that shifts
 * via a CSS custom property updated on each animation frame.
 *
 * Port of Claude Code's GlimmerMessage for DOM/CSS (no per-char rendering needed).
 */
export function GlimmerText({
  text,
  mode,
  time,
  stalledIntensity = 0,
  flashOpacity = 0,
  thinkingOpacity = 0,
}: GlimmerTextProps) {
  // Glimmer position calculation (matches Claude Code SpinnerAnimationRow)
  const textLength = text.length
  const cycleLength = textLength + 20
  const glimmerSpeed = mode === 'requesting' ? 50 : 200
  const cyclePosition = Math.floor(time / glimmerSpeed)

  // Direction: requesting goes left→right, others right→left
  const glimmerIndex = mode === 'requesting'
    ? (cyclePosition % cycleLength) - 10
    : textLength + 10 - (cyclePosition % cycleLength)

  // Convert char index to percentage
  const glimmerPercent = textLength > 0 ? (glimmerIndex / textLength) * 100 : -20
  const shimmerWidth = 15 // percentage width of the shimmer band

  // Color selection based on mode and stalled state
  let baseColor: string
  let shimmerColor: string

  // Exact Claude Code theme colors (from src/utils/theme.ts)
  const ORANGE     = [215, 119, 87] as const   // claude orange
  const ORANGE_HI  = [245, 149, 117] as const  // claudeShimmer
  const ERROR_RED  = [171, 43, 63]  as const   // stalled red
  const GRAY       = [153, 153, 153] as const  // thinking base
  const GRAY_HI    = [185, 185, 185] as const  // thinking shimmer

  if (stalledIntensity > 0) {
    // Interpolate toward red
    const r = Math.round(ORANGE[0] + (ERROR_RED[0] - ORANGE[0]) * stalledIntensity)
    const g = Math.round(ORANGE[1] + (ERROR_RED[1] - ORANGE[1]) * stalledIntensity)
    const b = Math.round(ORANGE[2] + (ERROR_RED[2] - ORANGE[2]) * stalledIntensity)
    baseColor = `rgb(${r}, ${g}, ${b})`
    shimmerColor = baseColor // No shimmer when stalled
  } else if (mode === 'thinking') {
    // Gray tones with breathing shimmer
    const r = Math.round(GRAY[0] + (GRAY_HI[0] - GRAY[0]) * thinkingOpacity)
    const g = Math.round(GRAY[1] + (GRAY_HI[1] - GRAY[1]) * thinkingOpacity)
    const b = Math.round(GRAY[2] + (GRAY_HI[2] - GRAY[2]) * thinkingOpacity)
    baseColor = `rgb(${GRAY[0]}, ${GRAY[1]}, ${GRAY[2]})`
    shimmerColor = `rgb(${r}, ${g}, ${b})`
  } else if (mode === 'tool_use' && flashOpacity > 0) {
    // Sine pulse between base and shimmer
    const r = Math.round(ORANGE[0] + (ORANGE_HI[0] - ORANGE[0]) * flashOpacity)
    const g = Math.round(ORANGE[1] + (ORANGE_HI[1] - ORANGE[1]) * flashOpacity)
    const b = Math.round(ORANGE[2] + (ORANGE_HI[2] - ORANGE[2]) * flashOpacity)
    baseColor = `rgb(${r}, ${g}, ${b})`
    shimmerColor = baseColor // Whole text pulses
  } else {
    // Default: warm orange
    baseColor = `rgb(${ORANGE[0]}, ${ORANGE[1]}, ${ORANGE[2]})`
    shimmerColor = `rgb(${ORANGE_HI[0]}, ${ORANGE_HI[1]}, ${ORANGE_HI[2]})`
  }

  // Only set the dynamic gradient here — background-clip: text is in CSS class
  // (.agent-glimmer-text in index.css) because inline backgroundClip is unreliable in Electron
  const style: React.CSSProperties = {
    background: `linear-gradient(90deg, ${baseColor} 0%, ${baseColor} ${glimmerPercent - shimmerWidth / 2}%, ${shimmerColor} ${glimmerPercent}%, ${baseColor} ${glimmerPercent + shimmerWidth / 2}%, ${baseColor} 100%)`,
  }

  return (
    <span className="agent-glimmer-text" style={style}>
      {text}
    </span>
  )
}
