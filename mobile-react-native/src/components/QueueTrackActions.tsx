import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { PlaylistMembershipDialog, usePlaylistMembershipPicker } from './PlaylistMembershipPicker';
import { TrackActionIcon } from './TrackActionIcon';
import { DownloadConfirmationDialog } from './DownloadConfirmationDialog';
import {
  isTrackDownloaded,
  trackPlaylistIds,
} from '../services/trackActionState';
import type { Track } from '../domain/types';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { Glyph } from './UI';
import type { DownloadPreview } from '../services/downloadPresentation';

export const PLAYER_ACTION_SIZE = 38;
export const PLAYER_ACTION_ICON_SIZE = 24;

export function QueueTrackActions({
  track,
  showRemove = true,
  scope = 'queue',
  player = scope === 'player',
  downloadFirst = false,
  showPlaylist = true,
  showFavorite = true,
  showDownload = true,
  onDownload,
  scale = 1,
  playerColor,
}: {
  track: Track | null;
  showRemove?: boolean;
  scope?: string;
  /** Visual treatment is independent of the page's action/test identity. */
  player?: boolean;
  downloadFirst?: boolean;
  showPlaylist?: boolean;
  showFavorite?: boolean;
  showDownload?: boolean;
  onDownload?: (track: Track, resolved?: DownloadPreview) => Promise<void>;
  scale?: number;
  playerColor?: string;
}) {
  const app = useApp();
  const openPlaylistPicker = usePlaylistMembershipPicker();
  const c = useTheme();
  const [playlistSelection, setPlaylistSelection] = useState<Track | null>(null);
  const [downloadSelection, setDownloadSelection] = useState<{ track: Track; usePlaybackUrl: boolean } | null>(null);
  const trackId = track?.id ?? 'empty';
  const favorite = Boolean(track && app.isFavorite(track));
  const downloaded = Boolean(track && isTrackDownloaded(app.state, track));
  const inPlaylist = Boolean(
    track && trackPlaylistIds(app.state, track).length,
  );
  // The 42-unit viewBox keeps the drawn shape at the original compact glyph size.
  const iconSize = PLAYER_ACTION_ICON_SIZE * scale;
  const inactiveColor = player ? playerColor ?? '#fff' : c.muted;
  const playerActionStyle = player
    ? {
        width: PLAYER_ACTION_SIZE * scale,
        height: PLAYER_ACTION_SIZE * scale,
      }
    : null;
  const closePlaylist = () => setPlaylistSelection(null);
  const downloadButton = (
    <Pressable
      testID={`${scope}-download-${trackId}`}
      accessibilityRole="button"
      accessibilityLabel="下载"
      disabled={!track}
      accessibilityState={{ disabled: !track, selected: downloaded }}
      onPress={() => {
        if (track) setDownloadSelection({
          track: { ...track, ...(track.metadata ? { metadata: { ...track.metadata,
            ...(track.metadata?._playbackAudio ? { _playbackAudio: { ...track.metadata._playbackAudio } } : {}),
          } } : {}) },
          usePlaybackUrl: scope === 'player',
        });
      }}
      style={[
        s.action,
        { width: 28 * scale, height: 36 * scale },
        playerActionStyle,
      ]}
    >
      <TrackActionIcon
        kind="download"
        active={downloaded}
        size={iconSize}
        color={downloaded ? c.accent : inactiveColor}
        testID={`${player ? 'player' : scope}-download-icon`}
      />
    </Pressable>
  );
  return (
    <>
      <View style={s.actions}>
        {showFavorite ? (
          <Pressable
            testID={`${scope}-favorite-${trackId}`}
            accessibilityRole="button"
            accessibilityLabel={favorite ? '取消收藏' : '收藏'}
            disabled={!track}
            accessibilityState={{ disabled: !track, selected: favorite }}
            onPress={() => {
              if (track) app.toggleFavorite(track);
            }}
            style={[
              s.action,
              { width: 28 * scale, height: 36 * scale },
              playerActionStyle,
            ]}
          >
            <TrackActionIcon
              kind="favorite"
              active={favorite}
              size={iconSize}
              color={
                favorite ? c.accent : player ? playerColor ?? c.text : c.muted
              }
              testID={`${player ? 'player' : scope}-favorite-icon`}
            />
          </Pressable>
        ) : null}
        {showDownload && downloadFirst ? downloadButton : null}
        {showPlaylist ? (
          <Pressable
            testID={`${scope}-playlist-${trackId}`}
            accessibilityRole="button"
            accessibilityLabel="添加至歌单"
            disabled={!track}
            accessibilityState={{ disabled: !track, selected: inPlaylist }}
            onPress={() => {
              if (track) { if (openPlaylistPicker) openPlaylistPicker(track); else setPlaylistSelection(track); }
            }}
            style={[
              s.action,
              { width: 28 * scale, height: 36 * scale },
              playerActionStyle,
            ]}
          >
            <TrackActionIcon
              kind="playlist"
              active={inPlaylist}
              size={iconSize}
              color={inPlaylist ? c.accent : inactiveColor}
              testID={`${player ? 'player' : scope}-playlist-icon`}
            />
          </Pressable>
        ) : null}
        {showDownload && !downloadFirst ? downloadButton : null}
        {showRemove ? (
          <Pressable
            testID={`${scope}-remove-${trackId}`}
            accessibilityRole="button"
            accessibilityLabel="从播放列表删除"
            disabled={!track}
            accessibilityState={{ disabled: !track }}
            onPress={() => {
              if (!track) return;
              return app.removeQueueTrack(track.id).catch(() => undefined);
            }}
            style={[
              s.action,
              { width: 28 * scale, height: 36 * scale },
              playerActionStyle,
            ]}
          >
            <Glyph
              color={player ? playerColor ?? '#fff' : c.muted}
              size={player ? 34 : 17 * scale}
            >
              ×
            </Glyph>
          </Pressable>
        ) : null}
      </View>
      {playlistSelection ? (
        <PlaylistMembershipDialog track={playlistSelection} onClose={closePlaylist} />
      ) : null}
      {downloadSelection ? (
        <DownloadConfirmationDialog
          tracks={[downloadSelection.track]}
          usePlaybackUrl={downloadSelection.usePlaybackUrl}
          onClose={() => setDownloadSelection(null)}
          onDownload={onDownload}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    flexShrink: 0,
  },
  action: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
