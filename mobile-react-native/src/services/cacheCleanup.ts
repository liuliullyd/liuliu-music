import type {
  MediaLibraryBucket,
  PersistedState,
  Track,
} from '../domain/types';

/** Forget only generated artwork files removed by the native cleaner. */
export function forgetClearedLocalArtwork(
  state: PersistedState,
  deletedUris: string[],
): PersistedState {
  if (!deletedUris.length) return state;
  const deleted = new Set(deletedUris);
  const reset = (track: Track): Track =>
    track.cover && deleted.has(track.cover)
      ? { ...track, cover: undefined }
      : track;
  const bucket = (value: MediaLibraryBucket): MediaLibraryBucket => ({
    ...value,
    savedTracks: value.savedTracks.map(reset),
    localTracks: value.localTracks?.map(reset),
    downloads: value.downloads.map(entry => ({
      ...entry,
      track: reset(entry.track),
    })),
  });
  return {
    ...state,
    savedTracks: state.savedTracks.map(reset),
    localTracks: state.localTracks.map(reset),
    downloads: state.downloads.map(entry => ({
      ...entry,
      track: reset(entry.track),
    })),
    podcastLibrary: bucket(state.podcastLibrary),
    audiobookLibrary: bucket(state.audiobookLibrary),
  };
}
