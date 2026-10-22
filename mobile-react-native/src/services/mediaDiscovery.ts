import { platformLabel } from './platformPresentation';
import type { PlatformSetting, Track } from '../domain/types';
import {
  enrichTrackPresentation,
  normalizeNeteaseTrack,
  parsePlatformJsonText,
  trackCoverCandidates,
  type OnlineProvider,
} from './onlineCatalog';
import { searchOnline } from './onlineMusic';
import { mediaProviders } from './mediaDiscoveryPaging';

export type MediaDiscoveryKind =
  | 'radio'
  | 'video'
  | 'podcast'
  | 'audiobook'
  | 'live';

export const mediaDiscoveryConfigs: Record<
  MediaDiscoveryKind,
  { title: string; query: string; description: string }
> = {
  radio: {
    title: '电台',
    query: '音乐电台',
    description: '发现适合陪伴收听的声音',
  },
  video: {
    title: '视频 M/V',
    query: '音乐 MV',
    description: '发现音乐影像与主题曲目',
  },
  podcast: {
    title: '播客',
    query: '音乐播客',
    description: '收听音乐故事与人物访谈',
  },
  audiobook: {
    title: '听书',
    query: '有声书',
    description: '收听有声读物与故事',
  },
  live: {
    title: 'Live 现场',
    // Keep the original bilingual query. Migu ranks a bare English `Live`
    // query toward international catalog rows, while this query returns the
    // intended Chinese and English live-version mix.
    query: 'Live 现场',
    description: '收听演唱会与现场版本',
  },
};

export type MediaProvider = 'all' | OnlineProvider;

const interleave = (groups: Track[][], limit: number) => {
  const output: Track[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < longest && output.length < limit; index += 1) {
    for (const group of groups) {
      const track = group[index];
      if (!track) continue;
      const key = `${track.provider}:${track.providerId ?? track.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(track);
      if (output.length === limit) break;
    }
  }
  return output;
};

/**
 * NetEase's public song search intentionally omits album artwork for many
 * results. Live rows are still the same song identities, so hydrate only the
 * missing artwork through the platform's batch song-detail endpoint. This is
 * presentation data only: no audio URL, queue, or playback state is touched.
 */
async function hydrateNeteaseLiveCovers(tracks: Track[]) {
  const missing = tracks.filter(
    track => track.provider === 'netease' && !trackCoverCandidates(track).length,
  );
  if (!missing.length) return tracks;
  const ids = missing
    .map(track => String(track.providerId ?? '').trim())
    .filter(id => /^\d+$/.test(id));
  if (!ids.length) return tracks;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let body: any;
    try {
      const response = await fetch(
        `https://music.163.com/api/song/detail?ids=${encodeURIComponent(
          JSON.stringify(Array.from(new Set(ids))),
        )}`,
        {
          signal: controller.signal,
          headers: {
            Referer: 'https://music.163.com/',
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );
      if (!response.ok) return tracks;
      body = parsePlatformJsonText(await response.text());
    } finally {
      clearTimeout(timer);
    }
    const details = new Map<string, Track>(
      (Array.isArray(body?.songs) ? body.songs : []).map((song: any) => {
        const normalized = normalizeNeteaseTrack(song);
        return [String(normalized.providerId ?? ''), normalized];
      }),
    );
    if (!details.size) return tracks;
    return tracks.map(track => {
      const detail = details.get(String(track.providerId ?? ''));
      return detail?.cover
        ? enrichTrackPresentation({
            ...track,
            cover: detail.cover,
            metadata: { ...track.metadata, ...detail.metadata },
          })
        : track;
    });
  } catch {
    // A missing artwork detail request must not remove a valid Live song or
    // change the existing bundled fallback boundary.
    return tracks;
  }
}

/**
 * Live surfaces use a positive English marker in song-facing fields. Keep this
 * deliberately narrow: a search result that only says “现场”, or an artist or
 * free-form description containing “Live”, is not treated as a Live version.
 */
export const isLiveTrack = (track: Track) => {
  const metadata = track.metadata ?? {};
  const explicitVersionFields = [
    metadata.version,
    metadata.songVersion,
    metadata.song_version,
    metadata.remark,
    metadata.subtitle,
    metadata.subTitle,
  ];
  const songNameFields = [
    metadata.alias,
    metadata.alia,
    metadata.transNames,
    // Some provider search responses keep the version marker in their raw
    // song-name field while the normalized display title uses another field.
    // Kuwo, for example, returns NAME="风吹麦浪" and
    // SONGNAME="风吹麦浪 (Live)" in the same row. Keep the display title
    // unchanged, but inspect these provider-owned metadata fields before
    // filtering the row out.
    metadata.songname,
    metadata.songName,
    metadata.SONGNAME,
    metadata.song_name,
    metadata.filename,
    metadata.FileName,
  ];
  const hasLiveMarker = (value: unknown) =>
    (typeof value === 'string' || typeof value === 'number') && /\blive\b/i.test(String(value));
  // Migu's public search includes studio songs whose actual name is "Live",
  // including the studio album "Live In The Moment". That title alone is not
  // a performance-version marker; require separate version/name evidence.
  if (/^live$/i.test(track.title.trim()))
    return explicitVersionFields.some(hasLiveMarker) || songNameFields.some(value =>
      typeof value === 'string' && !/^live$/i.test(value.trim()) && hasLiveMarker(value),
    );
  return /\blive\b/i.test(
    [track.title, track.album, ...explicitVersionFields, ...songNameFields]
      .filter(value => typeof value === 'string' || typeof value === 'number')
      .join(' '),
  );
};

export async function loadLiveTracks(
  page: number,
  platforms: PlatformSetting[],
  provider: MediaProvider = 'all',
  limit = 20,
  searchOptions?: Parameters<typeof searchOnline>[9],
) {
  const enabled = platforms.filter(item => item.enabled);
  const selected =
    provider === 'all'
      ? enabled.map(item => item.id)
      : enabled.some(item => item.id === provider)
      ? [provider]
      : [];
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (!selected.length)
    return {
      tracks: [],
      errors: ['没有已启用的音乐平台'],
      hasMore: false,
    };

  // Home's song rail requests eighteen candidates per provider so filtering
  // does not turn a valid page into an unexpectedly short first batch.
  const perProvider =
    provider === 'all'
      ? Math.max(normalizedLimit, 18)
      : Math.max(normalizedLimit, 20);
  const settled = await Promise.allSettled(
    selected.map(id => {
      const args: Parameters<typeof searchOnline> = [
        mediaDiscoveryConfigs.live.query,
        page,
        perProvider,
        id,
        platforms,
        'music',
      ];
      if (searchOptions) {
        args[6] = 12_000;
        args[9] = searchOptions;
      }
      return searchOnline(...args);
    }),
  );
  const errors: string[] = [];
  const groups = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      errors.push(...result.value.errors);
      return result.value.tracks
        .filter(isLiveTrack)
        .map(track => ({
          ...enrichTrackPresentation(track),
          reason: `${mediaDiscoveryConfigs.live.title} · ${
            platformLabel(selected[index]!)
          }`,
        }));
    }
    errors.push(
      `${platformLabel(selected[index]!)}：${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`,
    );
    return [];
  });
  const hydratedGroups = await Promise.all(
    groups.map(group => hydrateNeteaseLiveCovers(group)),
  );
  const retryable = settled.some(
    result => result.status === 'rejected' || result.value.rawCount === null,
  );
  return {
    tracks: interleave(hydratedGroups, normalizedLimit),
    errors,
    retryable,
    hasMore:
      retryable ||
      settled.some(
        result =>
          result.status === 'fulfilled' &&
          (result.value.rawCount ?? result.value.tracks.length) >= perProvider,
      ),
  };
}

export async function loadMediaDiscovery(
  kind: MediaDiscoveryKind,
  page: number,
  platforms: PlatformSetting[],
  provider: MediaProvider = 'all',
) {
  const config = mediaDiscoveryConfigs[kind];
  const enabled = platforms.filter(item => item.enabled);
  const mediaType =
    kind === 'podcast'
      ? ('podcast' as const)
      : kind === 'audiobook'
      ? ('audiobook' as const)
      : ('music' as const);
  const typedProviders =
    kind === 'podcast' || kind === 'audiobook'
      ? new Set(mediaProviders(platforms, kind, false))
      : null;
  const selected =
    provider === 'all'
      ? enabled
          .filter(item => !typedProviders || typedProviders.has(item.id))
          .map(item => item.id)
      : enabled.some(
          item =>
            item.id === provider &&
            (!typedProviders || typedProviders.has(item.id)),
        )
      ? [provider]
      : [];
  if (!selected.length) return { tracks: [], errors: ['没有已启用的音乐平台'] };

  if (kind === 'live') return loadLiveTracks(page, platforms, provider, 20);

  const perProvider = provider === 'all' ? 8 : 20;
  const settled = await Promise.allSettled(
    selected.map(id =>
      searchOnline(config.query, page, perProvider, id, platforms, mediaType),
    ),
  );
  const errors: string[] = [];
  const groups = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      errors.push(...result.value.errors);
      return result.value.tracks.map(track => ({
        ...track,
        reason: `${config.title} · ${platformLabel(selected[index]!)}`,
      }));
    }
    errors.push(
      `${platformLabel(selected[index]!)}：${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`,
    );
    return [];
  });
  return { tracks: interleave(groups, 20), errors };
}
