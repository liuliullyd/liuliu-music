import type {
  CatalogItem,
  MusicEntityHistoryEntry,
  MusicEntityKind,
  MusicHistoryOrigin,
  Playlist,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import {
  collectionEntityKind,
  collectionFavoriteKey,
} from './collectionIdentity';
import { albumIdentityId, artistIdentityId } from './onlineMusic';
const providers = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui']);
const validId = (value: unknown) => {
  const id = value == null ? '' : String(value).trim();
  return id === '0' || id === '-1' ? '' : id;
};
function describeTrack(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    provider: track.provider,
    providerId: track.providerId,
    duration: track.duration,
    cover: track.cover,
    coverKey: track.coverKey,
    language: track.language,
    genre: track.genre,
    mood: track.mood,
    releaseYear: track.releaseYear,
    metadata: {
      artistId: artistIdentityId(track),
      albumId: albumIdentityId(track),
    },
  };
}
function describeCollection(item: CatalogItem): CatalogItem {
  const metadata = item.metadata ?? {};
  const entityTrack = metadata.entityTrack as Track | undefined;
  const releaseTrack = metadata.releaseTrack as Track | undefined;
  return {
    id: item.id,
    provider: item.provider,
    kind: item.kind,
    title: item.title,
    description: item.description ?? '',
    cover: item.cover,
    coverCandidates: Array.isArray(item.coverCandidates)
      ? item.coverCandidates.filter(uri => typeof uri === 'string')
      : undefined,
    artist: item.artist,
    releaseDate: item.releaseDate,
    trackCount: item.trackCount,
    metadata: {
      detailLayout: 'playlist',
      detailTopGradient: true,
      ...(typeof metadata.collectionKind === 'string'
        ? { collectionKind: metadata.collectionKind }
        : {}),
      ...(metadata.source === 'home-live' ? { source: metadata.source } : {}),
      ...(metadata.releaseType === 'single'
        ? { releaseType: metadata.releaseType }
        : {}),
      ...(entityTrack?.provider === item.provider
        ? { entityTrack: describeTrack(entityTrack) }
        : {}),
      ...(releaseTrack?.provider === item.provider
        ? { releaseTrack: describeTrack(releaseTrack) }
        : {}),
    },
  };
}
export function musicEntityHistoryKey(entry: MusicEntityHistoryEntry) {
  return 'playlistId' in entry
    ? `personal:playlist:${entry.playlistId}`
    : collectionFavoriteKey(entry.item);
}
export function normalizeMusicEntityHistory(
  value: unknown,
): MusicEntityHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: MusicEntityHistoryEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as MusicEntityHistoryEntry;
    if (
      !['playlist', 'album', 'artist'].includes(entry.kind) ||
      !Number.isFinite(entry.playedAt) ||
      entry.playedAt <= 0
    )
      continue;
    if ('playlistId' in entry) {
      if (
        entry.kind !== 'playlist' ||
        typeof entry.playlistId !== 'string' ||
        !validId(entry.playlistId) ||
        typeof entry.title !== 'string' ||
        !entry.title.trim()
      )
        continue;
      entries.push({
        kind: 'playlist',
        playlistId: entry.playlistId,
        title: entry.title,
        coverKey: ['train', 'cat', 'ocean', 'vinyl'].includes(entry.coverKey)
          ? entry.coverKey
          : 'vinyl',
        playedAt: entry.playedAt,
      });
    } else if (
      entry.item &&
      providers.has(entry.item.provider) &&
      typeof entry.item.id === 'string' &&
      validId(entry.item.id) &&
      typeof entry.item.title === 'string' &&
      entry.item.title.trim() &&
      ['playlists', 'new-albums', 'new-songs', 'charts'].includes(
        entry.item.kind,
      )
    ) {
      const kind = collectionEntityKind(entry.item);
      if (
        (kind === 'artist' || kind === 'album' ? kind : 'playlist') !==
        entry.kind
      )
        continue;
      entries.push({
        kind: entry.kind,
        item: describeCollection(entry.item),
        playedAt: entry.playedAt,
      });
    }
  }
  const unique = new Map<string, MusicEntityHistoryEntry>();
  for (const entry of entries.sort((a, b) => b.playedAt - a.playedAt)) {
    const key = musicEntityHistoryKey(entry);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()].slice(0, 300);
}
export function mergeMusicEntityHistory(
  existing: MusicEntityHistoryEntry[],
  added: MusicEntityHistoryEntry[],
) {
  return normalizeMusicEntityHistory([...added, ...existing]);
}
function entityItem(
  track: Track,
  kind: 'album' | 'artist',
  id: string,
  title: string,
  cover?: string,
): CatalogItem {
  const entityTrack = describeTrack(track);
  return {
    id,
    title,
    provider: track.provider as CatalogItem['provider'],
    kind: kind === 'album' ? 'new-albums' : 'playlists',
    description: kind === 'album' ? track.artist : '',
    cover,
    artist: track.artist,
    metadata: {
      detailLayout: 'playlist',
      detailTopGradient: true,
      collectionKind: kind === 'album' ? 'new-albums' : 'artist',
      entityTrack,
    },
  };
}
function playedEntities(
  track: Track,
  origin: MusicHistoryOrigin | null,
  playlists: Playlist[],
  playedAt: number,
) {
  const entries: MusicEntityHistoryEntry[] = [];
  if (origin && 'playlistId' in origin) {
    const playlist = playlists.find(item => item.id === origin.playlistId);
    if (playlist)
      entries.push({
        kind: 'playlist',
        playlistId: playlist.id,
        title: playlist.title,
        coverKey: playlist.coverKey,
        playedAt,
      });
  } else if (origin) {
    const kind = collectionEntityKind(origin.item);
    const entityTrack = origin.item.metadata?.entityTrack as Track | undefined;
    const hasRealIdentity =
      kind === 'artist' && entityTrack
        ? Boolean(validId(artistIdentityId(entityTrack)))
        : kind === 'album' && entityTrack
        ? Boolean(validId(albumIdentityId(entityTrack)))
        : origin.item.metadata?.releaseType !== 'single';
    if (hasRealIdentity)
      entries.push({
        kind: (kind === 'album' || kind === 'artist'
          ? kind
          : 'playlist') as MusicEntityKind,
        item: describeCollection(origin.item),
        playedAt,
      });
  }
  if (!providers.has(track.provider) || !track.metadata)
    return normalizeMusicEntityHistory(entries);
  const albumId = validId(albumIdentityId(track));
  if (albumId && track.album.trim())
    entries.push({
      kind: 'album',
      item: entityItem(track, 'album', albumId, track.album, track.cover),
      playedAt,
    });
  // Prefer structured artist identities; a display-name split is not evidence
  // that a second provider artist entity was actually part of this recording.
  const metadata = track.metadata as Record<string, unknown>;
  const groups = [
    'artistEntities',
    'singerList',
    'Singers',
    'singer',
    'ar',
    'artists',
  ];
  let artists: Record<string, unknown>[] = [];
  for (const key of groups) {
    const group = metadata[key];
    const values = Array.isArray(group) ? group : [group];
    const structured = values.filter(
      value => value && typeof value === 'object',
    ) as Record<string, unknown>[];
    if (structured.length) {
      artists = structured;
      break;
    }
  }
  if (!artists.length) {
    const id = validId(artistIdentityId(track));
    const name = String(
      metadata.artistName ??
        metadata.singerName ??
        track.artist.split(/[/、,&·]|feat\.?|ft\.?/i)[0] ??
        '',
    ).trim();
    if (id && name) artists = [{ id, name }];
  }
  for (const artist of artists) {
    const artistTrack = { ...track, metadata: { artistEntities: [artist] } };
    const id = validId(artistIdentityId(artistTrack));
    const name = String(
      artist.name ??
        artist.singername ??
        artist.Name ??
        artist.singerName ??
        '',
    ).trim();
    if (!id || !name) continue;
    const cover = artist.picUrl ?? artist.avatar ?? artist.pic;
    entries.push({
      kind: 'artist',
      item: entityItem(
        { ...artistTrack, artist: name },
        'artist',
        id,
        name,
        typeof cover === 'string' ? cover : undefined,
      ),
      playedAt,
    });
  }
  return normalizeMusicEntityHistory(entries);
}
/** Passive bookkeeping only: this class never calls a player or catalog API. */
export class MusicEntityHistoryRecorder {
  private origin: MusicHistoryOrigin | null = null;
  private pending: {
    generation: number;
    key: string;
    accepted: boolean;
  } | null = null;
  private last = '';
  private generation = 0;
  getOrigin() {
    return this.origin;
  }
  begin(generation: number, key: string, origin: MusicHistoryOrigin | null) {
    this.origin = origin;
    this.navigate(generation, key);
  }
  navigate(generation: number, key: string) {
    this.generation = generation;
    this.pending = { generation, key, accepted: false };
  }
  accept(generation: number, key: string) {
    if (this.pending?.generation === generation && this.pending.key === key)
      this.pending.accepted = true;
  }
  confirm(
    generation: number,
    key: string,
    track: Track,
    playlists: Playlist[],
    playedAt = Date.now(),
  ) {
    if (generation < this.generation) return [];
    if (key !== trackQueueKey(track)) return [];
    if (
      this.pending &&
      (this.pending.generation !== generation ||
        this.pending.key !== key ||
        !this.pending.accepted)
    )
      return [];
    const token = `${generation}:${key}`;
    if (this.last === token) return [];
    this.pending = null;
    this.generation = generation;
    this.last = token;
    return playedEntities(track, this.origin, playlists, playedAt);
  }
}
