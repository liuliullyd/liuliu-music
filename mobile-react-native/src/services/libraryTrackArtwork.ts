import {
  trackQueueKey,
  type PlatformSetting,
  type Track,
} from '../domain/types';
import { localPlaybackReference } from './libraryPlayback';
import { localTrackForLyrics } from './localLyrics';
import { playerCoverCandidates } from './onlineCatalog';
import { searchOnline } from './onlineMusic';

const artworkCache = new Map<string, string[]>();
let cacheGeneration = 0;
const artworkRequests = new Map<string, Promise<string[]>>();

export function clearLibraryTrackArtworkCache() {
  cacheGeneration += 1;
  artworkCache.clear();
}
const normalize = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[\s\u3000'"“”‘’·•,，.。!！?？:：/\\|、()[\]{}<>《》]/g, '');

export function libraryArtworkKey(track: Track, platforms: PlatformSetting[]) {
  return `${trackQueueKey(track)}|${localPlaybackReference(track)}|${platforms
    .filter(platform => platform.enabled)
    .map(platform => platform.id)
    .join(',')}`;
}

/** A local file can match an online identity; a download must retain its original platform and ID. */
export function isMatchingLibraryArtwork(source: Track, candidate: Track) {
  if (candidate.provider === 'custom') return false;
  if (source.provider !== 'custom') {
    if (source.provider !== candidate.provider) return false;
    if (
      source.providerId &&
      candidate.providerId &&
      source.providerId !== candidate.providerId
    )
      return false;
  }
  const title = normalize(source.title);
  const artist = normalize(source.artist);
  return Boolean(
    title &&
      artist &&
      title === normalize(candidate.title) &&
      artist === normalize(candidate.artist) &&
      (!source.duration ||
        !candidate.duration ||
        Math.abs(source.duration - candidate.duration) <= 12),
  );
}

export function cachedLibraryArtwork(
  track: Track,
  platforms: PlatformSetting[],
) {
  return artworkCache.get(libraryArtworkKey(track, platforms));
}

/** Presentation-only lookup for the selected disk file. No audio resolution or queue mutation. */
export function getLibraryTrackArtwork(
  track: Track,
  platforms: PlatformSetting[],
  exhausted = false,
): Promise<string[]> {
  if (!localPlaybackReference(track)) return Promise.resolve([]);
  const existing = playerCoverCandidates(track);
  if (existing.length && !exhausted) return Promise.resolve(existing);
  const key = libraryArtworkKey(track, platforms);
  const cached = artworkCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = artworkRequests.get(key);
  if (pending) return pending;
  const generation = cacheGeneration;
  const request = localTrackForLyrics(track)
    .then(async identity => {
      if (!identity) return [];
      const result = await searchOnline(
        `${identity.title} ${identity.artist}`.trim(),
        1,
        8,
        identity.provider === 'custom' ? 'all' : identity.provider,
        platforms,
      );
      const match = result.tracks.find(candidate =>
        isMatchingLibraryArtwork(identity, candidate),
      );
      return match ? playerCoverCandidates(match) : [];
    })
    .catch(() => [] as string[])
    .then(uris => {
      if (uris.length && generation === cacheGeneration) {
        artworkCache.set(key, uris);
        if (artworkCache.size > 64)
          artworkCache.delete(artworkCache.keys().next().value!);
      }
      return uris;
    })
    .finally(() => artworkRequests.delete(key));
  artworkRequests.set(key, request);
  return request;
}
