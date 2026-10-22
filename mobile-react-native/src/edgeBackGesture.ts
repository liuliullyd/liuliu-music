export const EDGE_BACK_ZONE = 32;
export const EDGE_BACK_TRIGGER = 64;
export type EdgeBackSide = 'left' | 'right';

export function isEdgeBackStart(viewportWidth: number, startX: number) {
  return startX <= EDGE_BACK_ZONE || startX >= viewportWidth - EDGE_BACK_ZONE;
}

export function shouldStartEdgeBack(
  viewportWidth: number,
  startX: number,
  dx: number,
  dy: number,
) {
  const fromLeft = startX <= EDGE_BACK_ZONE;
  const fromRight = startX >= viewportWidth - EDGE_BACK_ZONE;
  if (!isEdgeBackStart(viewportWidth, startX)) return false;
  return shouldStartEdgeBackFrom(
    fromLeft ? 'left' : fromRight ? 'right' : 'left',
    dx,
    dy,
  );
}

export function shouldStartEdgeBackFrom(
  side: EdgeBackSide,
  dx: number,
  dy: number,
) {
  const movingInward =
    side === 'left' ? dx > EDGE_BACK_TRIGGER / 4 : dx < -EDGE_BACK_TRIGGER / 4;
  return movingInward && Math.abs(dx) > Math.abs(dy);
}

export function completedEdgeBack(
  viewportWidth: number,
  startX: number,
  dx: number,
  dy: number,
) {
  const fromLeft = startX <= EDGE_BACK_ZONE;
  const fromRight = startX >= viewportWidth - EDGE_BACK_ZONE;
  if (!fromLeft && !fromRight) return false;
  return completedEdgeBackFrom(fromLeft ? 'left' : 'right', dx, dy);
}

export function completedEdgeBackFrom(
  side: EdgeBackSide,
  dx: number,
  dy: number,
) {
  const completed =
    side === 'left' ? dx >= EDGE_BACK_TRIGGER : dx <= -EDGE_BACK_TRIGGER;
  return completed && Math.abs(dx) > Math.abs(dy);
}
