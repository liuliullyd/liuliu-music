import type {
  AppSettings,
  CatalogItem,
  PlatformSetting,
  ProviderId,
  SourceSetting,
  Track,
} from '../domain/types';
import type { CatalogRequestBudget } from './catalogRequestBudget';
import { localTrackForLyrics } from './localLyrics';
import { type MediaRequestOptions } from './mediaRequestScheduling';
import {
  coverCandidates,
  enrichTrackPresentation,
  getCollection,
  normalizeKugouTrack,
  normalizeKuwoTrack,
  normalizeMiguTrack,
  normalizeNeteaseTrack,
  normalizeQqTrack,
  parsePlatformJsonText,
  providerNames,
  type OnlineProvider,
} from './onlineCatalog';
import { platformLabel } from './platformPresentation';
import {
  getQishuiLyrics,
  searchQishuiPlaylists,
  searchQishuiTracks,
} from './qishuiCatalog';
import { qqSign } from './qqSignature';
import {
  isRecommendationMusicCollection,
  isRecommendationMusicTrack,
  recommendationEntityMetadata,
} from './recommendationContentPolicy';
import type { PlaybackTimingObserver } from './sourceRuntime';
import {
  resolveWithImportedSource,
  resolveWithImportedSourceAddress,
} from './sourceRuntime';
import { md5 } from './storage';
import {
  filterPlayableCandidates,
  isCatalogTrackEligible,
  rejectCatalogShortTrack,
  requiresQishuiCompleteness,
  throwIfRuntimeTrackBlocked,
  validateQishuiAudioCompleteness,
  type AudioProbeResult,
} from './trackPlaybackPolicy';
export type { PlaybackTimingObserver } from './sourceRuntime';
export type OnlineMediaType = 'music';
const textId = (value: unknown) =>
  value === undefined || value === null ? '' : String(value).trim();
const entityId = (value: unknown) => {
  // A normalized track also carries `metadata.singer` as the display name.
  // Never treat that scalar label as a provider entity ID; only structured
  // singer/artist records may supply an identity key.
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  const id = textId(item.id ?? item.mid ?? item.singerId ?? item.artistId);
  return id === '0' || id === '-1' ? '' : id;
};
/** Keep artist identity extraction in one place for every mobile entry path. */
export function artistIdentityId(track: Track) {
  const metadata = (track.metadata as Record<string, any> | undefined) ?? {};
  const groups = [
    metadata.artistEntities,
    metadata.singerList,
    metadata.Singers,
    metadata.singer,
    metadata.ar,
    metadata.artists,
  ];
  for (const group of groups) {
    const values = Array.isArray(group) ? group : group ? [group] : [];
    // QQ's singer search returns both a numeric singer id and the stable
    // singer mid.  The web singer RPC only accepts the latter; prefer it
    // without changing the identity rules of the other providers.
    const id =
      track.provider === 'qq'
        ? values
            .map(value => {
              if (!value || typeof value !== 'object') return '';
              const item = value as Record<string, unknown>;
              return textId(
                item.mid ?? item.singermid ?? item.id ?? item.singerId,
              );
            })
            .map(value => (value === '0' || value === '-1' ? '' : value))
            .find(Boolean)
        : values.map(entityId).find(Boolean);
    if (id) return id;
  }
  const fallback = textId(
    metadata.artistId ??
      metadata.artist_id ??
      metadata.ARTISTID ??
      metadata.singerId ??
      metadata.singerid ??
      metadata.singerMid ??
      metadata.singermid,
  );
  return fallback === '0' || fallback === '-1' ? '' : fallback;
}
/** Album identity must accept the raw casing used by all five providers. */
export function albumIdentityId(track: Track) {
  const metadata = (track.metadata as Record<string, any> | undefined) ?? {};
  const album =
    metadata.album && typeof metadata.album === 'object'
      ? metadata.album
      : metadata.al && typeof metadata.al === 'object'
      ? metadata.al
      : {};
  return textId(
    metadata.albumId ??
      metadata.album_id ??
      metadata.AlbumID ??
      metadata.ALBUMID ??
      metadata.albumMid ??
      metadata.albummid ??
      album.id ??
      album.mid,
  );
}
const enabledIds = (platforms?: PlatformSetting[]) =>
  (platforms ?? Object.keys(providerNames).map(id => ({ id, enabled: true })))
    .filter(value => value.enabled)
    .map(value => value.id as OnlineProvider);
type RequestTimeoutMs = number | null;
const request = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) => {
  if (requestContext) return requestContext.fetch(url, init);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer =
    timeoutMs === null ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    if (timer !== null) clearTimeout(timer);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
};
const textJson = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) => {
  const text = await request(url, init, timeoutMs, requestContext).then(
    response => response.text(),
  );
  return parsePlatformJsonText(text);
};
const parsePlatformJsonTextFromResponse = (response: Response) =>
  response.text().then(parsePlatformJsonText);
async function searchNetease(
  query: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) {
  const params = new URLSearchParams({
    s: query,
    type: '1',
    offset: String((page - 1) * limit),
    limit: String(limit),
    total: 'true',
  });
  const headers = {
    Referer: 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0',
  };
  const songsFrom = (body: any) => {
    const songs = body?.result?.songs ?? body?.songs ?? body?.data?.songs ?? [];
    return Array.isArray(songs) ? songs : [];
  };
  let primaryError: unknown;
  try {
    const body = await request(
      `https://music.163.com/api/search/get/web?${params.toString()}`,
      { headers },
      timeoutMs,
      requestContext,
    ).then(response => parsePlatformJsonTextFromResponse(response));
    const songs = songsFrom(body);
    if (songs.length) return songs.map(normalizeNeteaseTrack);
  } catch (error) {
    primaryError = error;
  }
  try {
    const body = await request(
      `https://music.163.com/api/cloudsearch/pc?${params.toString()}`,
      { headers },
      timeoutMs,
      requestContext,
    ).then(response => parsePlatformJsonTextFromResponse(response));
    return songsFrom(body).map(normalizeNeteaseTrack);
  } catch (error) {
    throw primaryError ?? error;
  }
}
async function searchQq(
  query: string,
  page: number,
  limit: number,
  searchType = 0,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) {
  const data = {
      comm: {
        ct: '11',
        cv: '14090508',
        v: '14090508',
        tmeAppID: 'qqmusic',
        phonetype: 'Android',
        os_ver: '12',
        OpenUDID: '0',
        QIMEI36: '0',
        nettype: '1020',
      },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: searchType,
          searchid: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
          query,
          page_num: page,
          num_per_page: limit,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: (page - 1) * limit,
          sem: 0,
        },
      },
    },
    payload = JSON.stringify(data),
    body = await request(
      `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(payload)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'QQMusic 14090508(android 12)',
        },
        body: payload,
      },
      timeoutMs,
      requestContext,
    ).then(response => response.json());
  if (body.code !== 0 || body.req?.code !== 0)
    throw new Error(`秋秋 搜索错误 ${body.req?.code ?? body.code ?? '未知'}`);
  return (body.req?.data?.body?.item_song ?? []).map(normalizeQqTrack);
}
const stripMarkup = (value: unknown) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|nbsp|lt|gt);/gi, match =>
      match.toLowerCase() === '&amp;'
        ? '&'
        : match.toLowerCase() === '&lt;'
        ? '<'
        : match.toLowerCase() === '&gt;'
        ? '>'
        : ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
async function searchQqPlaylists(
  query: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
): Promise<CatalogItem[]> {
  const data = {
    comm: {
      ct: '11',
      cv: '14090508',
      v: '14090508',
      tmeAppID: 'qqmusic',
      phonetype: 'Android',
      os_ver: '12',
      OpenUDID: '0',
      QIMEI36: '0',
      nettype: '1020',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 3,
        searchid: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        query,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: (page - 1) * limit,
        sem: 0,
      },
    },
  };
  const payload = JSON.stringify(data);
  const body = await request(
    `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(payload)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'QQMusic 14090508(android 12)',
      },
      body: payload,
    },
    timeoutMs,
    requestContext,
  ).then(response => response.json());
  if (body.code !== 0 || body.req?.code !== 0)
    throw new Error(
      `秋秋 歌单搜索错误 ${body.req?.code ?? body.code ?? '未知'}`,
    );
  const rows = body.req?.data?.body?.item_songlist ?? [];
  return (Array.isArray(rows) ? rows : []).map((value: any) => ({
    id: String(value.dissid ?? value.dissId ?? value.tid ?? value.docid ?? ''),
    title: stripMarkup(value.dissname ?? value.title ?? value.name),
    description: stripMarkup(
      value.subhead ??
        value.description ??
        value.introduction ??
        value.nickname,
    ),
    cover: value.logo ?? value.cover_url_medium ?? value.imgurl,
    provider: 'qq' as const,
    kind: 'playlists' as const,
    metadata: {
      ...recommendationEntityMetadata(value),
      creator: stripMarkup(value.nickname ?? value.creator?.name),
      trackCount: Number(
        value.songnum ?? value.songNum ?? value.song_count ?? 0,
      ),
      tags: [value.categoryName, value.category, value.tag].filter(Boolean),
    },
  }));
}
async function loadQqArtistTracks(
  singerMid: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
) {
  const body = await request(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        'User-Agent': 'QQMusic 14090508(android 12)',
      },
      body: JSON.stringify({
        comm: { ct: 24, cv: 0 },
        singer: {
          method: 'get_singer_detail_info',
          param: {
            sort: 5,
            singermid: singerMid,
            sin: (page - 1) * limit,
            num: limit,
          },
          module: 'music.web_singer_info_svr',
        },
      }),
    },
    timeoutMs,
  ).then(response => response.json());
  const data = body.singer?.data ?? body.data ?? {};
  const values = data.songlist ?? data.songList ?? [];
  return {
    tracks: (Array.isArray(values) ? values : []).map(normalizeQqTrack),
    total: Number(data.total ?? data.total_song_num ?? data.songnum),
  };
}
const kugouSearchRows = (body: any, field: 'lists' | 'info'): any[] => {
  const code = body?.error_code ?? body?.errcode ?? 0;
  if (Number(body?.status) !== 1 || Number(code) !== 0)
    throw new Error(`搜索接口暂不可用（${code || body?.status || '未知'}）`);
  if (!Array.isArray(body?.data?.[field]))
    throw new Error('搜索接口返回的数据异常，请重试');
  return body.data[field];
};
async function searchKugou(
  query: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
  recheckEmpty = false,
) {
  let primaryError: unknown;
  try {
    const body = await request(
      `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(
        query,
      )}&page=${page}&pagesize=${limit}&userid=0&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`,
      { headers: { Referer: 'https://www.kugou.com/' } },
      timeoutMs,
      requestContext,
    ).then(response => response.json());
    // Startup, Home, recommendations and queue continuation keep their original
    // single-request contract. Only an explicit search-page request opts in.
    if (!recheckEmpty) return (body.data?.lists ?? []).map(normalizeKugouTrack);
    const rows = kugouSearchRows(body, 'lists');
    if (rows.length) return rows.map(normalizeKugouTrack);
  } catch (error) {
    if (!recheckEmpty) throw error;
    primaryError = error instanceof Error ? error : new Error(String(error));
  }
  // The primary endpoint sometimes returns a successful raw empty page for an
  // existing song. Verify that same page once using Kugou's public mobile API.
  const body = await request(
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(
      query,
    )}&page=${page}&pagesize=${limit}&showtype=1`,
    { headers: { Referer: 'http://m.kugou.com/' } },
    timeoutMs,
    requestContext,
  ).then(response => response.json());
  const rows = kugouSearchRows(body, 'info');
  if (!rows.length && primaryError) throw primaryError;
  return rows.map(value => {
    const hash = String(value.hash ?? value.FileHash ?? '');
    return normalizeKugouTrack({
      ...value,
      // The mobile API uses lowercase hashes and different quality field names.
      // Preserve the primary API's identity and the existing source metadata.
      hash: /^[a-f\d]{32}$/i.test(hash) ? hash.toUpperCase() : hash,
      HQFileHash: value.HQFileHash ?? value['320hash'],
      SQFileHash: value.SQFileHash ?? value.sqhash,
    });
  });
}
async function searchKuwo(
  query: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) {
  const body = await textJson(
    `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(
      query,
    )}&pn=${Math.max(
      0,
      page - 1,
    )}&rn=${limit}&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`,
    { headers: { Referer: 'http://www.kuwo.cn/' } },
    timeoutMs,
    requestContext,
  );
  return (body.abslist ?? []).map(normalizeKuwoTrack);
}
async function searchMigu(
  query: string,
  page: number,
  limit: number,
  timeoutMs: RequestTimeoutMs = 12000,
  requestContext?: CatalogRequestBudget,
) {
  const timestamp = Date.now().toString(),
    deviceId = '963B7AA0D21511ED807EE5846EC87D20',
    sign = await md5(
      `${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`,
    ),
    searchSwitch = encodeURIComponent(
      JSON.stringify({
        song: 1,
        album: 0,
        singer: 0,
        tagSong: 0,
        mvSong: 0,
        bestShow: 0,
        songlist: 0,
        lyricSong: 0,
      }),
    );
  const body = await request(
    `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(
      query,
    )}&pageNo=${page}&sort=0&sid=USS`,
    {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId,
        timestamp,
        sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
      },
    },
    timeoutMs,
    requestContext,
  ).then(parsePlatformJsonTextFromResponse);
  const values = flattenMiguRows(
    body.songResultData?.resultList ?? body.musics ?? body.data?.songs ?? [],
  );
  return values.map(normalizeMiguTrack);
}
function flattenMiguRows(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenMiguRows);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (row.songId || row.contentId || row.copyrightId || row.songName)
    return [row];
  return Object.values(row).flatMap(flattenMiguRows);
}
const searchers: Record<
  OnlineProvider,
  (
    query: string,
    page: number,
    limit: number,
    timeoutMs?: RequestTimeoutMs,
    requestContext?: CatalogRequestBudget,
  ) => Promise<Track[]>
> = {
  netease: searchNetease,
  qq: (query, page, limit, timeoutMs, requestContext) =>
    searchQq(query, page, limit, 0, timeoutMs, requestContext),
  kugou: searchKugou,
  kuwo: searchKuwo,
  migu: searchMigu,
  qishui: (query, page, limit, timeoutMs, requestContext) =>
    searchQishuiTracks(query, page, limit, { timeoutMs, requestContext }),
};
export async function searchOnline(
  query: string,
  page = 1,
  limit = 20,
  provider: 'all' | ProviderId = 'all',
  platforms?: PlatformSetting[],
  mediaType: OnlineMediaType = 'music',
  requestTimeoutMs: RequestTimeoutMs = 12000,
  mediaOptions?: MediaRequestOptions,
  requestContext?: CatalogRequestBudget,
  searchOptions?: {
    recheckKugouEmpty?: boolean;
  },
): Promise<{
  tracks: Track[];
  errors: string[];
  rawCount?: number | null;
  providerRawCounts?: Partial<Record<OnlineProvider, number | null>>;
}> {
  if (
    provider !== 'all' &&
    provider !== 'custom' &&
    platforms &&
    !platforms.some(item => item.enabled && item.id === provider)
  ) {
    return {
      tracks: [],
      errors: [`${platformLabel(provider)}：本次启动播放检测未通过`],
      rawCount: null,
    };
  }
  const ids =
    provider === 'all'
      ? enabledIds(platforms)
      : provider === 'custom'
      ? []
      : [provider];
  const settled = await Promise.allSettled(
    ids.map(async id => {
      if (id === 'kugou' && searchOptions?.recheckKugouEmpty)
        return searchKugou(
          query.trim(),
          page,
          limit,
          requestTimeoutMs,
          requestContext,
          true,
        );
      return searchers[id](
        query.trim(),
        page,
        limit,
        requestTimeoutMs,
        requestContext,
      );
    }),
  );
  const errors: string[] = [];
  const rawTracks = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    errors.push(
      `${platformLabel(ids[index]!)}：${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`,
    );
    return [];
  });
  const tracks = rawTracks.filter(isRecommendationMusicTrack);
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value.length) return;
    const contentCandidates = result.value.filter(isRecommendationMusicTrack);
    if (!contentCandidates.length) return;
    const playable = filterPlayableCandidates(contentCandidates);
    if (!playable.length)
      errors.push(
        `${platformLabel(ids[index]!)}：返回 ${
          result.value.length
        } 条，但均未通过可播放条件`,
      );
  });
  const unique = filterPlayableCandidates([
    ...new Map(
      tracks.map(track => [
        `${track.provider}:${track.providerId ?? track.id}`,
        track,
      ]),
    ).values(),
  ]);
  return {
    tracks: unique.slice(0, provider === 'all' ? limit * ids.length : limit),
    errors,
    // Pagination must distinguish a filtered full page from remote exhaustion,
    // and a failed request from a successfully empty page. Other callers keep
    // consuming the same filtered tracks and errors as before.
    rawCount: settled.some(result => result.status === 'rejected')
      ? null
      : rawTracks.length,
    providerRawCounts: Object.fromEntries(
      settled.map((result, index) => [
        ids[index],
        result.status === 'fulfilled' ? result.value.length : null,
      ]),
    ),
  };
}
export const preserveCatalogCoverCandidates = (
  value: CatalogItem,
): CatalogItem => {
  const candidates = coverCandidates(value.provider, [
    value.cover,
    value.coverCandidates ?? [],
  ]);
  return {
    ...value,
    cover: candidates[0] ?? value.cover,
    coverCandidates: candidates,
  };
};
const neteasePlaylistRows = (body: any): any[] => {
  const rows =
    body?.result?.playlists ??
    body?.result?.playlist ??
    body?.playlists ??
    body?.data?.playlists ??
    [];
  return Array.isArray(rows) ? rows : [];
};
async function searchNeteasePlaylists(
  query: string,
  page: number,
  limit: number,
  requestContext?: CatalogRequestBudget,
) {
  const params = new URLSearchParams({
    s: query,
    type: '1000',
    offset: String((page - 1) * limit),
    total: 'true',
    limit: String(limit),
  });
  const headers = {
    Referer: 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0',
  };
  let primaryError: unknown;
  try {
    const body = await request(
      'https://music.163.com/api/search/get/web',
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
      12000,
      requestContext,
    ).then(parsePlatformJsonTextFromResponse);
    const rows = neteasePlaylistRows(body);
    if (rows.length) return rows;
  } catch (error) {
    primaryError = error;
  }
  // The web endpoint intermittently returns an empty playlist collection for
  // a valid query. Cloudsearch is the same NetEase playlist search, not a
  // cross-platform or song-result fallback, and keeps the requested page.
  try {
    const body = await request(
      `https://music.163.com/api/cloudsearch/pc?${params.toString()}`,
      { headers },
      12000,
      requestContext,
    ).then(parsePlatformJsonTextFromResponse);
    return neteasePlaylistRows(body);
  } catch (error) {
    throw primaryError ?? error;
  }
}
export async function searchOnlinePlaylists(
  query: string,
  page = 1,
  limit = 20,
  provider: 'all' | OnlineProvider = 'all',
  platforms?: PlatformSetting[],
  mediaType: OnlineMediaType = 'music',
  mediaOptions?: MediaRequestOptions,
  requestContext?: CatalogRequestBudget,
) {
  const ids = provider === 'all' ? enabledIds(platforms) : [provider];
  const settled = await Promise.allSettled(
    ids.map(async id => {
      let body: any;
      if (id === 'qishui')
        return searchQishuiPlaylists(query, page, limit, { requestContext });
      if (id === 'netease') {
        const rows = await searchNeteasePlaylists(
          query,
          page,
          limit,
          requestContext,
        );
        return rows.map((value: any) => ({
          id: String(value.id),
          title: String(value.name ?? ''),
          description: String(
            value.description ?? value.creator?.nickname ?? '',
          ),
          cover: value.coverImgUrl,
          provider: id,
          kind: 'playlists' as const,
          metadata: {
            ...recommendationEntityMetadata(value),
            tags: value.tags ?? [],
          },
        }));
      }
      if (id === 'qq') {
        return searchQqPlaylists(query, page, limit, 12000, requestContext);
      }
      if (id === 'kuwo') {
        body = await textJson(
          `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(
            query,
          )}&pn=${
            page - 1
          }&rn=${limit}&ft=playlist&cluster=0&strategy=2012&encoding=utf8&rformat=json`,
          { headers: { Referer: 'https://www.kuwo.cn/' } },
          12000,
          requestContext,
        );
        return (body.playlist_abslist ?? body.abslist ?? []).map(
          (value: any) => ({
            id: String(
              value.PLAYLISTID ?? value.playlistid ?? value.ID ?? '',
            ).replace('PLAYLIST_', ''),
            title: String(value.NAME ?? value.TITLE ?? value.name ?? ''),
            description: String(value.INFO ?? value.intro ?? ''),
            cover: value.PIC ?? value.IMG ?? value.pic,
            provider: id,
            kind: 'playlists' as const,
            metadata: {
              ...recommendationEntityMetadata(value),
              tags: [value.TAG, value.tag, value.category].filter(Boolean),
            },
          }),
        );
      }
      if (id === 'kugou') {
        body = await request(
          `http://mobilecdn.kugou.com/api/v3/search/special?format=json&keyword=${encodeURIComponent(
            query,
          )}&page=${page}&pagesize=${limit}&showtype=1`,
          { headers: { Referer: 'http://m.kugou.com/' } },
          12000,
          requestContext,
        ).then(value => value.json());
        return (body.data?.info ?? []).map((value: any) => ({
          id: String(value.specialid),
          title: String(value.specialname ?? ''),
          description: String(value.intro ?? value.nickname ?? ''),
          cover: String(value.imgurl ?? '').replace('{size}', '400'),
          provider: id,
          kind: 'playlists' as const,
          metadata: {
            ...recommendationEntityMetadata(value),
            tags: [value.classname, value.category, value.tag].filter(Boolean),
          },
        }));
      }
      const timestamp = Date.now().toString();
      const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
      const sign = await md5(
        `${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`,
      );
      const searchSwitch = encodeURIComponent(
        JSON.stringify({
          song: 0,
          album: 0,
          singer: 0,
          tagSong: 0,
          mvSong: 0,
          bestShow: 0,
          songlist: 1,
          lyricSong: 0,
        }),
      );
      body = await request(
        `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(
          query,
        )}&pageNo=${page}&sort=0&sid=USS`,
        {
          headers: {
            uiVersion: 'A_music_3.6.1',
            deviceId,
            timestamp,
            sign,
            channel: '0146921',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
          },
        },
        12000,
        requestContext,
      ).then(parsePlatformJsonTextFromResponse);
      const rows =
        body.songListResultData?.result ??
        body.songLists ??
        body.playlists ??
        body.data?.songLists ??
        [];
      return (Array.isArray(rows) ? rows : []).map((value: any) => ({
        id: String(value.id ?? value.songListId ?? value.playlistId),
        title: stripMarkup(
          value.name ?? value.songListName ?? value.title ?? value.songListName,
        ),
        description: stripMarkup(
          value.intro ?? value.summary ?? value.description ?? value.userName,
        ),
        cover: value.musicListPicUrl ?? value.img ?? value.coverUrl,
        provider: id,
        kind: 'playlists' as const,
        metadata: {
          ...recommendationEntityMetadata(value),
          creator: stripMarkup(value.userName ?? value.creator?.name),
          trackCount: Number(value.musicNum ?? value.songNum ?? 0),
          tags: [value.categoryName, value.category, value.tag].filter(Boolean),
        },
      }));
    }),
  );
  const errors: string[] = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled')
      return result.value
        .filter((value: CatalogItem) => isRecommendationMusicCollection(value))
        .filter(
          (value: { id: string; title: string }) => value.id && value.title,
        )
        .map(preserveCatalogCoverCandidates);
    errors.push(
      `${platformLabel(ids[index]!)}：${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`,
    );
    return [];
  });
  return { items, errors };
}
const normalizedArtistName = (value: string) =>
  value
    .replace(/[（(].*?[）)]/g, '')
    .split(/[/、,&·]|feat\.?|ft\.?/i)[0]
    ?.trim()
    .toLocaleLowerCase();
async function resolveKuwoArtistId(name: string) {
  const body = await textJson(
    'http://search.kuwo.cn/r.s?client=kt&stype=artist&all=' +
      encodeURIComponent(name) +
      '&pn=0&rn=20&ft=artist&encoding=utf8&rformat=json',
    { headers: { Referer: 'http://www.kuwo.cn/' } },
  );
  const wanted = normalizedArtistName(name);
  const values = Array.isArray(body.abslist) ? body.abslist : [];
  const match = values.find(
    (value: any) =>
      normalizedArtistName(stripMarkup(value.ARTIST ?? value.artist ?? '')) ===
      wanted,
  );
  const id = textId(match?.ARTISTID ?? match?.artistid ?? match?.DC_TARGETID);
  return id === '0' || id === '-1' ? '' : id;
}
async function searchArtistFallback(
  provider: OnlineProvider,
  name: string,
  id: string,
  page: number,
  size: number,
) {
  const searched = await searchOnline(name, page, size, provider);
  // An empty response with provider errors is a failed request, not the end
  // of a collection. Surface it so the collection pager can retain its
  // cursor and offer a retry; a clean empty response remains a genuine EOF.
  if (
    !searched.tracks.length &&
    searched.errors.length &&
    !Number.isFinite(searched.rawCount)
  )
    throw new Error(searched.errors.join('；'));
  const wanted = normalizedArtistName(name);
  const exact = searched.tracks.filter(value => {
    if (value.provider !== provider) return false;
    const metadata = (value.metadata as Record<string, any> | undefined) ?? {};
    const groups = [
      metadata.singerList,
      metadata.singers,
      metadata.artistEntities,
      metadata.singer,
      metadata.ar,
      metadata.artists,
    ];
    const entities = groups.flatMap(group =>
      Array.isArray(group)
        ? group
        : group && typeof group === 'object'
        ? [group]
        : [],
    );
    return (
      (id && entities.some(entity => entityId(entity) === id)) ||
      value.artist
        .split(/[/、,&·]|feat\.?|ft\.?/i)
        .some(candidate => normalizedArtistName(candidate) === wanted)
    );
  });
  return {
    tracks: exact.slice(0, size),
    // searchOnline exposes the provider's raw page size separately from the
    // playable/deduplicated tracks it returns.  Artist matching may discard
    // most of that page, but the remote artist cursor still has another page
    // whenever the raw page was full.
    hasMore: Number.isFinite(searched.rawCount)
      ? Number(searched.rawCount) === size
      : searched.tracks.length === size,
  };
}
/** Load one requested artist page, recovering only through that provider. */
export async function getArtistTracks(
  track: Track,
  page = 1,
  size = 20,
): Promise<{
  tracks: Track[];
  hasMore: boolean;
}> {
  if (track.provider === 'custom') return { tracks: [], hasMore: false };
  const name =
    track.artist.split(/[/、,&·]|feat\.?|ft\.?/i)[0]?.trim() ?? track.artist;
  if (track.provider === 'qishui')
    return searchArtistFallback(
      track.provider,
      name,
      artistIdentityId(track),
      page,
      size,
    );
  let id = artistIdentityId(track);
  if (!id && track.provider === 'kuwo') {
    try {
      id = await resolveKuwoArtistId(name);
    } catch {}
  }
  const offset = (page - 1) * size;
  if (id) {
    try {
      let tracks: Track[] = [],
        total: number | undefined,
        more: boolean | undefined;
      if (track.provider === 'netease') {
        const body = await request(
          'https://music.163.com/api/v1/artist/' +
            encodeURIComponent(id) +
            '?ext=true&top=' +
            size +
            '&limit=' +
            size +
            '&offset=' +
            offset,
          { headers: { Referer: 'https://music.163.com/' } },
        ).then(value => value.json());
        tracks = (body.hotSongs ?? body.songs ?? []).map(normalizeNeteaseTrack);
        // This route can ignore offset and return its complete hot-song list.
        // Slice that payload at the requested offset and use its actual length,
        // rather than the artist's all-works count, without retaining a pool.
        if (Array.isArray(body.hotSongs) && body.hotSongs.length > size)
          return {
            tracks: tracks.slice(offset, offset + size),
            hasMore: offset + size < tracks.length,
          };
        total = Number(body.artist?.musicSize ?? body.total);
        more = typeof body.more === 'boolean' ? body.more : undefined;
      } else if (track.provider === 'qq') {
        const result = await loadQqArtistTracks(id, page, size);
        tracks = result.tracks;
        total = result.total;
      } else if (track.provider === 'kugou') {
        const body = await request(
          'http://mobilecdn.kugou.com/api/v3/singer/song?singerid=' +
            encodeURIComponent(id) +
            '&page=' +
            page +
            '&pagesize=' +
            size,
          { headers: { Referer: 'http://m.kugou.com/' } },
        )
          .then(value => value.text())
          .then(parsePlatformJsonText);
        tracks = (body.data?.info ?? []).map(normalizeKugouTrack);
        total = Number(body.data?.total);
      } else if (track.provider === 'kuwo') {
        const body = await textJson(
          'http://search.kuwo.cn/r.s?stype=artist2music&artistid=' +
            encodeURIComponent(id) +
            '&pn=' +
            (page - 1) +
            '&rn=' +
            size +
            '&show_copyright_off=0&encoding=utf8&rformat=json',
          { headers: { Referer: 'http://www.kuwo.cn/' } },
        );
        tracks = (body.musiclist ?? body.abslist ?? []).map(normalizeKuwoTrack);
        total = Number(body.TOTAL ?? body.total);
      } else {
        const body = await request(
          'https://app.c.nf.migu.cn/MIGUM3.0/resource/artist/song/v2.0?singerId=' +
            encodeURIComponent(id) +
            '&pageNo=' +
            page +
            '&pageSize=' +
            size,
          { headers: { Referer: 'https://music.migu.cn/' } },
        ).then(value => value.json());
        if (body.code && body.code !== '000000')
          throw new Error('迷谷歌手接口错误 ' + body.code);
        tracks = (
          body.data?.songList ??
          body.data?.items ??
          body.songList ??
          []
        ).map(normalizeMiguTrack);
        total = Number(
          body.data?.totalCount ?? body.data?.total ?? body.totalCount,
        );
      }
      if (tracks.length)
        return {
          tracks: tracks.slice(0, size),
          hasMore:
            more ??
            (Number.isFinite(total)
              ? offset + size < Number(total)
              : tracks.length === size),
        };
      if (page > 1 && Number.isFinite(total) && offset >= Number(total))
        return { tracks: [], hasMore: false };
    } catch {}
  }
  return searchArtistFallback(track.provider, name, id, page, size);
}
/** Album endpoints may return a complete album; retain only the requested page. */
export async function getAlbumDetail(track: Track, page = 1, size = 20) {
  if (track.provider === 'custom') throw new Error('本地音乐没有在线专辑详情');
  const id = albumIdentityId(track);
  const offset = (page - 1) * size;
  let endpointError: unknown;
  if (id) {
    try {
      const detail = await getCollection(track.provider, 'new-albums', id);
      if (detail.tracks.length)
        return {
          ...detail,
          tracks: detail.tracks.slice(offset, offset + size),
          hasMore: offset + size < detail.tracks.length,
        };
    } catch (error) {
      endpointError = error;
    }
  }
  const searched = await searchOnline(track.album, page, size, track.provider);
  // Preserve retryable provider failures from the fallback search. Only a
  // successful empty search is allowed to terminate pagination quietly.
  if (
    !searched.tracks.length &&
    searched.errors.length &&
    !Number.isFinite(searched.rawCount)
  )
    throw new Error(searched.errors.join('；'));
  const wanted = track.album.trim().toLocaleLowerCase();
  const tracks = searched.tracks.filter(
    value =>
      value.provider === track.provider &&
      value.album.trim().toLocaleLowerCase() === wanted,
  );
  if (!tracks.length && page === 1 && !(Number(searched.rawCount) >= size))
    throw endpointError ?? new Error('该平台专辑暂无可用歌曲');
  return {
    id,
    title: track.album,
    description: track.artist,
    cover: track.cover,
    provider: track.provider,
    kind: 'new-albums' as const,
    tracks: tracks.slice(0, size),
    // Album matching can remove unrelated search rows after the provider has
    // already returned a full page.  Keep the remote continuation fact so a
    // later matching album row is not mistaken for end-of-data.
    hasMore: Number.isFinite(searched.rawCount)
      ? Number(searched.rawCount) === size
      : searched.tracks.length === size,
  };
}
const normalizeLyricMatchText = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[\s\u3000'"“”‘’·•,，.。!！?？:：/\\|、()[\]{}<>《》]/g, '');
const lyricsMatchTrack = (source: Track, candidate: Track) => {
  if (source.provider !== candidate.provider) return false;
  return lyricsMatchRecording(source, candidate);
};
// Lyric identity is allowed to cross providers only after the track's own
// provider has been exhausted. This covers catalogs where one platform has a
// lyric record while another only exposes the playable audio metadata.
const lyricsMatchRecording = (source: Track, candidate: Track) => {
  const sourceTitle = normalizeLyricMatchText(source.title);
  const candidateTitle = normalizeLyricMatchText(candidate.title);
  const sourceArtist = normalizeLyricMatchText(source.artist);
  const candidateArtist = normalizeLyricMatchText(candidate.artist);
  if (!sourceTitle || sourceTitle !== candidateTitle) return false;
  if (sourceArtist && candidateArtist && sourceArtist !== candidateArtist)
    return false;
  const sourceDuration = Number(source.duration);
  const candidateDuration = Number(candidate.duration);
  return (
    !sourceDuration ||
    !candidateDuration ||
    Math.abs(sourceDuration - candidateDuration) <= 8
  );
};
const lyricIdentityMatches = (track: Track, metadata: Record<string, any>) => {
  const currentIds = new Set(
    [
      track.providerId,
      metadata.songmid,
      metadata.songId,
      metadata.songid,
      metadata.musicId,
      metadata.musicid,
      metadata.copyrightId,
      metadata.contentId,
      metadata.id,
    ]
      .map(value => String(value ?? '').trim())
      .filter(Boolean),
  );
  const lyricIds = [
    metadata.lyricSongId,
    metadata.lyricSongid,
    metadata.lyricSongmid,
    metadata.lyricId,
    metadata.lrcId,
    metadata.lyricTrackId,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return lyricIds.length === 0 || lyricIds.some(value => currentIds.has(value));
};
export type LyricLine = {
  time: number;
  text: string;
  translation?: string;
};
const lyricCache = new Map<string, LyricLine[]>();
let lyricCacheGeneration = 0;
const lyricRequests = new Map<string, Promise<LyricLine[]>>();
export function clearTrackLyricsCache() {
  lyricCacheGeneration += 1;
  lyricCache.clear();
}
export const trackLyricsKey = (track: Track) => {
  const presentation = enrichTrackPresentation(track);
  return [
    presentation.provider,
    presentation.providerId ?? presentation.id,
    normalizeLyricMatchText(presentation.title),
    normalizeLyricMatchText(presentation.artist),
    Math.round(Number(presentation.duration) || 0),
  ].join(':');
};
export const getCachedTrackLyrics = (track: Track) =>
  lyricCache.get(trackLyricsKey(track));
const formatKuwoLyricTime = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (/^\d{1,3}:\d{1,2}(?:\.\d+)?$/.test(text)) return text;
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds - minutes * 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
};
async function loadTrackLyrics(
  track: Track,
  fallbackDepth = 0,
): Promise<LyricLine[]> {
  let presentation = enrichTrackPresentation(track);
  const metadata =
    (presentation.metadata as Record<string, any> | undefined) ?? {};
  if (presentation.provider === 'qishui')
    return parseLrc(await getQishuiLyrics(presentation.providerId ?? ''));

  const embedded = lyricPayload(
    metadata.lyric,
    metadata.lrc,
    metadata.lyrics,
    metadata.lyricText,
    metadata.lyricContent,
    metadata.lyricBase64,
  );
  if (embedded && lyricIdentityMatches(track, metadata)) {
    const lines = parseLrc(embedded);
    if (lines.length) return lines;
  }
  const lyricTrack = await localTrackForLyrics(track);
  if (!lyricTrack) return [];
  track = lyricTrack;
  presentation = enrichTrackPresentation(track);
  const ids = (...values: unknown[]) =>
    Array.from(
      new Set(values.map(value => String(value ?? '').trim()).filter(Boolean)),
    );
  let lastError: unknown;
  const tryText = async (load: () => Promise<string>) => {
    try {
      const value = await load();
      if (value.trim()) return value;
    } catch (error) {
      lastError = error;
    }
    return '';
  };
  if (presentation.provider === 'netease') {
    for (const id of ids(
      presentation.providerId,
      metadata.songId,
      metadata.songid,
      metadata.id,
      metadata.programId,
    )) {
      const text = await tryText(async () => {
        const body = await request(
          `https://music.163.com/api/song/lyric?id=${encodeURIComponent(
            id,
          )}&lv=-1&kv=-1&tv=-1`,
          { headers: { Referer: 'https://music.163.com/' } },
        ).then(value => value.json());
        const original = lyricPayload(
          body.lrc?.lyric,
          body.klyric?.lyric,
          body.romalrc?.lyric,
        );
        const translation = lyricPayload(body.tlyric?.lyric);
        return [original, translation].filter(Boolean).join('\n');
      });
      if (text) return parseLrc(text);
    }
  } else if (presentation.provider === 'qq') {
    for (const id of ids(
      presentation.providerId,
      metadata.songmid,
      metadata.strMediaMid,
      metadata.songId,
      metadata.songid,
    )) {
      const text = await tryText(async () => {
        const body = await textJson(
          `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(
            id,
          )}&format=json&nobase64=1`,
          {
            headers: {
              Referer: 'https://y.qq.com/',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
            },
          },
        );
        return lyricPayload(body.lyric, body.lyricBase64, body.data?.lyric);
      });
      if (text) return parseLrc(text);
    }
  } else if (presentation.provider === 'kuwo') {
    for (const id of ids(
      presentation.providerId,
      metadata.musicId,
      metadata.musicid,
      metadata.songmid,
      metadata.id,
    )) {
      const text = await tryText(async () => {
        const body = await request(
          `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(
            id,
          )}`,
          {
            headers: {
              Referer: 'https://m.kuwo.cn/',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
            },
          },
        ).then(value => value.json());
        return (body.data?.lrclist ?? [])
          .map(
            (value: any) =>
              `[${formatKuwoLyricTime(value.time)}]${value.lineLyric ?? ''}`,
          )
          .join('\n');
      });
      if (text) return parseLrc(text);
    }
  } else if (presentation.provider === 'kugou') {
    const keyword = encodeURIComponent(
      `${presentation.title} ${presentation.artist}`,
    );
    const hashes = ids(
      metadata.hash,
      metadata.hash_320,
      metadata.sqhash,
      metadata.hash_high,
      presentation.providerId,
    );
    for (const hash of hashes.length ? hashes : ['']) {
      for (const withDuration of [true, false]) {
        const text = await tryText(async () => {
          const durationQuery = withDuration
            ? `&duration=${Math.round(presentation.duration * 1000)}`
            : '';
          const search = await request(
            `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${keyword}${durationQuery}&hash=${encodeURIComponent(
              hash,
            )}`,
            {
              headers: {
                Referer: 'https://www.kugou.com/',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
              },
            },
          ).then(value => value.json());
          const candidates = Array.isArray(search.candidates)
            ? search.candidates.slice(0, 5)
            : [];
          for (const candidate of candidates) {
            if (!candidate?.id || !candidate?.accesskey) continue;
            try {
              const body = await request(
                `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(
                  candidate.id,
                )}&accesskey=${encodeURIComponent(
                  candidate.accesskey,
                )}&fmt=lrc&charset=utf8`,
                {
                  headers: {
                    Referer: 'https://www.kugou.com/',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
                  },
                },
              ).then(value => value.json());
              if (body.content) return decodeBase64Utf8(body.content);
            } catch {}
          }
          return '';
        });
        if (text) return parseLrc(text);
      }
    }
  } else if (presentation.provider === 'migu') {
    for (const value of ids(
      metadata.lrcUrl,
      metadata.lrcurl,
      metadata.lyricUrl,
      metadata.lyricsUrl,
    )) {
      const url = value.startsWith('//') ? `https:${value}` : value;
      if (!/^https?:\/\//i.test(url)) continue;
      const text = await tryText(() =>
        request(url, {
          headers: {
            Referer: 'https://music.migu.cn/',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
          },
        }).then(value => value.text()),
      );
      if (text) return parseLrc(text);
    }
    for (const id of ids(
      metadata.copyrightId,
      metadata.contentId,
      presentation.providerId,
      metadata.songId,
      metadata.songid,
    )) {
      const text = await tryText(async () => {
        const body = await request(
          `https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=${encodeURIComponent(
            id,
          )}`,
          {
            headers: {
              Referer: 'https://music.migu.cn/',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
            },
          },
        ).then(value => value.json());
        return lyricPayload(
          body.lyric,
          body.data?.lyric,
          body.data?.lrc,
          body.data?.lyricContent,
          body.result?.lyric,
        );
      });
      if (text) return parseLrc(text);
    }
  }
  if (fallbackDepth === 0 && presentation.title && presentation.artist) {
    try {
      const searched = await searchOnline(
        `${presentation.title} ${presentation.artist}`.trim(),
        1,
        8,
        presentation.provider,
      );
      const candidate = searched.tracks
        .filter(
          value => value.id !== track.id && lyricsMatchTrack(track, value),
        )
        .sort((left, right) => {
          const wanted = String(track.providerId ?? '');
          const leftExact = String(left.providerId ?? '') === wanted ? 0 : 1;
          const rightExact = String(right.providerId ?? '') === wanted ? 0 : 1;
          return (
            leftExact - rightExact ||
            Math.abs(left.duration - track.duration) -
              Math.abs(right.duration - track.duration)
          );
        })[0];
      if (candidate) {
        const recovered: Array<{
          time: number;
          text: string;
        }> = await getTrackLyrics(candidate, 1);
        if (recovered.length) return recovered;
      }
      // A few catalogs expose a complete song but no lyric endpoint for that
      // identity. Search the other enabled public catalogs once, then require
      // an exact title/artist/duration match before borrowing their lyric
      // record. This is presentation-only and never changes playback source.
      const crossProvider = await searchOnline(
        `${presentation.title} ${presentation.artist}`.trim(),
        1,
        4,
        'all',
      );
      const alternateCandidates = crossProvider.tracks
        .filter(
          value =>
            value.provider !== presentation.provider &&
            lyricsMatchRecording(track, value),
        )
        .slice(0, 6);
      for (const alternate of alternateCandidates) {
        const recovered = await getTrackLyrics(alternate, 1);
        if (recovered.length) return recovered;
      }
    } catch {}
  }
  if (lastError) throw lastError;
  return [];
}
export async function getTrackLyrics(
  track: Track,
  fallbackDepth = 0,
): Promise<LyricLine[]> {
  const key = trackLyricsKey(track);
  const cached = lyricCache.get(key);
  if (cached) return cached;
  const pending = lyricRequests.get(key);
  if (pending) return pending;
  const generation = lyricCacheGeneration;
  const request = loadTrackLyrics(track, fallbackDepth)
    .then(lines => {
      if (lines.length && generation === lyricCacheGeneration)
        lyricCache.set(key, lines);
      return lines;
    })
    .finally(() => {
      if (lyricRequests.get(key) === request) lyricRequests.delete(key);
    });
  lyricRequests.set(key, request);
  return request;
}
const mergeLyricLines = (lines: LyricLine[]) => {
  const merged = new Map<number, LyricLine>();
  for (const line of lines) {
    const key = Math.round(line.time * 1000);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { time: line.time, text: line.text });
      continue;
    }
    if (
      existing.text === line.text ||
      existing.translation?.split('\n').includes(line.text)
    )
      continue;
    existing.translation = existing.translation
      ? `${existing.translation}\n${line.text}`
      : line.text;
  }
  return Array.from(merged.values()).sort(
    (left, right) => left.time - right.time,
  );
};
const parseLrc = (value: string) =>
  mergeLyricLines(
    (() => {
      const normalized = value
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/^\uFEFF/, '');
      const offsetMatch = normalized.match(/^\[offset:([+-]?\d+)\]/im);
      const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
      const timestamp =
        /\[(\d{1,3}):(\d{1,2})(?:(?::(\d{1,2})(?:\.(\d+))?)|(?:\.(\d+)))?\]/g;
      return normalized.split(/\r?\n/).flatMap(line => {
        const tags = Array.from(line.matchAll(timestamp));
        if (!tags.length) return [];
        const text = line.replace(timestamp, '').trim();
        if (!text) return [];
        return tags.map(match => {
          const hasHours = match[3] !== undefined;
          const seconds = Number(match[2]);
          const third = match[3] === undefined ? 0 : Number(match[3]);
          const fraction = match[3] === undefined ? match[5] : match[4];
          return {
            time: Math.max(
              0,
              (hasHours
                ? Number(match[1]) * 3600 + seconds * 60 + third
                : Number(match[1]) * 60 + seconds) +
                (fraction ? Number(`0.${fraction}`) : 0) +
                offset,
            ),
            text,
          };
        });
      });
    })(),
  );
const decodeBase64Utf8 = (value: string) => {
  const decode = (
    globalThis as {
      atob?: (input: string) => string;
    }
  ).atob;
  if (!decode) throw new Error('当前运行环境不支持 Base64 歌词解码');
  const binary = decode(value);
  let escaped = '';
  for (let index = 0; index < binary.length; index += 1)
    escaped += `%${binary.charCodeAt(index).toString(16).padStart(2, '0')}`;
  return decodeURIComponent(escaped);
};
const decodeLyricEntities = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const lyricPayload = (...values: unknown[]) => {
  let firstText = '';
  for (const value of values) {
    const text = decodeLyricEntities(String(value ?? '').trim());
    if (!text) continue;
    if (/\[\d{1,3}:\d{1,2}(?:\.\d+)?\]/.test(text)) return text;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(text) && text.length >= 16) {
      try {
        const decoded = decodeBase64Utf8(text);
        if (/\[\d{1,3}:\d{1,2}(?:\.\d+)?\]/.test(decoded))
          return decodeLyricEntities(decoded);
      } catch {}
    }
    if (!firstText) firstText = text;
  }
  return firstText;
};
export async function testOnlineSource(
  provider: PlatformSetting['id'],
  requestTimeoutMs: RequestTimeoutMs = 12000,
) {
  const result = await searchOnline(
    '周杰伦',
    1,
    1,
    provider,
    undefined,
    'music',
    requestTimeoutMs,
  );
  if (!result.tracks.length)
    throw new Error(result.errors[0] ?? '平台未返回有效搜索结果');
  return {
    message: `${platformLabel(provider)}公开搜索接口正常`,
    sample: result.tracks[0]!,
  };
}
async function resolveKuwo(id: string) {
  const response = await request(
    `https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=MUSIC_${encodeURIComponent(
      id,
    )}&format=mp3&response=url`,
    { headers: { Referer: 'https://www.kuwo.cn/' } },
  );
  const text = await response.text();
  try {
    return String(JSON.parse(text).url ?? '').trim();
  } catch {
    return text.trim();
  }
}
export async function resolvePlayback(
  track: Track,
  sources: SourceSetting[] = [],
  quality: AppSettings['quality'] = '320k',
) {
  throwIfRuntimeTrackBlocked(track);
  if (!isCatalogTrackEligible(track)) rejectCatalogShortTrack(track);
  const prewarmed = track.metadata?._prewarmedUrl === true;
  if (track.playUrl && !prewarmed) return track.playUrl;
  if (sources.some(source => source.enabled && source.script)) {
    const resolved = await resolveWithImportedSource(
      prewarmed ? { ...track, playUrl: undefined } : track,
      sources,
      quality,
    );
    return resolved.url;
  }
  if (track.provider === 'kuwo' && track.providerId) {
    const url = await resolveKuwo(track.providerId);
    if (url) return url;
  }
  if (track.provider === 'netease' && track.providerId)
    return `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(
      track.providerId,
    )}.mp3`;
  throw new Error('该平台需要先在设置中导入并启用兼容音乐源');
}
/** Resolve a playable URL and expose the quality that actually passed the
 * imported-source/native audio gate.  Callers that only need a URL continue
 * using resolvePlayback so the existing playback contract remains unchanged.
 */
export async function resolvePlaybackWithQuality(
  track: Track,
  sources: SourceSetting[] = [],
  quality: AppSettings['quality'] = '320k',
  refreshExpiredUrl = false,
  timing?: PlaybackTimingObserver,
  cachedUrlOnly = false,
) {
  const prewarmed = track.metadata?._prewarmedUrl === true;
  const remoteQishui =
    requiresQishuiCompleteness(track) &&
    /^https?:\/\//i.test(track.playUrl ?? '');
  let reusableUrl = true;
  if (remoteQishui) {
    const audio = track.metadata?._playbackAudio as
      | AudioProbeResult
      | undefined;
    reusableUrl = Boolean(audio && audio.resolvedUrl === track.playUrl);
    if (reusableUrl && audio) {
      try {
        validateQishuiAudioCompleteness(track, audio);
      } catch {
        reusableUrl = false;
      }
    }
  }
  if (
    track.playUrl &&
    !refreshExpiredUrl &&
    !prewarmed &&
    !cachedUrlOnly &&
    reusableUrl
  )
    return {
      url: track.playUrl,
      quality:
        (track.metadata?._playbackQuality as AppSettings['quality']) ??
        undefined,
      reportedQuality: track.metadata?._playbackReportedQuality as
        | AppSettings['quality']
        | undefined,
      audio: track.metadata?._playbackAudio,
    };
  const input =
    refreshExpiredUrl || prewarmed || remoteQishui
      ? { ...track, playUrl: undefined }
      : track;
  if (sources.some(source => source.enabled && source.script)) {
    const resolved = await resolveWithImportedSource(
      input,
      sources,
      quality,
      refreshExpiredUrl,
      timing,
      cachedUrlOnly,
    );
    return {
      url: resolved.url,
      quality: resolved.quality,
      reportedQuality: resolved.reportedQuality,
      audio: resolved.audio,
    };
  }
  if (cachedUrlOnly) throw new Error('歌曲预解析缓存所属音源不可用');
  return {
    url: await resolvePlayback(input, sources, quality),
    quality: undefined,
    reportedQuality: undefined,
  };
}
/** Resolve and validate the final URL for any pre-resolution surface. */
export async function resolvePlaybackAddress(
  track: Track,
  sources: SourceSetting[] = [],
  quality: AppSettings['quality'] = '320k',
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    const error = new Error('URL 预解析已取消');
    error.name = 'AbortError';
    throw error;
  }
  throwIfRuntimeTrackBlocked(track);
  if (!isCatalogTrackEligible(track)) rejectCatalogShortTrack(track);
  const prewarmed = track.metadata?._prewarmedUrl === true;
  if (track.playUrl && !prewarmed) return track.playUrl;
  if (!sources.some(source => source.enabled && source.script))
    throw new Error('该平台需要先在设置中导入并启用兼容音乐源');
  const resolved = await resolveWithImportedSourceAddress(
    prewarmed ? { ...track, playUrl: undefined } : track,
    sources,
    quality,
    signal,
  );
  return resolved.url;
}
export async function resolvePlaybackPrewarm(
  track: Track,
  sources: SourceSetting[],
  quality: AppSettings['quality'],
  signal?: AbortSignal,
) {
  if (!sources.some(source => source.enabled && source.script))
    throw new Error('该平台需要先在设置中导入并启用兼容音乐源');
  return resolveWithImportedSourceAddress(
    { ...track, playUrl: undefined },
    sources,
    quality,
    signal,
  );
}
