import type { Track } from '../domain/types';
import { trackQueueKey } from '../domain/types';

/** New remote pages retain their source cursor; reverse queues grow at the head. */
export function extendOrderedQueue(
  current: Track[],
  additions: Track[],
  reversed: boolean,
) {
  return reversed
    ? [...additions].reverse().concat(current)
    : [...current, ...additions];
}

export function queueIndexForKey(
  queue: Track[],
  key: string,
  fallback: number,
) {
  const index = queue.findIndex(track => trackQueueKey(track) === key);
  return index >= 0 ? index : Math.max(0, Math.min(fallback, queue.length - 1));
}
