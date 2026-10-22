/**
 * A source change can finish while the previous launch probe is still in
 * flight. Only the result belonging to the current source configuration may
 * update the platform binding/cache.
 */
export const isCurrentSourceHealthGeneration = (
  capturedGeneration: number,
  currentGeneration: number,
  cancelled = false,
) => !cancelled && capturedGeneration === currentGeneration;
