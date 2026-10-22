import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '../domain/types';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { TrackPlatformDuration } from './UI';
import { covers } from '../assets/covers';
import { LibraryArtwork } from './LibraryArtwork';
import { platformLabel } from './platformLabels';
import { QueueTrackActions } from './QueueTrackActions';
import type { DownloadPreview } from '../services/downloadPresentation';

/** Catalog metadata and actions only; the caller retains its original play array/index. */
export function LibraryMusicTrackRow({
  track,
  subtitle,
  title,
  metadataLabel,
  showActions = true,
  onPlay,
  onDelete,
  showDownload = true,
  showPlaylist = true,
  showProvider = true,
  onDownload,
  unavailableReason,
  downloadStatus,
  downloadProgress,
}: {
  track: Track;
  subtitle?: string;
  title?: string;
  metadataLabel?: string;
  showActions?: boolean;
  onPlay: () => void;
  onDelete?: () => void;
  showDownload?: boolean;
  showPlaylist?: boolean;
  showProvider?: boolean;
  onDownload?: (track: Track, resolved?: DownloadPreview) => Promise<void>;
  unavailableReason?: string;
  downloadStatus?: string;
  downloadProgress?: number;
}) {
  const app = useApp();
  const c = useTheme();
  const layout = useLayout();
  const active =
    app.current?.provider === track.provider && app.current?.id === track.id;
  return (
    <View
      testID={`library-track-row-${track.id}`}
      style={[s.row, { minHeight: layout.trackRowHeight }]}
    >
      <Pressable
        testID={`library-track-body-${track.id}`}
        accessibilityRole="button"
        accessibilityLabel={`播放 ${title ?? track.title}`}
        accessibilityState={{
          selected: active,
          disabled: Boolean(unavailableReason),
        }}
        disabled={Boolean(unavailableReason)}
        onPress={unavailableReason ? undefined : onPlay}
        style={[s.main, { minHeight: layout.trackRowHeight }]}
      >
        <LibraryArtwork
          fallback={covers[track.coverKey]}
          uri={track.cover}
          uris={trackCoverCandidates(track)}
          moduleKey="library-music-rows"
          testID="library-track-cover"
          style={{
            width: layout.trackCoverSize,
            height: layout.trackCoverSize,
          }}
          imageStyle={{ borderRadius: 7 }}
          clipToImageStyle
        />
        <View style={s.copy}>
          <Text
            numberOfLines={1}
            style={[
              s.title,
              { color: unavailableReason ? c.muted : active ? c.blue : c.text },
            ]}
          >
            {title ?? track.title}
          </Text>
          <Text numberOfLines={1} style={[s.artist, { color: c.muted }]}>
            {subtitle ?? track.artist}
          </Text>
          {downloadStatus ? <Text testID={`download-status-${track.id}`} style={[s.downloadStatus, { color: c.accent }]}>{downloadStatus}</Text> : null}
          {downloadProgress !== undefined ? <View testID={`download-progress-${track.id}`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(downloadProgress * 100) }} style={[s.progressTrack, { backgroundColor: c.panelSoft }]}><View style={{ height: 3, width: `${Math.max(0, Math.min(1, downloadProgress)) * 100}%`, backgroundColor: c.accent }} /></View> : null}
          {unavailableReason ? (
            <Text numberOfLines={1} style={[s.unavailable, { color: c.muted }]}>
              {unavailableReason}
            </Text>
          ) : null}
        </View>
        <View style={s.metadata}>
          {metadataLabel !== undefined ? (
            <Text style={[s.duration, { color: c.muted }]}>
              {metadataLabel}
            </Text>
          ) : showProvider && platformLabel(track.provider) ? (
            <TrackPlatformDuration
              track={track}
              color={c.muted}
              testIDPrefix="library-song"
              fontSize={11}
              lineHeight={15}
              durationMarginTop={2}
            />
          ) : (
            <Text style={[s.duration, { color: c.muted }]}>
              {Math.floor(track.duration / 60)}:
              {String(Math.floor(track.duration % 60)).padStart(2, '0')}
            </Text>
          )}
        </View>
      </Pressable>
      {showActions ? (
        <View
          style={[
            s.actions,
            {
              width:
                (showDownload ? 109 : 74) -
                (showPlaylist ? 0 : 35) +
                (onDelete ? 28 : 0),
            },
          ]}
        >
          <QueueTrackActions
            track={track}
            scope="library-music"
            showRemove={false}
            showDownload={showDownload}
            showPlaylist={showPlaylist}
            onDownload={onDownload}
            scale={1.25}
          />
          {onDelete ? (
            <Pressable
              testID={`library-delete-${track.id}`}
              accessibilityRole="button"
              accessibilityLabel="删除"
              onPress={onDelete}
              style={s.delete}
            >
              <Text style={[s.deleteText, { color: c.muted }]}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  copy: { flex: 1, minWidth: 0, marginLeft: 9 },
  title: { fontSize: 15, lineHeight: 20 },
  artist: { fontSize: 12, lineHeight: 16, marginTop: 3 },
  downloadStatus: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  progressTrack: { width: '100%', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  metadata: { width: 48, flexShrink: 0, marginLeft: 5, alignItems: 'flex-end' },
  duration: { fontSize: 11, lineHeight: 15 },
  actions: {
    width: 109,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unavailable: { fontSize: 10, lineHeight: 13 },
  delete: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontSize: 21, lineHeight: 26 },
});
