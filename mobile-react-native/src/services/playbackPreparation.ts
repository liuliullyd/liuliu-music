import type { Track } from '../domain/types';

export type PreparedTrack = Track & { playUrl: string };
export type PrepareValidatedTrack = (track: Track) => Promise<PreparedTrack>;

export interface FirstResolvableTrackOptions {
  budgetMs?: number;
  attemptTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('启动首曲预解析超时')),
      Math.max(0, timeoutMs),
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function selectFirstResolvableTrack<T extends Track>(
  tracks: Track[],
  resolveTrack: (track: Track) => Promise<T>,
  options: FirstResolvableTrackOptions = {},
) {
  let lastError: unknown = new Error('启动推荐没有可用歌曲');
  const deadline = Number.isFinite(options.budgetMs)
    ? Date.now() + Math.max(0, options.budgetMs ?? 0)
    : Number.POSITIVE_INFINITY;
  for (let index = 0; index < tracks.length; index += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const selected = await withTimeout(
        resolveTrack(tracks[index]),
        Math.min(
          remaining,
          options.attemptTimeoutMs ?? Number.POSITIVE_INFINITY,
        ),
      );
      return {
        selected,
        index,
        tracks: [selected, ...tracks.slice(index + 1)],
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function prepareValidatedTracks(
  tracks: Track[],
  prepareTrack: PrepareValidatedTrack,
  concurrency = 1,
  shouldContinue = () => true,
) {
  const settled = await prepareTrackResults(
    tracks,
    prepareTrack,
    concurrency,
    shouldContinue,
  );
  return settled.flatMap(result => (result ? [result] : []));
}

async function prepareTrackResults(
  tracks: Track[],
  prepareTrack: PrepareValidatedTrack,
  concurrency: number,
  shouldContinue = () => true,
) {
  const results: Array<PreparedTrack | undefined> = new Array(tracks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tracks.length && shouldContinue()) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await prepareTrack(tracks[index]);
      } catch {}
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(tracks.length, Math.max(1, concurrency)) },
      worker,
    ),
  );
  return results;
}
