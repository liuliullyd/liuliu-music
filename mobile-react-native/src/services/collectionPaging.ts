import type { CatalogRequestBudget } from './catalogRequestBudget';
import { getQishuiCollection } from './qishuiCatalog';
import {
  loadChartTrackBatch,
  requestCatalogJson,
  type HomeReleasePage,
} from './homeNewReleases';
import {
  getCollection,
  normalizeKugouTrack,
  normalizeKuwoTrack,
  normalizeMiguTrack,
  normalizeNeteaseTrack,
  providerNames,
  type OnlineProvider,
} from './onlineCatalog';
import { filterPlayableCandidates } from './trackPlaybackPolicy';
import { hasExternalMediaOrigin } from './mediaDiscoveryPaging';
import {
  loadNeteaseRadioPrograms,
  loadQqTypedMediaAlbumTracks,
  loadMiguTypedMediaAlbumTracks,
  getArtistTracks,
  getAlbumDetail,
} from './onlineMusic';
import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import { loadLiveTracks } from './mediaDiscovery';
import { readPlaylistReferencePage } from './playlistImport';

export type CollectionKind =
  | 'charts'
  | 'playlists'
  | 'new-albums'
  | 'artist'
  | 'podcast'
  | 'audiobook';

/** UI/queue-only paging. The existing startup and catalog services are untouched. */
export async function loadCollectionTrackBatch(
  provider: OnlineProvider,
  kind: CollectionKind,
  id: string,
  offset: number,
  size = 20,
  metadata: CatalogItem['metadata'] = {},
  platforms?: PlatformSetting[],
  requestContext?: CatalogRequestBudget,
  _scenePage = false,
): Promise<HomeReleasePage> {
  if (provider === 'qishui' && (kind === 'charts' || kind === 'playlists')) {
    const detail = await getQishuiCollection(kind, id, offset, size, { requestContext });
    return { tracks: filterPlayableCandidates(detail.tracks), hasMore: detail.hasMore };
  }
  if (kind === 'artist' || (kind === 'new-albums' && metadata.entityTrack)) {
    const entityTrack = metadata.entityTrack as Track | undefined;
    if (!entityTrack || entityTrack.provider !== provider)
      throw new Error('合集身份与平台不匹配');
    const page = Math.floor(offset / size) + 1;
    const result =
      kind === 'artist'
        ? await getArtistTracks(entityTrack, page, size)
        : await getAlbumDetail(entityTrack, page, size);
    return {
      tracks: filterPlayableCandidates(result.tracks),
      hasMore: result.hasMore,
    };
  }
  if (kind === 'charts' && metadata.source === 'home-live') {
    const result = await loadLiveTracks(
      Math.floor(offset / size) + 1,
      platforms ?? [
        {
          id: provider,
          name: providerNames[provider],
          enabled: true,
        },
      ],
      provider,
      size,
    );
    return { tracks: result.tracks, hasMore: result.hasMore };
  }
  if (
    kind === 'new-albums' &&
    metadata.releaseType === 'single' &&
    metadata.releaseTrack &&
    typeof metadata.releaseTrack === 'object'
  ) {
    const track = metadata.releaseTrack as Track;
    return {
      tracks: offset === 0 && size > 0 ? [track] : [],
      hasMore: false,
    };
  }
  if (kind === 'charts' || (provider === 'netease' && kind === 'playlists'))
    return loadChartTrackBatch(provider, id, offset, size, undefined, requestContext);
  if (provider === 'qq' && kind === 'playlists') {
    const collection = await getCollection(provider, kind, id, { offset, size, requestContext });
    return {
      tracks: filterPlayableCandidates(collection.tracks.slice(0, size)),
      hasMore: collection.hasMore ?? collection.tracks.length === size,
    };
  }
  if (kind === 'new-albums') {
    // These existing endpoints return a complete collection. Keep only the
    // requested batch, with no hidden retained pool between UI page requests.
    const collection = await getCollection(provider, kind, id);
    return {
      tracks: filterPlayableCandidates(
        collection.tracks.slice(offset, offset + size),
      ),
      hasMore: offset + size < collection.tracks.length,
    };
  }
  if (
    (kind === 'podcast' || kind === 'audiobook') &&
    (provider === 'qq' || (provider === 'migu' && kind === 'audiobook'))
  ) {
    const album = {
      id,
      title: id,
      description: '',
      cover: '',
      provider,
      kind: 'playlists' as const,
      metadata: {
        ...metadata,
        mediaType: kind === 'audiobook' ? 'long-audio' : 'podcast',
        albumid: id,
      },
    } as CatalogItem;
    const page = Math.floor(offset / size) + 1;
    const facts: { rawCount?: number; total?: number } = {};
    const tracks =
      provider === 'qq'
        ? await loadQqTypedMediaAlbumTracks(album, page, size, kind, facts)
        : await loadMiguTypedMediaAlbumTracks(album, page, size, kind, facts);
    return {
      tracks: filterPlayableCandidates(tracks),
      hasMore: Number.isFinite(facts.total)
        ? offset + size < Number(facts.total)
        : (facts.rawCount ?? tracks.length) === size,
    };
  }
  if (provider === 'migu' && kind === 'podcast')
    throw new Error('迷谷当前没有可验证的播客目录接口');
  if (provider === 'netease' && (kind === 'podcast' || kind === 'audiobook')) {
    const radioId = id;
    const body = metadata.collectionEpisodeOrder === 'oldest'
      ? await loadNeteaseRadioPrograms(radioId, offset, size, { priority: 'foreground', oldestFirst: true })
      : await loadNeteaseRadioPrograms(radioId, offset, size);
    if (body.code !== 200)
      throw new Error(
        `${kind === 'audiobook' ? '听书' : '播客'}章节请求失败 ${
          body.code ?? ''
        }`,
      );
    const values = body.programs ?? [];
    if (values.some(hasExternalMediaOrigin))
      throw new Error('该合集包含不支持的平台内容');
    return {
      tracks: filterPlayableCandidates(
        values.map((value: any, index: number) => {
          const normalized = normalizeNeteaseTrack(value.mainSong ?? value);
          return {
            ...normalized,
            title:
              String(value.name ?? value.mainSong?.name ?? '') ||
              normalized.title,
            album:
              String(
                value.radio?.name ??
                  value.dj?.nickname ??
                  (kind === 'audiobook' ? '有声书' : '播客节目'),
              ) || normalized.album,
            duration:
              Number(value.duration ?? value.mainSong?.dt ?? 0) /
                (value.duration > 10000 ? 1000 : 1) ||
              normalized.duration,
            cover:
              String(value.coverUrl ?? value.picUrl ?? '').trim() ||
              normalized.cover ||
              String(value.radio?.picUrl ?? '').trim(),
            provider: 'netease',
            providerId:
              String(value.mainSong?.id ?? value.id ?? '') ||
              normalized.providerId,
            metadata: {
              ...(value.mainSong ?? value),
              ...value,
              id: value.mainSong?.id ?? value.id,
              songId: value.mainSong?.id,
              programCoverUrl: value.coverUrl,
              programHasLyric: value.existLyric === true,
              mediaType: kind === 'audiobook' ? 'long-audio' : 'podcast',
              discoveryEntity: 'episode',
              radioId,
              categoryId:
                kind === 'audiobook' ? 10001 : value.radio?.categoryId,
              programId: value.id,
              ...(metadata.collectionEpisodeOrder === 'oldest'
                ? { collectionEpisodeOffset: offset + index }
                : {}),
            },
          };
        }),
      ),
      hasMore: values.length === size,
    };
  }
  if (kind === 'audiobook' && provider === 'kugou') {
    const body = await requestCatalogJson(
      `http://mobilecdn.kugou.com/api/v3/album/song?version=9108&albumid=${encodeURIComponent(
        id,
      )}&plat=0&pagesize=${size}&area_code=0&page=${
        Math.floor(offset / size) + 1
      }&with_res_tag=0`,
      'https://www.kugou.com/ts/',
    );
    const values = body.data?.info ?? [];
    if (body.status !== undefined && body.status !== 1)
      throw new Error('听书章节请求失败，请重试');
    if (values.some(hasExternalMediaOrigin))
      throw new Error('该合集包含不支持的平台内容');
    return {
      tracks: filterPlayableCandidates(
        values.map((value: any, index: number) => {
          const track = normalizeKugouTrack(value);
          return {
            ...track,
            metadata: {
              ...track.metadata,
              mediaType: 'long-audio',
              discoveryEntity: 'episode',
              albumid: id,
              collectionEpisodeOffset: offset + index,
            },
          };
        }),
      ),
      hasMore: values.length === size,
    };
  }
  if (provider === 'kugou') {
    if (kind === 'playlists' && id.startsWith('gcid_')) {
      const page = await readPlaylistReferencePage({ provider, id }, offset, size, requestContext?.signal);
      return { tracks: filterPlayableCandidates(page.tracks.slice(0, size)),
        hasMore: page.total === undefined ? page.rawCount >= size : offset + size < page.total };
    }
    const body = await requestCatalogJson(
      `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(
        id,
      )}&page=${Math.floor(offset / size) + 1}&pagesize=${size}`,
      'http://m.kugou.com/',
      undefined, requestContext,
    );
    const values = body.data?.info ?? [];
    return {
      tracks: filterPlayableCandidates(
        values.slice(0, size).map(normalizeKugouTrack),
      ),
      hasMore:
        body.data?.total !== undefined
          ? offset + size < Number(body.data.total)
          : values.length === size,
    };
  }
  if (provider === 'kuwo') {
    const body = await requestCatalogJson(
      `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encodeURIComponent(
        id,
      )}&pn=${Math.floor(
        offset / size,
      )}&rn=${size}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`,
      'http://www.kuwo.cn/',
      undefined, requestContext,
    );
    const values = body.musiclist ?? body.musicList ?? [];
    return {
      tracks: filterPlayableCandidates(
        values.slice(0, size).map(normalizeKuwoTrack),
      ),
      hasMore:
        body.total !== undefined
          ? offset + size < Number(body.total)
          : values.length === size,
    };
  }
  const body = await requestCatalogJson(
    `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${
      Math.floor(offset / size) + 1
    }&pageSize=${size}&playlistId=${encodeURIComponent(id)}`,
    'https://m.music.migu.cn/',
    undefined, requestContext,
  );
  const values = body.data?.songList ?? [];
  return {
    tracks: filterPlayableCandidates(
      values.slice(0, size).map(normalizeMiguTrack),
    ),
    hasMore:
      body.data?.totalCount !== undefined
        ? offset + size < Number(body.data.totalCount)
        : values.length === size,
  };
}
