import type {
  HistoryEntry,
  MusicHistoryOrigin,
  PersistedState,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import type { useApp } from '../state/AppContext';
import {
  libraryPlaybackTrack,
  libraryUnavailableReason,
} from './libraryPlayback';
import { trackMediaKind } from './mediaLibrary';
import {} from './mediaPlaybackProgress';
import { PLATFORM_UNBOUND_MESSAGE } from './playbackSourceAvailability';
export type LibraryPlayer = Pick<
  ReturnType<typeof useApp>,
  | 'state'
  | 'recommendationPlatforms'
  | 'playTrack'
  | 'notify'
  | 'player'
  | 'current'
  | 'captureQueueOrigin'
>;
export const libraryReason = (
  app: LibraryPlayer,
  track: Track,
  requireLocal = false,
) =>
  libraryUnavailableReason(
    libraryPlaybackTrack(track, app.state),
    new Set(app.recommendationPlatforms.map(platform => platform.id)),
    requireLocal,
  );
export const libraryPlayableTracks = (
  app: LibraryPlayer,
  tracks: Track[],
  requireLocal = false,
) =>
  tracks
    .map(track => libraryPlaybackTrack(track, app.state))
    .filter(
      track =>
        !libraryUnavailableReason(
          track,
          new Set(app.recommendationPlatforms.map(platform => platform.id)),
          requireLocal,
        ),
    );
export const playLibraryTrack = (
  app: LibraryPlayer,
  track: Track,
  tracks: Track[],
  requireLocal = false,
  historyOrigin?: MusicHistoryOrigin,
  _reserved?: undefined,
  bulk?: {
    onUnavailableTrack?: (key: string) => void;
  },
) => {
  const reason = libraryReason(app, track, requireLocal);
  if (reason) {
    app.notify(reason === '该平台不可用' ? PLATFORM_UNBOUND_MESSAGE : reason);
    return;
  }
  const playable = libraryPlayableTracks(app, tracks, requireLocal);
  const index = playable.findIndex(
    item => trackQueueKey(item) === trackQueueKey(track),
  );
  if (index < 0) return;
  const queueOrigin =
    historyOrigin && 'playlistId' in historyOrigin && historyOrigin.playlistId
      ? app.captureQueueOrigin?.(undefined, {
          personalPlaylistId: historyOrigin.playlistId,
        })
      : app.captureQueueOrigin?.();
  const options = {
    ...(bulk
      ? { bulkPlay: true, onUnavailableTrack: bulk.onUnavailableTrack }
      : {}),
    ...(queueOrigin ? { queueOrigin } : {}),
    ...(historyOrigin ? { historyOrigin } : {}),
    ...{},
  };
  const request =
    historyOrigin || undefined || queueOrigin || bulk
      ? app.playTrack(playable[index]!, playable, index, options)
      : app.playTrack(playable[index]!, playable, index);
  request.catch(error =>
    app.notify(error instanceof Error ? error.message : '播放失败'),
  );
};
export const collectKnownTracks = (
  state: PersistedState,
  current: Track | null,
) => [
  ...new Map(
    [
      ...state.savedTracks,
      ...state.localTracks,
      ...state.downloads.map(item => item.track),
      ...state.history.map(item => item.track),
      ...(current ? [current] : []),
    ].map(track => [
      `${trackMediaKind(track)}:${track.provider}:${track.id}`,
      track,
    ]),
  ).values(),
];
