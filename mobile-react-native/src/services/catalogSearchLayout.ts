/** Keep both measured actions and the input inside the horizontal viewport. */
export function catalogSearchInputWidth(viewport: number, actions: number) {
  return Math.min(210, Math.max(0, viewport - 36 - actions));
}

export function catalogSearchScrollOffset(
  viewport: number,
  content: number,
  current: number,
  anchorX: number,
  anchorWidth: number,
) {
  let next = current;
  if (anchorX < next + 18) next = anchorX - 18;
  if (anchorX + anchorWidth > next + viewport - 18)
    next = anchorX + anchorWidth - viewport + 18;
  return Math.max(0, Math.min(Math.max(0, content - viewport), next));
}
