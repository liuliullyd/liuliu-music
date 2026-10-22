import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import type { OnlineProvider } from './onlineCatalog';

export type MediaKind = 'podcast' | 'audiobook';
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
  cursor: MediaCursor<T>, streams: { key: string }[], seen: Set<string>,
  items: T[], limit: number, keyOf: (item: T) => string,
) {
  let consumed = true;
  while (items.length < limit && consumed) {
    consumed = false;
    for (let index = 0; index < streams.length && items.length < limit; index += 1) {
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

// This table describes implemented typed APIs, not source or health selection.
export function mediaProviders(
  platforms: PlatformSetting[],
  kind: MediaKind,
  collections: boolean,
) {
  // Only implemented typed routes may participate. Enabling a platform does
  // not create a media API; never substitute its ordinary music search.
  // The list is intentionally explicit.  These are the providers for which
  // the mobile typed catalog and episode routes are implemented below; a
  // missing typed route must keep the provider out instead of falling back to
  // ordinary song search.
  const supported =
    kind === 'audiobook'
      ? ['netease', 'qq', 'kugou', 'migu']
      : ['netease', 'qq'];
  return platforms
    .filter(value => value.enabled && supported.includes(value.id))
    .map(value => value.id as OnlineProvider);
}

const externalPlatform =
  /喜马拉雅|ximalaya|himalaya|蜻蜓\s*(?:fm|FM)|荔枝\s*(?:fm|FM)/i;
export const hasExternalMediaOrigin = (value: unknown) =>
  externalPlatform.test(JSON.stringify(value));
const otherPage = /儿童|儿歌|童谣|宝宝|睡前童话|AI\s*(?:歌曲|音乐|翻唱)/i;
export function isMediaEntity(
  item: CatalogItem | Track,
  kind: MediaKind,
  provider: OnlineProvider,
) {
  if (item.provider !== provider || !item.id) return false;
  const declaredType = String(item.metadata?.mediaType ?? '').toLowerCase();
  if (
    (kind === 'podcast' && declaredType !== 'podcast') ||
    (kind === 'audiobook' &&
      !['audiobook', 'long-audio'].includes(declaredType))
  )
    return false;
  const text = JSON.stringify([
    item.title,
    'description' in item ? item.description : item.artist,
    'album' in item ? item.album : '',
    item.cover,
    item.metadata,
  ]);
  if (externalPlatform.test(text) || otherPage.test(text)) return false;
  if (
    kind === 'podcast' &&
    [2001, 10002, 3001, 10001, 13].includes(Number(item.metadata?.categoryId))
  )
    return false;
  if (kind === 'audiobook') {
    if (
      item.metadata?.categoryId !== undefined &&
      ((provider === 'kugou' && Number(item.metadata.categoryId) !== 2) ||
        (provider === 'netease' && Number(item.metadata.categoryId) !== 10001))
    )
      return false;
    if (
      /播客|访谈节目|流行歌曲|音乐专辑|影视原声|电视剧原声|电影原声|电视原声|原声带|街拍必备|小说片段|音乐合集/.test(
        text,
      )
    )
      return false;
    // The upstream album search can contain ordinary music albums. A query
    // label is not evidence that an album is a book.
    if (
      !(
        (provider === 'kugou' && Number(item.metadata?.categoryId) === 2) ||
        (provider === 'netease' && Number(item.metadata?.categoryId) === 10001)
      ) &&
      !/有声|听书|小说|演播|广播剧|玄幻|仙侠|武侠|名著|评书|传记|文学|故事|书籍|本书/.test(
        text,
      )
    )
      return false;
  }
  return true;
}

// Category labels must come from the typed provider payload.  A display title
// or the query used to find a media entity is not evidence that the provider
// classified that entity under the title.
export function mediaCategoryLabels(
  item: CatalogItem,
  kind: MediaKind,
): string[] {
  const metadata = item.metadata ?? {};
  const tagObjects = [
    ...(Array.isArray(metadata.tags) ? metadata.tags : []),
    ...(Array.isArray(metadata.tag_list) ? metadata.tag_list : []),
    ...(Array.isArray(metadata.categories) ? metadata.categories : []),
    ...(Array.isArray(metadata.labels) ? metadata.labels : []),
  ];
  const nestedLabels = [metadata.label_new, metadata.label_new2].flatMap(
    label => {
      const record =
        label && typeof label === 'object'
          ? (label as Record<string, unknown>)
          : null;
      return record && Array.isArray(record.label_list)
        ? record.label_list
        : [];
    },
  );
  const values: unknown[] = [
    metadata.categoryName,
    metadata.category_name,
    metadata.categoryname,
    metadata.secondCategory,
    metadata.second_category,
    metadata.category,
    metadata.classname,
    metadata.className,
    metadata.class_name,
    metadata.tag,
    metadata.tagName,
    metadata.tag_name,
    metadata.typeName,
    metadata.type_name,
    metadata.channelName,
    metadata.channel_name,
    metadata.genre,
    metadata.genreName,
    ...tagObjects,
    ...tagObjects.flatMap(value =>
      value && typeof value === 'object'
        ? (() => {
            const tag = value as Record<string, unknown>;
            return [
              tag.tagName,
              tag.tag_name,
              tag.name,
              tag.title,
              tag.label,
              tag.categoryName,
            ];
          })()
        : [],
    ),
    ...nestedLabels.flatMap(value =>
      value && typeof value === 'object'
        ? (() => {
            const label = value as Record<string, unknown>;
            return [label.tag_text, label.tagName, label.name, label.title];
          })()
        : [],
    ),
    ...(Array.isArray(metadata.categoryNames) ? metadata.categoryNames : []),
    ...(Array.isArray(metadata.tagNames) ? metadata.tagNames : []),
  ];
  const generic = new Set([
    '播客',
    '电台',
    '有声书',
    '有声小说',
    kind === 'podcast' ? 'podcast' : 'audiobook',
    'long-audio',
  ]);
  return [
    ...new Set(
      values
        .map(value =>
          typeof value === 'string' || typeof value === 'number'
            ? String(value).trim()
            : '',
        )
        .filter(value => value && !/^\d+$/.test(value) && !generic.has(value)),
    ),
  ];
}

export const mediaHasMore = <T>(cursor: MediaCursor<T>) =>
  Object.values(cursor.streams).some(
    stream => stream.buffer.length > 0 || !stream.exhausted,
  );

// A cursor belongs to one mounted surface. Callers commit a copy only when its
// refresh generation still owns the request. Unshown upstream items are retained.
export async function takeMediaBatch<T>(
  cursor: MediaCursor<T>,
  streams: Array<{ key: string; provider: OnlineProvider; query: string }>,
  limit: number,
  keyOf: (item: T) => string,
  fetchPage: (
    stream: { provider: OnlineProvider; query: string },
    page: number,
    size: number,
    reportProgress: (items: T[]) => void,
  ) => Promise<{ items: T[]; errors: string[]; rawCount?: number }>,
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
    for (const [key, values] of reported) preview.streams[key].buffer = [...values];
    const previewSeen = new Set(seen);
    const previewItems = [...items];
    drainMediaBuffers(preview, streams, previewSeen, previewItems, limit, keyOf);
    preview.seen = [...previewSeen];
    if (previewItems.length) cursor.onProgress(previewItems, preview);
  };
  // Bound work on a provider that repeatedly returns duplicates. Its cursor is
  // retained for a later gesture; a short/filtered batch is never treated as EOF.
  const maxRounds = Math.max(1, options.maxRounds ?? 3);
  for (let round = 0; round < maxRounds && items.length < limit; round += 1) {
    if (cursor.signal?.aborted) throw Object.assign(new Error('媒体请求已取消'), { name: 'AbortError' });
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
          | { items: T[]; errors: string[]; rawCount?: number }
          | undefined;
        for (let attempt = 0; attempt < (options.fetchAttempts ?? 2); attempt += 1) {
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
    if (cursor.signal?.aborted) throw Object.assign(new Error('媒体请求已取消'), { name: 'AbortError' });
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
