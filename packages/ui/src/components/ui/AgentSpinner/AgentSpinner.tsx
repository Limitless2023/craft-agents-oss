import * as React from 'react'
import { useRef, useState } from 'react'
import { GlimmerText, type GlimmerMode } from './GlimmerText'
import { useAnimationLoop } from './useAnimationLoop'

// Spinner characters — forward + reverse for breathing effect
const SPINNER_CHARS = ['·', '✢', '✳', '✶', '✻', '✽']
const SPINNER_FRAMES = [...SPINNER_CHARS, ...SPINNER_CHARS.slice().reverse()]

// 187 playful verbs from Claude Code (src/constants/spinnerVerbs.ts)
// One is picked randomly per mount (per turn) and stays for the entire turn.
const SPINNER_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Architecting', 'Baking', 'Beaming',
  "Beboppin'", 'Befuddling', 'Billowing', 'Blanching', 'Bloviating', 'Boogieing',
  'Boondoggling', 'Booping', 'Bootstrapping', 'Brewing', 'Bunning', 'Burrowing',
  'Calculating', 'Canoodling', 'Caramelizing', 'Cascading', 'Catapulting', 'Cerebrating',
  'Channeling', 'Channelling', 'Choreographing', 'Churning', 'Clauding', 'Coalescing',
  'Cogitating', 'Combobulating', 'Composing', 'Computing', 'Concocting', 'Considering',
  'Contemplating', 'Cooking', 'Crafting', 'Creating', 'Crunching', 'Crystallizing',
  'Cultivating', 'Deciphering', 'Deliberating', 'Determining', 'Dilly-dallying',
  'Discombobulating', 'Doing', 'Doodling', 'Drizzling', 'Ebbing', 'Effecting',
  'Elucidating', 'Embellishing', 'Enchanting', 'Envisioning', 'Evaporating', 'Fermenting',
  'Fiddle-faddling', 'Finagling', 'Flambéing', 'Flibbertigibbeting', 'Flowing',
  'Flummoxing', 'Fluttering', 'Forging', 'Forming', 'Frolicking', 'Frosting',
  'Gallivanting', 'Galloping', 'Garnishing', 'Generating', 'Gesticulating', 'Germinating',
  'Gitifying', 'Grooving', 'Gusting', 'Harmonizing', 'Hashing', 'Hatching', 'Herding',
  'Honking', 'Hullaballooing', 'Hyperspacing', 'Ideating', 'Imagining', 'Improvising',
  'Incubating', 'Inferring', 'Infusing', 'Ionizing', 'Jitterbugging', 'Julienning',
  'Kneading', 'Leavening', 'Levitating', 'Lollygagging', 'Manifesting', 'Marinating',
  'Meandering', 'Metamorphosing', 'Misting', 'Moonwalking', 'Moseying', 'Mulling',
  'Mustering', 'Musing', 'Nebulizing', 'Nesting', 'Newspapering', 'Noodling', 'Nucleating',
  'Orbiting', 'Orchestrating', 'Osmosing', 'Perambulating', 'Percolating', 'Perusing',
  'Philosophising', 'Photosynthesizing', 'Pollinating', 'Pondering', 'Pontificating',
  'Pouncing', 'Precipitating', 'Prestidigitating', 'Processing', 'Proofing', 'Propagating',
  'Puttering', 'Puzzling', 'Quantumizing', 'Razzle-dazzling', 'Razzmatazzing',
  'Recombobulating', 'Reticulating', 'Roosting', 'Ruminating', 'Sautéing', 'Scampering',
  'Schlepping', 'Scurrying', 'Seasoning', 'Shenaniganing', 'Shimmying', 'Simmering',
  'Skedaddling', 'Sketching', 'Slithering', 'Smooshing', 'Sock-hopping', 'Spelunking',
  'Spinning', 'Sprouting', 'Stewing', 'Sublimating', 'Swirling', 'Swooping', 'Symbioting',
  'Synthesizing', 'Tempering', 'Thinking', 'Thundering', 'Tinkering', 'Tomfoolering',
  'Topsy-turvying', 'Transfiguring', 'Transmuting', 'Twisting', 'Undulating', 'Unfurling',
  'Unravelling', 'Vibing', 'Waddling', 'Wandering', 'Warping', 'Whatchamacalliting',
  'Whirlpooling', 'Whirring', 'Whisking', 'Wibbling', 'Working', 'Wrangling', 'Zesting',
  'Zigzagging',
]

// Stalled detection thresholds (ms)
const STALLED_THRESHOLD = 3000
const STALLED_FADE_DURATION = 2000

// Thinking shimmer parameters
const THINKING_DELAY_MS = 3000
const THINKING_GLOW_PERIOD_S = 2

/**
 * Format elapsed time: "45s" under a minute, "1:02" for 1+ minutes
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export interface AgentSpinnerProps {
  /** Agent streaming state — controls animation (color, speed, glow), not text */
  mode: GlimmerMode
  /** Start timestamp for elapsed time */
  startTime?: number
  /** Current response text length (for stalled detection) */
  responseLength?: number
  /** Whether there are active tool calls (suppresses stalled red) */
  hasActiveTools?: boolean
  /** System override (e.g., "Compacting conversation…") — highest priority, overrides random verb */
  statusMessage?: string
}

/**
 * AgentSpinner — Animated status indicator ported from Claude Code.
 *
 * Text priority (matches Claude Code Spinner.tsx:168-170):
 *   overrideMessage (system) > todo.activeForm > randomVerb
 * Mode only affects animation style, never the displayed text.
 *
 * Uses U+2026 (…) not three dots (...) per Claude Code spec.
 */
export function AgentSpinner({
  mode,
  startTime,
  responseLength = 0,
  hasActiveTools = false,
  statusMessage,
}: AgentSpinnerProps) {
  const time = useAnimationLoop(50)

  // Pick a new random verb each time mode changes.
  // In Claude Code, the spinner unmounts/remounts between API roundtrips
  // (tool execution → new API call), picking a new verb each time.
  // We simulate this by re-picking when mode transitions.
  const pickVerb = () => SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)] + '\u2026'
  const [randomVerb, setRandomVerb] = useState(pickVerb)
  const prevModeRef = useRef(mode)
  if (mode !== prevModeRef.current) {
    prevModeRef.current = mode
    setRandomVerb(pickVerb())
  }

  // Spinner glyph frame (120ms per frame)
  const frame = Math.floor(time / 120) % SPINNER_FRAMES.length
  const spinnerChar = SPINNER_FRAMES[frame]

  // Stalled detection (smoothed)
  const lastTokenTimeRef = useRef(time)
  const lastResponseLengthRef = useRef(responseLength)
  const stalledIntensityRef = useRef(0)

  if (responseLength > lastResponseLengthRef.current) {
    lastTokenTimeRef.current = time
    lastResponseLengthRef.current = responseLength
    stalledIntensityRef.current = 0
  }

  let timeSinceLastToken: number
  if (hasActiveTools) {
    timeSinceLastToken = 0
    lastTokenTimeRef.current = time
  } else if (responseLength > 0) {
    timeSinceLastToken = time - lastTokenTimeRef.current
  } else {
    timeSinceLastToken = 0
  }

  const isStalled = timeSinceLastToken > STALLED_THRESHOLD && !hasActiveTools
  const targetIntensity = isStalled
    ? Math.min((timeSinceLastToken - STALLED_THRESHOLD) / STALLED_FADE_DURATION, 1)
    : 0

  // Exponential smoothing (10% per 50ms frame)
  const diff = targetIntensity - stalledIntensityRef.current
  if (Math.abs(diff) < 0.01) {
    stalledIntensityRef.current = targetIntensity
  } else {
    stalledIntensityRef.current += diff * 0.1
  }
  const stalledIntensity = stalledIntensityRef.current

  // Thinking breathing glow
  let thinkingOpacity = 0
  if (mode === 'thinking' && time > THINKING_DELAY_MS) {
    const elapsed = (time - THINKING_DELAY_MS) / 1000
    thinkingOpacity = (Math.sin(elapsed * Math.PI * 2 / THINKING_GLOW_PERIOD_S) + 1) / 2
  }

  // Tool-use sine pulse
  const flashOpacity = mode === 'tool_use'
    ? (Math.sin(time / 1000 * Math.PI) + 1) / 2
    : 0

  // Spinner glyph color — exact Claude Code orange (interpolate → red when stalled)
  const glyphR = Math.round(215 + (171 - 215) * stalledIntensity)
  const glyphG = Math.round(119 + (43 - 119) * stalledIntensity)
  const glyphB = Math.round(87 + (63 - 87) * stalledIntensity)
  const glyphColor = mode === 'thinking'
    ? `rgb(${Math.round(153 + (185 - 153) * thinkingOpacity)}, ${Math.round(153 + (185 - 153) * thinkingOpacity)}, ${Math.round(153 + (185 - 153) * thinkingOpacity)})`
    : `rgb(${glyphR}, ${glyphG}, ${glyphB})`

  // Display message — Claude Code priority chain:
  //   statusMessage (system override, e.g. "Compacting…")
  //   > message (tool name, e.g. "Read file…")
  //   > randomVerb (per-turn random, e.g. "Flibbertigibbeting…")
  // Claude Code priority: overrideMessage > todo.activeForm > randomVerb
  // In Craft Agents: statusMessage (system override) > randomVerb
  // TODO: add todo.activeForm override when todo system is wired
  const displayMessage = statusMessage ?? randomVerb

  // Elapsed time
  const elapsedMs = startTime ? Date.now() - startTime : 0

  return (
    <div className="flex items-center gap-2 px-3 py-1 -mb-1 text-[13px]">
      {/* Spinner glyph */}
      <span
        className="w-3 h-3 flex items-center justify-center shrink-0 text-[11px] font-mono"
        style={{ color: glyphColor }}
      >
        {spinnerChar}
      </span>

      {/* Glimmer text + timer */}
      <span className="flex items-center gap-1">
        <GlimmerText
          text={displayMessage}
          mode={mode}
          time={time}
          stalledIntensity={stalledIntensity}
          flashOpacity={flashOpacity}
          thinkingOpacity={thinkingOpacity}
        />
        {elapsedMs >= 1000 && (
          <span className="text-muted-foreground/40 tabular-nums text-[12px]">
            {formatElapsed(elapsedMs)}
          </span>
        )}
      </span>
    </div>
  )
}
