import type { CatalogRequestBudget } from './catalogRequestBudget';
import { getQishuiCollection, qishuiCharts } from './qishuiCatalog';
import type { Track } from '../domain/types';
import {
  newSongChart,
  normalizeKugouTrack,
  normalizeKuwoTrack,
  normalizeMiguTrack,
  normalizeNeteaseTrack,
  normalizeQqTrack,
  parsePlatformJsonText,
  extractMiguChartRows,
  type OnlineProvider,
} from './onlineCatalog';
import { filterPlayableCandidates } from './trackPlaybackPolicy';
import type { HomeTimingTrace } from './homeTiming';

export const HOME_RELEASE_BATCH_SIZE = 18;
export const HOME_SONG_PRELOAD_BATCH_SIZE = 18;
export const HOME_RELEASE_ROWS = 3;

const normalizeHomeWorkField = (value: string | undefined) =>
  (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const knownHomeWorkField = (value: string) =>
  !!value &&
  !/^(?:未知.*|unknown(?:\s+(?:artist|song|album|title))?|n\/a|-)$/i.test(
    value,
  );

// Only Home music surfaces use these keys. Keep version labels and the first
// actual platform entity; missing metadata must not merge unrelated records.
const homeMusicWorkKey = (
  kind: 'song' | 'album',
  item: { title: string; artist?: string; provider: string },
  entityId: string,
) => {
  const title = normalizeHomeWorkField(item.title);
  const artist = normalizeHomeWorkField(item.artist);
  return JSON.stringify(
    knownHomeWorkField(title) && knownHomeWorkField(artist)
      ? [kind, 'work', title, artist]
      : [kind, 'entity', item.provider, entityId],
  );
};

export const homeSongWorkKey = (track: Track) =>
  homeMusicWorkKey('song', track, track.providerId || track.id);

/** Home display batching only; shared catalog/queue readers keep their contracts. */
export async function fillUniqueHomeBatch<T>({
  offset,
  target,
  rawLimit,
  seenKeys = new Set<string>(),
  keysOf,
  read,
  isCurrent = () => true,
  timing,
}: {
  offset: number;
  target: number;
  rawLimit: number;
  seenKeys?: ReadonlySet<string>;
  keysOf: (item: T) => string[];
  read: (
    offset: number,
    size: number,
  ) => Promise<{
    items: T[];
    hasMore: boolean;
    errors?: string[];
  }>;
  isCurrent?: () => boolean;
  timing?: HomeTimingTrace;
}) {
  const startedAt = Date.now();
  const items: T[] = [];
  const seen = new Set(seenKeys);
  const errors: string[] = [];
  let nextOffset = offset;
  let rawRead = 0;
  let hasMore = true;
  // One bounded Home request, not a fresh twelve-second wait for each gap.
  const deadline = Date.now() + 12_000;
  timing?.('fill-start', { offset, target, rawLimit });
  while (
    items.length < target &&
    rawRead < rawLimit &&
    hasMore &&
    isCurrent()
  ) {
    const size = Math.min(target - items.length, rawLimit - rawRead);
    const remainingMs = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (remainingMs <= 0) throw new Error('首页补取超时，请重试');
      rawRead += size;
      const sliceStartedAt = Date.now();
      timing?.('slice-start', {
        offset: nextOffset,
        size,
        accepted: items.length,
      });
      const result = await Promise.race([
        read(nextOffset, size),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('首页补取超时，请重试')),
            remainingMs,
          );
        }),
      ]);
      if (!isCurrent()) break;
      nextOffset += size;
      hasMore = result.hasMore;
      for (const item of result.items.slice(0, size)) {
        const keys = keysOf(item);
        const duplicate = keys.some(key => seen.has(key));
        keys.forEach(key => seen.add(key));
        if (!duplicate) items.push(item);
      }
      timing?.('slice-complete', {
        ms: Date.now() - sliceStartedAt,
        received: result.items.length,
        accepted: items.length,
        nextOffset,
        hasMore,
      });
      if (result.errors?.length) {
        errors.push(...result.errors);
        break;
      }
    } catch (error) {
      timing?.('slice-failed', { nextOffset, accepted: items.length });
      if (isCurrent())
        errors.push(error instanceof Error ? error.message : String(error));
      break;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  timing?.('fill-complete', {
    ms: Date.now() - startedAt,
    accepted: items.length,
    rawRead,
    nextOffset,
    errors: errors.length,
    cancelled: !isCurrent(),
  });
  return {
    items,
    nextOffset,
    rawRead,
    hasMore,
    errors,
    seenKeys: seen,
    cancelled: !isCurrent(),
  };
}

export const homeSongRailPageSize = (_page: number) =>
  HOME_SONG_PRELOAD_BATCH_SIZE;

export const homeSongRailPageOffset = (page: number, baseOffset = 0) => {
  const normalizedPage = Math.max(1, Math.floor(page));
  return (
    Math.max(0, Math.floor(baseOffset)) +
    (normalizedPage - 1) * HOME_SONG_PRELOAD_BATCH_SIZE
  );
};

export interface HomeReleasePage {
  tracks: Track[];
  hasMore: boolean;
}

export interface HomeChartSource {
  provider: OnlineProvider;
  id: string;
}

export async function requestCatalogJson(
  url: string,
  referer: string,
  timing?: HomeTimingTrace,
  requestContext?: CatalogRequestBudget,
) {
  if (requestContext) {
    const response = await requestContext.fetch(url, { headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' } });
    return parsePlatformJsonText(await response.text());
  }
  const startedAt = Date.now();
  const endpoint = url.split('?')[0]!;
  timing?.('api-start', { endpoint });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    timing?.('api-response', { endpoint, status: response.status });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (typeof response.text === 'function')
      return parsePlatformJsonText(await response.text());
    // Keep the lightweight test/native fetch shims compatible when they only
    // expose json(); real Android responses always take the text path above so
    // JSONP, Python-literal and HTML error pages are normalized consistently.
    return response.json();
  } finally {
    clearTimeout(timer);
    timing?.('api-settled', { endpoint, ms: Date.now() - startedAt });
  }
}

const requestJson = requestCatalogJson;

/** Home-only catalog paging; startup and personalized feeds keep their own contracts. */
export async function loadHomeReleasePage(
  provider: OnlineProvider,
  page: number,
): Promise<HomeReleasePage> {
  return loadHomeChartPage(provider, newSongChart(provider), page);
}

export async function loadHomeChartPage(
  provider: OnlineProvider,
  id: string,
  page: number,
) {
  return loadChartTrackBatch(
    provider,
    id,
    (Math.max(1, Math.floor(page)) - 1) * HOME_RELEASE_BATCH_SIZE,
    HOME_RELEASE_BATCH_SIZE,
  );
}

/**
 * Load one globally paged Home rail while retaining an independent cursor for
 * every healthy provider. Global positions are assigned round-robin, so a
 * nine-song UI batch never downloads and discards nine songs per provider.
 */
export async function loadMixedChartTrackBatch(
  sources: HomeChartSource[],
  offset: number,
  size: number,
  timing?: HomeTimingTrace,
  requireAllProviders = false,
): Promise<HomeReleasePage> {
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const normalizedSize = Math.max(0, Math.floor(size));
  if (!sources.length || normalizedSize === 0)
    return { tracks: [], hasMore: false };

  const requests = sources.map((source, sourceIndex) => {
    const remainder = normalizedOffset % sources.length;
    const delta = (sourceIndex - remainder + sources.length) % sources.length;
    const firstGlobal = normalizedOffset + delta;
    if (firstGlobal >= normalizedOffset + normalizedSize)
      return Promise.resolve<HomeReleasePage>({ tracks: [], hasMore: true });
    const count =
      Math.floor(
        (normalizedOffset + normalizedSize - 1 - firstGlobal) / sources.length,
      ) + 1;
    const providerOffset = Math.floor(firstGlobal / sources.length);
    const startedAt = Date.now();
    const trace: HomeTimingTrace | undefined = timing
      ? (stage, fields) =>
          timing(stage, {
            ...fields,
            provider: source.provider,
            offset: providerOffset,
            size: count,
          })
      : undefined;
    trace?.('provider-start');
    const request = loadChartTrackBatch(
      source.provider,
      source.id,
      providerOffset,
      count,
      trace,
    );
    // Queue/collection callers have no trace and retain the original promise path.
    if (!trace) return request;
    return request.then(
      result => {
        trace('provider-complete', {
          ms: Date.now() - startedAt,
          received: result.tracks.length,
          hasMore: result.hasMore,
        });
        return result;
      },
      error => {
        trace('provider-failed', { ms: Date.now() - startedAt });
        throw error;
      },
    );
  });
  const settled = await Promise.allSettled(requests);
  if (requireAllProviders) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  const groups = settled.map(result =>
    result.status === 'fulfilled' ? result.value : null,
  );
  if (groups.every(group => !group)) {
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    throw failure?.reason ?? new Error('首页暂无可用数据');
  }

  const cursors = Array(sources.length).fill(0) as number[];
  const tracks: Track[] = [];
  for (
    let globalIndex = normalizedOffset;
    globalIndex < normalizedOffset + normalizedSize;
    globalIndex += 1
  ) {
    const sourceIndex = globalIndex % sources.length;
    const track = groups[sourceIndex]?.tracks[cursors[sourceIndex]!] ?? null;
    cursors[sourceIndex] += 1;
    if (track) tracks.push(track);
  }
  return {
    tracks,
    hasMore: groups.some(group => group?.hasMore),
  };
}

export function loadMixedHomeChartPage(
  sources: HomeChartSource[],
  page: number,
  baseOffset = 0,
  size = homeSongRailPageSize(page),
  timing?: HomeTimingTrace,
) {
  return loadMixedChartTrackBatch(
    sources,
    homeSongRailPageOffset(page, baseOffset),
    size,
    timing,
  );
}

/** Home requests eighteen records initially and on every later real left swipe. */
export async function loadChartTrackBatch(
  provider: OnlineProvider,
  id: string,
  offset: number,
  size: number,
  timing?: HomeTimingTrace,
  requestContext?: CatalogRequestBudget,
): Promise<HomeReleasePage> {
  const result = (tracks: Track[], total?: number): HomeReleasePage => ({
    tracks: filterPlayableCandidates(tracks).slice(0, size),
    hasMore: Number.isFinite(total)
      ? offset + size < total!
      : tracks.length === size,
  });

  if (provider === 'qishui') {
    const detail = await getQishuiCollection(qishuiCharts.some(chart => chart.id === id) ? 'charts' : 'playlists', id, offset, size, { requestContext });
    return { tracks: filterPlayableCandidates(detail.tracks), hasMore: detail.hasMore };
  }

  if (provider === 'netease') {
    // n=0 returns the ordered ID index without downloading any song records.
    const index = await requestJson(
      `https://music.163.com/api/v6/playlist/detail?id=${id}&n=0&s=0`,
      'https://music.163.com/',
      timing,
      requestContext,
    );
    if (index.code !== 200)
      throw new Error(
        `往忆歌单索引请求失败（${index.code ?? '无返回码'}）：${
          index.message ?? index.msg ?? '响应异常，请重试'
        }`,
      );
    const trackIds = index.playlist?.trackIds ?? index.result?.trackIds;
    if (!Array.isArray(trackIds))
      throw new Error('往忆歌单索引响应异常，请重试');
    const ids: number[] = trackIds.map((entry: { id: number }) => entry.id);
    const requested = ids.slice(offset, offset + size);
    if (!requested.length) return { tracks: [], hasMore: false };
    const body = await requestJson(
      `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(
        JSON.stringify(requested.map(songId => ({ id: songId }))),
      )}`,
      'https://music.163.com/',
      timing,
      requestContext,
    );
    if (body.code !== 200)
      throw new Error(
        `往忆歌曲详情请求失败（${body.code ?? '无返回码'}）：${
          body.message ?? body.msg ?? '响应异常，请重试'
        }`,
      );
    if (!Array.isArray(body.songs))
      throw new Error('往忆歌曲详情响应异常，请重试');
    const songs = new Map<string, Track>(
      body.songs.map(
        (song: Parameters<typeof normalizeNeteaseTrack>[0]) => {
          const track = normalizeNeteaseTrack(song);
          return [String(track.providerId), track];
        },
      ),
    );
    return result(
      requested.flatMap(songId => songs.get(String(songId)) ?? []),
      ids.length,
    );
  }
  if (provider === 'qq') {
    const body = await requestJson(
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${id}&page=detail&type=top&song_begin=${offset}&song_num=${size}&format=json&inCharset=utf8&outCharset=utf-8`,
      'https://y.qq.com/',
      timing,
      requestContext,
    );
    return result(
      (body.songlist ?? body.songInfoList ?? []).map((value: any) =>
        normalizeQqTrack(value.data ?? value),
      ),
      Number(body.total_song_num),
    );
  }
  if (provider === 'kugou') {
    const pageSize =
      (size === HOME_RELEASE_BATCH_SIZE || size <= 10) && offset % size === 0
        ? size
        : 20;
    const firstPage = Math.floor(offset / pageSize);
    const innerOffset = offset - firstPage * pageSize;
    const pageCount = Math.ceil((innerOffset + size) / pageSize);
    const bodies = await Promise.all(
      Array.from({ length: pageCount }, (_, index) =>
        requestJson(
          `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${pageSize}&area_code=1&page=${
            firstPage + index + 1
          }&rankid=${id}&with_res_tag=0`,
          'http://m.kugou.com/',
          timing,
          requestContext,
        ),
      ),
    );
    const tracks = bodies.flatMap(body =>
      (body.data?.info ?? []).map(normalizeKugouTrack),
    );
    return result(
      tracks.slice(innerOffset, innerOffset + size),
      Number(bodies[0]?.data?.total),
    );
  }
  if (provider === 'kuwo') {
    const pageSize =
      (size === HOME_RELEASE_BATCH_SIZE || size <= 10) && offset % size === 0
        ? size
        : 20;
    const firstPage = Math.floor(offset / pageSize);
    const innerOffset = offset - firstPage * pageSize;
    const pageCount = Math.ceil((innerOffset + size) / pageSize);
    const bodies = await Promise.all(
      Array.from({ length: pageCount }, (_, index) =>
        requestJson(
          `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${
            firstPage + index
          }&rn=${pageSize}&type=bang&data=content&id=${id}&show_copyright_off=0&pcmp4=1&isbang=1`,
          'http://www.kuwo.cn/',
          timing,
          requestContext,
        ),
      ),
    );
    const tracks = bodies.flatMap(body =>
      (body.musiclist ?? body.musicList ?? []).map(normalizeKuwoTrack),
    );
    return result(
      tracks.slice(innerOffset, innerOffset + size),
      Number(bodies[0]?.num),
    );
  }
  // This provider's chart endpoint has no server-side pagination. Read it only
  // for a requested batch and retain no hidden song pool between requests.
  const body = await requestJson(
    `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${id}&needAll=0`,
    'https://m.music.migu.cn/',
    timing,
    requestContext,
  );
  const values = extractMiguChartRows(body);
  return result(
    values
      .slice(offset, offset + size)
      .map((value: any) => normalizeMiguTrack(value.objectInfo ?? value)),
    values.length,
  );
}
