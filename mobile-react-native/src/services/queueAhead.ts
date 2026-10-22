import { QUEUE_BATCH_SIZE } from './queuePaging';

/** One complete directory batch beyond the currently viewed/playing group. */
export function queueAheadTarget(
  index: number,
  length: number,
  reversed = false,
) {
  const position = reversed
    ? Math.max(0, length - 1 - index)
    : Math.max(0, index);
  return (Math.floor(position / QUEUE_BATCH_SIZE) + 2) * QUEUE_BATCH_SIZE;
}
