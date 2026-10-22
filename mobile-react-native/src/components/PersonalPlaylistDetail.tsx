import React from 'react';
import { View } from 'react-native';
import type { Track } from '../domain/types';
import { trackQueueKey } from '../domain/types';
import { libraryPlaybackTrack } from '../services/libraryPlayback';
import { libraryPlayableTracks } from '../services/libraryPlaybackActions';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { useApp } from '../state/AppContext';
import { HomePlaylistDetail } from './HomePlaylistDetail';
import { PlaylistShareButton } from './PlaylistShareButton';
import { LibraryMusicTrackRow } from './LibraryMusicTrackRow';
import { LibraryPlaylistActions } from './LibraryPlaylistActions';
import { useVisibleTrackPrewarm } from './useVisibleTrackPrewarm';

export function PersonalPlaylistDetail({
  playlistId,
  title,
  tracks: inputTracks,
  fallbackCoverKey,
  playlistCover,
  description,
  onBack,
  onDeleted,
}: {
  playlistId: string;
  title: string;
  tracks: Track[];
  fallbackCoverKey: Track['coverKey'];
  playlistCover?: string;
  description?: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const app = useApp();
  const visiblePrewarm = useVisibleTrackPrewarm({
    identity: `personal:${playlistId}:${app.prewarmContextKey ?? app.state.settings.quality}:${app.pageRefreshToken ?? 0}`,
    enabled: app.page === 'personal-playlist',
    tracks: inputTracks.map(track => libraryPlaybackTrack(track, app.state)),
    prewarm: app.prewarmDetailTracks,
    release: app.releaseDetailPrewarm,
  });
  const tracks = inputTracks.filter(track => !visiblePrewarm.failedKeys.has(trackQueueKey(track)));
  return (
    <HomePlaylistDetail
      identity={`personal:${playlistId}`}
      title={title}
      subtitle={`${tracks.length} 首`}
      description={description}
      cover={playlistCover ?? tracks[0]?.cover}
      coverKey={tracks[0]?.coverKey ?? fallbackCoverKey}
      coverCandidates={playlistCover ? [playlistCover] : tracks[0] ? trackCoverCandidates(tracks[0]) : []}
      libraryArtwork
      insetList
      onBack={onBack}
      headerActions={<PlaylistShareButton personal={{ title, description,
        cover: playlistCover ?? inputTracks[0]?.cover, coverKey: inputTracks[0]?.coverKey ?? fallbackCoverKey, tracks: inputTracks,
        expectedTrackCount: app.state.playlists.find(value => value.id === playlistId)?.trackIds.length }} />}
      onLayout={visiblePrewarm.onLayout}
      onScroll={event => visiblePrewarm.onScroll(event.nativeEvent)}
      onControlsLayout={visiblePrewarm.onControlsLayout}
      onTrackListLayout={visiblePrewarm.onListLayout}
      scrollTestID="library-own-playlist-detail"
      controlsTestID="library-list-controls"
      coverTestID="library-list-detail-cover"
      actions={
        <LibraryPlaylistActions
          tracks={libraryPlayableTracks(app, tracks)}
          showFavorite={false}
          personalPlaylist={{ id: playlistId, title, onDeleted }}
          historyOrigin={{ playlistId }}
          onUnavailableTrack={visiblePrewarm.rejectTrack}
          surfaceColor="transparent"
          sticky
        />
      }
    >
      {tracks.map((track, index) => (
        <View key={trackQueueKey(track)} onLayout={event => visiblePrewarm.onRowLayout(trackQueueKey(track), event)}><LibraryMusicTrackRow
          track={track}
          onPlay={() =>
            app
              .playTrack(
                libraryPlaybackTrack(track, app.state),
                tracks.map(item => libraryPlaybackTrack(item, app.state)),
                index,
                { historyOrigin: { playlistId }, queueOrigin: app.captureQueueOrigin?.(title, { personalPlaylistId: playlistId }) },
              )
              .catch(error =>
                app.notify(
                  error instanceof Error ? error.message : '播放失败，请重试',
                ),
              )
          }
        /></View>
      ))}
    </HomePlaylistDetail>
  );
}
