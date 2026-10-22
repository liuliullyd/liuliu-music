import {
  trackQueueKey,
  type PersistedState,
  type Playlist,
  type Track,
} from '../domain/types';
import { trackMediaKind } from './mediaLibrary';

type ActionState = Pick<
  PersistedState,
  | 'downloads'
  | 'playlists'
  | 'savedTracks'
  | 'podcastLibrary'
  | 'audiobookLibrary'
>;

const sameTrack = (left: Track, right: Track) =>
  trackMediaKind(left) === trackMediaKind(right) &&
  trackQueueKey(left) === trackQueueKey(right);

/** A queued or failed transfer never represents a completed local download. */
export function isTrackDownloaded(state: ActionState, track: Track): boolean {
  const kind = trackMediaKind(track);
  const downloads =
    kind === 'music'
      ? state.downloads
      : kind === 'podcast'
      ? state.podcastLibrary?.downloads
      : state.audiobookLibrary?.downloads;
  return (downloads ?? []).some(
    entry => entry.status === 'downloaded' && sameTrack(entry.track, track),
  );
}

/** Personal playlists retain their stored ids; metadata bridges display-id aliases. */
export function isTrackInPlaylist(
  state: ActionState,
  track: Track,
  playlist: Playlist,
): boolean {
  const saved = [
    ...(state.savedTracks ?? []),
    ...(state.podcastLibrary?.savedTracks ?? []),
    ...(state.audiobookLibrary?.savedTracks ?? []),
  ];
  return playlist.trackIds.some(id => {
    const matchingIds = saved.filter(song => song.id === id);
    return matchingIds.length
      ? matchingIds.some(song => sameTrack(song, track))
      : id === track.id;
  });
}

export function trackPlaylistIds(state: ActionState, track: Track): string[] {
  return (state.playlists ?? [])
    .filter(playlist => isTrackInPlaylist(state, track, playlist))
    .map(playlist => playlist.id);
}

/** Remove this song's stored aliases only from the selected playlist, retaining all song records. */
export function removeTrackPlaylistMembership(state: PersistedState, track: Track, playlistId: string): PersistedState {
  const selected = state.playlists.find(playlist => playlist.id === playlistId);
  if (!selected) return state;
  const saved = [...state.savedTracks, ...state.podcastLibrary.savedTracks, ...state.audiobookLibrary.savedTracks];
  const knownIds = new Set(saved.map(song => song.id));
  const matchingIds = new Set(saved.filter(song => sameTrack(song, track)).map(song => song.id));
  const trackIds = selected.trackIds.filter(id => !matchingIds.has(id) && (knownIds.has(id) || id !== track.id));
  if (trackIds.length === selected.trackIds.length) return state;
  return { ...state, playlists: state.playlists.map(playlist => playlist.id === playlistId
    ? { ...playlist, trackIds, updatedAt: Date.now() } : playlist) };
}
