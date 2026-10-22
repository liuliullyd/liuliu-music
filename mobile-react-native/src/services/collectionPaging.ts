import type { CatalogItem, PlatformSetting, Track } from '../domain/types';
import type { CatalogRequestBudget } from './catalogRequestBudget';
import {
  loadChartTrackBatch,
  requestCatalogJson,
  type HomeReleasePage,
} from './homeNewReleases';
import { loadLiveTracks } from './mediaDiscovery';
import {
  getCollection,
  normalizeKugouTrack,
  normalizeKuwoTrack,
  normalizeMiguTrack,
  providerNames,
  type OnlineProvider,
} from './onlineCatalog';
import { getAlbumDetail, getArtistTracks } from './onlineMusic';
import { readPlaylistReferencePage } from './playlistImport';
import { getQishuiCollection } from './qishuiCatalog';
import { filterPlayableCandidates } from './trackPlaybackPolicy';
export type CollectionKind = 'charts' | 'playlists' | 'new-albums' | 'artist';
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
    const detail = await getQishuiCollection(kind, id, offset, size, {
      requestContext,
    });
    return {
      tracks: filterPlayableCandidates(detail.tracks),
      hasMore: detail.hasMore,
    };
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
    return loadChartTrackBatch(
      provider,
      id,
      offset,
      size,
      undefined,
      requestContext,
    );
  if (provider === 'qq' && kind === 'playlists') {
    const collection = await getCollection(provider, kind, id, {
      offset,
      size,
      requestContext,
    });
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
  if (provider === 'kugou') {
    if (kind === 'playlists' && id.startsWith('gcid_')) {
      const page = await readPlaylistReferencePage(
        { provider, id },
        offset,
        size,
        requestContext?.signal,
      );
      return {
        tracks: filterPlayableCandidates(page.tracks.slice(0, size)),
        hasMore:
          page.total === undefined
            ? page.rawCount >= size
            : offset + size < page.total,
      };
    }
    const body = await requestCatalogJson(
      `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(
        id,
      )}&page=${Math.floor(offset / size) + 1}&pagesize=${size}`,
      'http://m.kugou.com/',
      undefined,
      requestContext,
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
      undefined,
      requestContext,
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
    undefined,
    requestContext,
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
