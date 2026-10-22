import type { Track } from '../domain/types';
import { localPlaybackReference, isLocalAudioUri } from './libraryPlayback';
import { readLocalAudioMetadata } from './storage';

type LocalTags = Awaited<ReturnType<typeof readLocalAudioMetadata>>;
const metadataCache = new Map<string, LocalTags>();
let cacheGeneration = 0;
const metadataRequests = new Map<string, Promise<LocalTags>>();

export function clearLocalMetadataCache() {
  cacheGeneration += 1;
  metadataCache.clear();
}

function localMetadata(uri: string): Promise<LocalTags> {
  const cached = metadataCache.get(uri);
  if (cached) return Promise.resolve(cached);
  const pending = metadataRequests.get(uri);
  if (pending) return pending;
  const generation = cacheGeneration;
  const request = readLocalAudioMetadata(uri)
    .then(tags => {
      if (generation === cacheGeneration) metadataCache.set(uri, tags);
      if (metadataCache.size > 64)
        metadataCache.delete(metadataCache.keys().next().value!);
      return tags;
    })
    .catch(() => ({}))
    .finally(() => metadataRequests.delete(uri));
  metadataRequests.set(uri, request);
  return request;
}

const knownArtist = (value: unknown): value is string =>
  typeof value === 'string' &&
  Boolean(value.trim()) &&
  !/^(本地音乐|设备音乐|未知歌手|未知艺术家|未知|unknown|<unknown>)$/i.test(
    value.trim(),
  );

/** Shared lyric/artwork identity only; never change the file URI or playback identity. */
export async function localTrackForLyrics(track: Track): Promise<Track | null> {
  const uri = localPlaybackReference(track);
  if (track.provider !== 'custom' || !isLocalAudioUri(uri)) return track;
  const tagged = await localMetadata(uri);
  const fileName = track.title.replace(
    /\.(mp3|flac|m4a|aac|wav|ogg|opus)$/i,
    '',
  );
  const named = fileName.match(/^(.+?)\s+-\s+(.+)$/);
  const artist = knownArtist(tagged.artist)
    ? tagged.artist.trim()
    : knownArtist(track.artist)
    ? track.artist.trim()
    : named?.[1]?.trim();
  if (!artist || !knownArtist(artist)) return null;
  const title =
    tagged.title?.trim() ||
    (named && !knownArtist(track.artist) ? named[2]!.trim() : fileName);
  if (!title || /^(本地音乐|设备音乐)$/i.test(title)) return null;
  return {
    ...track,
    title,
    artist,
    album: tagged.album?.trim() || track.album,
    duration:
      tagged.durationSeconds && tagged.durationSeconds > 0
        ? tagged.durationSeconds
        : track.duration,
  };
}
