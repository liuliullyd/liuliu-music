export class PlayerRequestCancelled extends Error {
  constructor() {
    super('Player request superseded');
  }
}

/** Abandon an old selection without waiting for its network request to finish. */
export function waitForPlayerRequest<T>(
  request: Promise<T>,
  signal: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new PlayerRequestCancelled());
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    request.then(
      value => {
        signal.removeEventListener('abort', cancel);
        if (!signal.aborted) resolve(value);
      },
      error => {
        signal.removeEventListener('abort', cancel);
        if (!signal.aborted) reject(error);
      },
    );
  });
}

/** Explicit navigation leaves repeat-one, but shuffle still spans the logical queue. */
export function manualPlayerTarget(
  index: number,
  length: number,
  direction: -1 | 1,
  settings: { shuffle: boolean; repeat: 'off' | 'all' | 'one' },
  random = Math.random,
) {
  if (settings.shuffle && settings.repeat !== 'one' && length > 0) {
    if (length === 1) return 0;
    return (index + 1 + Math.floor(random() * (length - 1))) % length;
  }
  return index + direction;
}

export function automaticPlayerTarget(
  index: number,
  length: number,
  hasMore: boolean,
  settings: {
    autoNext: boolean;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
  },
  random = Math.random,
) {
  if (!settings.autoNext || !length) return null;
  if (settings.repeat === 'one') return index;
  if (settings.shuffle && length > 1) {
    const offset = 1 + Math.floor(random() * (length - 1));
    return (index + offset) % length;
  }
  if (index + 1 < length || hasMore) return index + 1;
  return settings.repeat === 'all' ? 0 : null;
}
