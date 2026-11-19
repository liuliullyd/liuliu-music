import type { Track } from '../domain/types';
import { isSourceRateLimited } from './playbackSourceAvailability';

export type PreparedTrack = Track & { playUrl: string };
export type PrepareValidatedTrack = (track: Track) => Promise<PreparedTrack>;

export interface FirstResolvableTrackOptions {
  signal?: AbortSignal;
}

export async function selectFirstResolvableTrack<T extends Track>(
  tracks: Track[],
  resolveTrack: (track: Track, signal: AbortSignal) => Promise<T>,
  options: FirstResolvableTrackOptions = {},
) {
  let lastError: unknown = new Error('启动推荐没有可用歌曲');
  const controller = new AbortController();
  let rejectAbort!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort();
    const error = new Error('启动首曲预解析已取消');
    error.name = 'AbortError';
    rejectAbort(error);
  };
  const checkAbort = () => {
    if (!options.signal?.aborted) return;
    const error = new Error('启动首曲预解析已取消');
    error.name = 'AbortError';
    throw error;
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort();
    for (let index = 0; index < tracks.length; index += 1) {
      try {
        const selected = await Promise.race([resolveTrack(tracks[index], controller.signal), stopped]);
        checkAbort();
        return { selected, index, tracks: [selected, ...tracks.slice(index + 1)] };
      } catch (error) {
        checkAbort();
        if (isSourceRateLimited(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
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
