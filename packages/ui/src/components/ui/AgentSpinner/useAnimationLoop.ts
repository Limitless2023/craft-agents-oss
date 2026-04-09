import { useState, useEffect, useRef } from 'react'

/**
 * Shared animation clock that ticks at a fixed interval.
 * Returns elapsed time in ms since mount.
 *
 * Pass `null` to pause — time freezes at the last value.
 * Resumes from current wall clock when a number is passed again.
 *
 * @param intervalMs Tick interval (default 50ms). Pass null to pause.
 * @returns Elapsed time in ms since mount
 */
export function useAnimationLoop(intervalMs: number | null = 50): number {
  const [time, setTime] = useState(0)
  const startRef = useRef(performance.now())

  useEffect(() => {
    if (intervalMs === null) return

    const id = setInterval(() => {
      setTime(performance.now() - startRef.current)
    }, intervalMs)

    return () => clearInterval(id)
  }, [intervalMs])

  return time
}
