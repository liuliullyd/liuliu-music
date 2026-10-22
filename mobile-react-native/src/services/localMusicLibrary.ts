import { trackQueueKey, type DownloadEntry, type Track } from '../domain/types';
import { isLocalAudioUri, localPlaybackReference } from './libraryPlayback';
export function localMusicFileReferences(track: Track): string[] {
  const reference = localPlaybackReference(track);
  const identity = localMediaFileIdentity(track);
  return [
    ...new Set(
      [reference, identity].filter((value): value is string => Boolean(value)),
    ),
  ];
}
export function matchesLocalMusicFile(
  track: Track,
  reference: string,
  identities: Readonly<Record<string, string>>,
) {
  return localMusicFileReferences(track).some(
    value =>
      value === reference ||
      Boolean(identities[value] && identities[value] === identities[reference]),
  );
}
export async function resolveLocalMusicArtwork(
  track: Track,
  downloads: DownloadEntry[],
  identities: Readonly<Record<string, string>>,
  adapters: {
    read: (reference: string) => Promise<string | null>;
    supplement: (track: Track) => Promise<string[]>;
  },
): Promise<string | null> {
  const reference = localPlaybackReference(track);
  if (!reference) return null;
  const embedded = await adapters.read(reference).catch(() => null);
  if (embedded) return embedded;
  const download = downloads.find(
    entry =>
      entry.status === 'downloaded' &&
      entry.track.cover &&
      [entry.id, ...localMusicFileReferences(entry.track)].some(value =>
        matchesLocalMusicFile(track, value, identities),
      ),
  );
  if (download?.track.cover) return download.track.cover;
  const candidates = await adapters.supplement(track).catch(() => []);
  return candidates[0] ?? null;
}
export function removeDownloadedMusic(
  localTracks: Track[],
  downloads: DownloadEntry[],
  removed: DownloadEntry,
  deletedReference?: string,
  identities: Readonly<Record<string, string>> = {},
) {
  return {
    downloads: downloads.filter(
      entry =>
        entry.id !== removed.id ||
        trackQueueKey(entry.track) !== trackQueueKey(removed.track),
    ),
    localTracks: deletedReference
      ? localTracks.filter(
          track => !matchesLocalMusicFile(track, deletedReference, identities),
        )
      : localTracks,
  };
}
/** Sync a completed download once, so removing a local listing stays removed. */
export function syncDownloadedMusic(
  localTracks: Track[],
  downloads: DownloadEntry[],
) {
  let tracks = localTracks;
  const entries = downloads.map(entry => {
    if (entry.localLibrarySynced || entry.status !== 'downloaded') return entry;
    const reference = isLocalAudioUri(entry.track.playUrl)
      ? entry.track.playUrl
      : isLocalAudioUri(entry.id) || /^download:\d+$/.test(entry.id)
      ? entry.id
      : null;
    if (!reference) return entry;
    const local: Track = {
      ...entry.track,
      playUrl: isLocalAudioUri(reference) ? reference : undefined,
      metadata: { ...entry.track.metadata, _libraryLocalFile: reference },
    };
    const index = tracks.findIndex(
      track =>
        trackQueueKey(track) === trackQueueKey(local) ||
        localPlaybackReference(track) === reference,
    );
    tracks =
      index < 0
        ? [...tracks, local]
        : tracks.map((track, i) =>
            i === index
              ? trackQueueKey(track) === trackQueueKey(local)
                ? {
                    ...track,
                    ...local,
                    cover: track.cover || local.cover,
                    metadata: { ...track.metadata, ...local.metadata },
                  }
                : { ...track, cover: track.cover || local.cover }
              : track,
          );
    return { ...entry, localLibrarySynced: true };
  });
  return { localTracks: tracks, downloads: entries };
}

/** Android may confirm two granted content URIs refer to the same audio file. */
export function localMediaFileIdentity(track: Track): string | null {
  const identity = track.metadata?._libraryLocalFileIdentity;
  return typeof identity === 'string' && isLocalAudioUri(identity)
    ? identity
    : localPlaybackReference(track);
}
/** Assign only user-selected local files; ordinary audio metadata cannot infer a media kind. */
