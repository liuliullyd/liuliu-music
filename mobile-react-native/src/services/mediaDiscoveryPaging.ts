import type { OnlineProvider } from './onlineCatalog';
export interface MediaStream<T> {
  page: number;
  buffer: T[];
  exhausted: boolean;
}
export interface MediaCursor<T> {
  streams: Record<string, MediaStream<T>>;
  seen: string[];
  turn: number;
  randomSeed?: number;
  nested?: MediaCursor<unknown>;
  signal?: AbortSignal;
  onProgress?(items: T[], cursor: MediaCursor<T>): void;
}
export const createMediaCursor = <T>(): MediaCursor<T> => ({
  streams: {},
  seen: [],
  turn: 0,
});
export const copyMediaCursor = <T>(cursor: MediaCursor<T>): MediaCursor<T> => ({
  streams: Object.fromEntries(
    Object.entries(cursor.streams).map(([key, stream]) => [
      key,
      { ...stream, buffer: [...stream.buffer] },
    ]),
  ),
  seen: [...cursor.seen],
  turn: cursor.turn,
  ...(cursor.randomSeed === undefined ? {} : { randomSeed: cursor.randomSeed }),
  ...(cursor.nested ? { nested: copyMediaCursor(cursor.nested) } : {}),
});
export function interleaveMediaStreams<T>(groups: T[][]): T[] {
  const result: T[] = [];
  const width = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < width; index += 1)
    for (const group of groups)
      if (group[index] !== undefined) result.push(group[index]!);
  return result;
}
function drainMediaBuffers<T>(
  cursor: MediaCursor<T>,
  streams: {
    key: string;
  }[],
  seen: Set<string>,
  items: T[],
  limit: number,
  keyOf: (item: T) => string,
) {
  let consumed = true;
  while (items.length < limit && consumed) {
    consumed = false;
    for (
      let index = 0;
      index < streams.length && items.length < limit;
      index += 1
    ) {
      const stream = streams[cursor.turn % streams.length]!;
      cursor.turn = (cursor.turn + 1) % streams.length;
      const state = cursor.streams[stream.key]!;
      while (state.buffer.length) {
        const item = state.buffer.shift()!;
        const key = keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        consumed = true;
        break;
      }
    }
  }
}
const externalPlatform =
  /喜马拉雅|ximalaya|himalaya|蜻蜓\s*(?:fm|FM)|荔枝\s*(?:fm|FM)/i;
export const hasExternalMediaOrigin = (value: unknown) =>
  externalPlatform.test(JSON.stringify(value));
const otherPage = /儿童|儿歌|童谣|宝宝|睡前童话|AI\s*(?:歌曲|音乐|翻唱)/i;
export const mediaHasMore = <T>(cursor: MediaCursor<T>) =>
  Object.values(cursor.streams).some(
    stream => stream.buffer.length > 0 || !stream.exhausted,
  );
// A cursor belongs to one mounted surface. Callers commit a copy only when its
// refresh generation still owns the request. Unshown upstream items are retained.
export async function takeMediaBatch<T>(
  cursor: MediaCursor<T>,
  streams: Array<{
    key: string;
    provider: OnlineProvider;
    query: string;
  }>,
  limit: number,
  keyOf: (item: T) => string,
  fetchPage: (
    stream: {
      provider: OnlineProvider;
      query: string;
    },
    page: number,
    size: number,
    reportProgress: (items: T[]) => void,
  ) => Promise<{
    items: T[];
    errors: string[];
    rawCount?: number;
  }>,
  options: {
    maxRounds?: number;
    tolerateErrors?: boolean;
    randomize?: boolean;
    fetchAttempts?: number;
  } = {},
) {
  if (!streams.length)
    throw new Error('本次通过启动检测的平台没有此类内容接口');
  const seen = new Set(cursor.seen);
  const items: T[] = [];
  const errors: string[] = [];
  const failed = new Set<string>();
  const reported = new Map<string, T[]>();
  for (const stream of streams)
    cursor.streams[stream.key] ??= { page: 0, buffer: [], exhausted: false };
  const publishProgress = () => {
    if (!cursor.onProgress || cursor.signal?.aborted) return;
    const preview = copyMediaCursor(cursor);
    for (const [key, values] of reported)
      preview.streams[key].buffer = [...values];
    const previewSeen = new Set(seen);
    const previewItems = [...items];
    drainMediaBuffers(
      preview,
      streams,
      previewSeen,
      previewItems,
      limit,
      keyOf,
    );
    preview.seen = [...previewSeen];
    if (previewItems.length) cursor.onProgress(previewItems, preview);
  };
  // Bound work on a provider that repeatedly returns duplicates. Its cursor is
  // retained for a later gesture; a short/filtered batch is never treated as EOF.
  const maxRounds = Math.max(1, options.maxRounds ?? 3);
  for (let round = 0; round < maxRounds && items.length < limit; round += 1) {
    if (cursor.signal?.aborted)
      throw Object.assign(new Error('媒体请求已取消'), { name: 'AbortError' });
    const candidates = [
      ...streams.slice(cursor.turn),
      ...streams.slice(0, cursor.turn),
    ]
      .filter(stream => {
        const state = cursor.streams[stream.key]!;
        return (
          !state.buffer.length && !state.exhausted && !failed.has(stream.key)
        );
      })
      .slice(0, Math.min(10, limit - items.length));
    await Promise.all(
      candidates.map(async stream => {
        const state = cursor.streams[stream.key]!;
        if (state.buffer.length || state.exhausted || failed.has(stream.key))
          return;
        let result:
          | {
              items: T[];
              errors: string[];
              rawCount?: number;
            }
          | undefined;
        for (
          let attempt = 0;
          attempt < (options.fetchAttempts ?? 2);
          attempt += 1
        ) {
          try {
            result = await fetchPage(stream, state.page + 1, 30, values => {
              reported.set(stream.key, values);
              publishProgress();
            });
            if (result.items.length || !result.errors.length) break;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.warn(
              '[media-page-error]',
              JSON.stringify({
                key: stream.key,
                provider: stream.provider,
                page: state.page + 1,
                message,
              }),
            );
            result = {
              items: [],
              errors: [message],
            };
          }
        }
        reported.delete(stream.key);
        if (!result || cursor.signal?.aborted) return;
        errors.push(...result.errors);
        if (!result.items.length && result.errors.length) {
          failed.add(stream.key);
          if (options.tolerateErrors) state.exhausted = true;
          return;
        }
        state.page += 1;
        state.exhausted = (result.rawCount ?? result.items.length) === 0;
        const additions = result.items.filter(item => !seen.has(keyOf(item)));
        if (options.randomize) {
          for (let index = additions.length - 1; index > 0; index -= 1) {
            cursor.randomSeed ??= Math.floor(Math.random() * 0xffffffff) >>> 0;
            cursor.randomSeed =
              (cursor.randomSeed * 1664525 + 1013904223) >>> 0;
            const swap = cursor.randomSeed % (index + 1);
            [additions[index], additions[swap]] = [
              additions[swap]!,
              additions[index]!,
            ];
          }
        }
        state.buffer.push(...additions);
        publishProgress();
      }),
    );
    if (cursor.signal?.aborted)
      throw Object.assign(new Error('媒体请求已取消'), { name: 'AbortError' });
    drainMediaBuffers(cursor, streams, seen, items, limit, keyOf);
    if (!mediaHasMore(cursor)) break;
  }
  cursor.seen = [...seen];
  console.info(
    '[media-page]',
    JSON.stringify({
      streams: streams.map(stream => ({
        key: stream.key,
        page: cursor.streams[stream.key]?.page,
        remaining: cursor.streams[stream.key]?.buffer.length,
      })),
      count: items.length,
      seen: seen.size,
      errors: errors.length,
    }),
  );
  if (!items.length && errors.length && !options.tolerateErrors)
    throw new Error(errors.join('；'));
  return { items, errors, hasMore: mediaHasMore(cursor) };
}
