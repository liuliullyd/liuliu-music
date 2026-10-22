import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MusicHistoryOrigin, Track } from '../domain/types';
import { playLibraryTrack } from '../services/libraryPlaybackActions';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { PlaybackModePicker } from './PlaybackModePicker';
import { PlaylistDownloadPicker } from './PlaylistDownloadPicker';
import {
  PlaylistManagementActions,
  playlistManagementLayout,
} from './PlaylistManagementActions';
import { StickyPressable } from './StickyPressable';
import { TrackActionIcon } from './TrackActionIcon';
import { Glyph } from './UI';
export function LibraryPlaylistActions({
  tracks,
  showDownload = true,
  showFavorite = true,
  onScanLocal,
  onAddLocal,
  onDeleteAllLocal,
  deleteAllDisabled = false,
  historyOrigin,
  onUnavailableTrack,
  surfaceColor,
  contentInset = 0,
  mediaKind = 'music',
  sticky = false,
  personalPlaylist,
}: {
  personalPlaylist?: {
    id: string;
    title: string;
    onDeleted: () => void;
  };
  tracks: Track[];
  showDownload?: boolean;
  showFavorite?: boolean;
  onScanLocal?: () => void;
  onAddLocal?: () => void;
  onDeleteAllLocal?: () => void;
  deleteAllDisabled?: boolean;
  historyOrigin?: MusicHistoryOrigin;
  onUnavailableTrack?: (key: string) => void;
  surfaceColor?: string;
  contentInset?: number;
  mediaKind?: 'music';
  sticky?: boolean;
}) {
  const app = useApp();
  const c = useTheme();
  const Button = sticky ? StickyPressable : Pressable;
  const iconStyle = [
    s.playlistIconAction,
    personalPlaylist && playlistManagementLayout.icon,
  ];
  const first = tracks[0];
  const [downloadOpen, setDownloadOpen] = useState(false);
  const allFavorite =
    tracks.length > 0 && tracks.every(track => app.isFavorite(track));
  const playAll = () => {
    if (!first) return;
    playLibraryTrack(app, first, tracks, false, historyOrigin, undefined, {
      onUnavailableTrack,
    });
  };
  return (
    <>
      <View
        testID="library-playlist-actions"
        style={[
          s.playlistActions,
          personalPlaylist && playlistManagementLayout.row,
          {
            backgroundColor: surfaceColor ?? c.bg,
            marginHorizontal: contentInset,
          },
        ]}
      >
        {showFavorite ? (
          <Button
            testID="library-action-favorite"
            accessibilityRole="button"
            accessibilityLabel={
              allFavorite ? `取消收藏全部${'歌曲'}` : `收藏全部${'歌曲'}`
            }
            disabled={!first}
            onPress={() =>
              tracks.forEach(track => {
                if (allFavorite || !app.isFavorite(track))
                  app.toggleFavorite(track);
              })
            }
            style={iconStyle}
          >
            <TrackActionIcon
              kind="favorite"
              active={allFavorite}
              color={allFavorite ? c.accent : c.text}
              size={24}
            />
          </Button>
        ) : null}
        {showDownload ? (
          <Button
            testID="library-action-download"
            accessibilityRole="button"
            accessibilityLabel={'选择下载歌曲'}
            disabled={!first}
            onPress={() => setDownloadOpen(true)}
            style={iconStyle}
          >
            <TrackActionIcon kind="download" color={c.text} size={24} />
          </Button>
        ) : null}
        {onScanLocal ? (
          <Button
            testID="library-scan-local"
            accessibilityRole="button"
            accessibilityLabel={`扫描本地${'音乐'}`}
            onPress={onScanLocal}
            style={[s.localToolAction, onDeleteAllLocal && s.localBulkTool]}
          >
            <Glyph color={c.text} size={21}>
              ↻
            </Glyph>
            <Text style={[s.localToolLabel, { color: c.text }]}>扫描本地</Text>
          </Button>
        ) : null}
        {onAddLocal ? (
          <Button
            testID="library-add-local"
            accessibilityRole="button"
            accessibilityLabel={`添加本地${'音乐'}`}
            onPress={onAddLocal}
            style={[s.localToolAction, onDeleteAllLocal && s.localBulkTool]}
          >
            <Glyph color={c.text} size={21}>
              ＋
            </Glyph>
            <Text style={[s.localToolLabel, { color: c.text }]}>添加本地</Text>
          </Button>
        ) : null}
        {onDeleteAllLocal ? (
          <Button
            testID="library-delete-all-local"
            accessibilityRole="button"
            accessibilityLabel={`全部删除本地${{ music: '音乐' }[mediaKind]}`}
            disabled={deleteAllDisabled}
            onPress={onDeleteAllLocal}
            style={[
              s.localToolAction,
              s.localBulkTool,
              deleteAllDisabled && s.playAllDisabled,
            ]}
          >
            <Glyph color={c.text} size={21}>
              ×
            </Glyph>
            <Text style={[s.localToolLabel, { color: c.text }]}>全部删除</Text>
          </Button>
        ) : null}
        <PlaybackModePicker style={iconStyle} sticky={sticky} />
        {personalPlaylist ? (
          <PlaylistManagementActions
            title={personalPlaylist.title}
            style={iconStyle}
            onRename={title => app.renamePlaylist(personalPlaylist.id, title)}
            onDelete={() => app.deletePlaylist(personalPlaylist.id)}
            onDeleted={personalPlaylist.onDeleted}
          />
        ) : null}
        <Button
          testID="library-list-play-all"
          accessibilityRole="button"
          accessibilityLabel="全部播放"
          disabled={!first}
          onPress={playAll}
          style={[
            s.playlistPlayAll,
            personalPlaylist && playlistManagementLayout.playAll,
            onDeleteAllLocal && s.localBulkPlayAll,
            { backgroundColor: c.text },
            !first && s.playAllDisabled,
          ]}
        >
          <Glyph color={c.bg} size={18}>
            ▶
          </Glyph>
          <Text style={[s.playAllText, { color: c.bg }]}>全部播放</Text>
        </Button>
      </View>
      {downloadOpen ? (
        <PlaylistDownloadPicker
          title="当前列表"
          kind={'playlists'}
          tracks={tracks}
          offset={tracks.length}
          hasMore
          loadPage={async () => ({ tracks: [], hasMore: false })}
          onClose={() => setDownloadOpen(false)}
        />
      ) : null}
    </>
  );
}
const s = StyleSheet.create({
  playlistActions: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playlistIconAction: {
    width: 48,
    height: 64,
    minWidth: 48,
    minHeight: 64,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  localToolAction: {
    width: 64,
    minWidth: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  localToolLabel: { fontSize: 10, lineHeight: 14 },
  localBulkTool: { flexShrink: 1, minWidth: 48 },
  localBulkPlayAll: { flexShrink: 1, minWidth: 96 },
  playlistPlayAll: {
    width: 132,
    minWidth: 132,
    marginLeft: 'auto',
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playAllDisabled: { opacity: 0.45 },
  playAllText: { fontSize: 14, fontWeight: '400' },
});
