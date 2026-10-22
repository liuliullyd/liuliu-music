export interface RotaryGesture {
  value: number;
  angle?: number;
}
const angleAt = (x: number, y: number, radius: number) =>
  Math.hypot(x, y) < radius * 0.2
    ? undefined
    : (Math.atan2(y, x) * 180) / Math.PI;
export const beginRotaryGesture = (
  value: number,
  x: number,
  y: number,
  radius: number,
): RotaryGesture => ({ value, angle: angleAt(x, y, radius) });
/** Incremental unwrapped angles preserve direction across the seam and at clamped endpoints. */
export function moveRotaryGesture(
  state: RotaryGesture,
  x: number,
  y: number,
  radius: number,
): RotaryGesture {
  const angle = angleAt(x, y, radius);
  if (angle === undefined || state.angle === undefined)
    return { value: state.value, angle };
  const delta = ((angle - state.angle + 540) % 360) - 180;
  return {
    value: Math.max(0, Math.min(100, state.value + (delta / 270) * 100)),
    angle,
  };
}
