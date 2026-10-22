import type { CatalogItem, Track } from '../domain/types';
import { albumIdentityId, artistIdentityId } from './onlineMusic';
import { trackCoverCandidates } from './onlineCatalog';

export interface SearchEntity {
  key: string;
  title: string;
  track: Track;
  item: CatalogItem;
}

const normalized = (value: string) =>
  value
    .trim()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const firstArtist = (value: string) =>
  value.split(/[/、,&·]|feat\.?|ft\.?/i)[0]?.trim() || value.trim();

function searchEntity(
  track: Track,
  kind: 'artist' | 'album',
  title: string,
  id: string,
  fallbackId: string,
): SearchEntity | null {
  if (track.provider === 'custom') return null;
  const identity = id || fallbackId;
  // Persist only descriptive data and entity IDs. Resolved/raw audio URLs and
  // playback preparation state never belong to an entity favorite.
  const entityTrack: Track = {
    id: track.id,
    title: track.title,
    artist: firstArtist(track.artist),
    album: track.album,
    duration: track.duration,
    provider: track.provider,
    providerId: track.providerId,
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
  return {
    key: `${track.provider}:${kind}:${identity}`,
    title,
    track,
    item: {
      id: identity,
      title,
      description: kind === 'album' ? track.artist : '',
      provider: track.provider,
      kind: kind === 'album' ? 'new-albums' : 'playlists',
      cover: track.cover,
      coverCandidates: trackCoverCandidates(track),
      artist: firstArtist(track.artist),
      metadata: {
        detailLayout: 'playlist',
        detailTopGradient: true,
        collectionKind: kind === 'artist' ? 'artist' : 'new-albums',
        entityTrack,
      },
    },
  };
}

/** Provider identity keeps equal names on different platforms separate. */
export function collectSearchArtists(tracks: Track[]): SearchEntity[] {
  const entities = new Map<string, SearchEntity>();
  for (const track of tracks) {
    const title = firstArtist(track.artist);
    if (!title) continue;
    const entity = searchEntity(
      track,
      'artist',
      title,
      artistIdentityId(track),
      normalized(title),
    );
    if (entity && !entities.has(entity.key)) entities.set(entity.key, entity);
  }
  return [...entities.values()];
}

/** A missing album ID retains the existing provider/name/artist fallback. */
export function collectSearchAlbums(tracks: Track[]): SearchEntity[] {
  const entities = new Map<string, SearchEntity>();
  for (const track of tracks) {
    const title = track.album.trim();
    if (!title) continue;
    const entity = searchEntity(
      track,
      'album',
      title,
      albumIdentityId(track),
      `${normalized(title)}:${normalized(firstArtist(track.artist))}`,
    );
    if (entity && !entities.has(entity.key)) entities.set(entity.key, entity);
  }
  return [...entities.values()];
}
