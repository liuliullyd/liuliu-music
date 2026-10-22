import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CatalogItem } from '../domain/types';
import { collectKnownTracks } from '../services/libraryPlaybackActions';
import { linkedPlaylists } from '../services/linkedPlaylist';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { LibraryDetailScrollView } from './LibraryDetailAppearance';
import { LibraryDetailHeader } from './LibraryDetailHeader';
import { LibraryPlaylistCard } from './LibraryPlaylistSection';
import { PlaylistTitleEditor } from './PlaylistManagementActions';

export function PersonalPlaylistManager({ onOpenCollection, onOpenPersonalPlaylist }: {
  onOpenCollection: (item: CatalogItem) => void;
  onOpenPersonalPlaylist: (id: string) => void;
}) {
  const theme = useTheme();
  const app = useApp();
  const layout = useLayout();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const tracksById = new Map(collectKnownTracks(app.state, app.current).map(track => [track.id, track]));
  const firstCoverTrack = tracksById.get(app.state.playlists[0]?.trackIds[0] ?? '');
  const references = linkedPlaylists(app.state);
  const save = () => { if (!title.trim()) return; app.createPlaylist(title.trim()); setEditing(false); };
  return <>
    <LibraryDetailScrollView testID="library-playlists" style={[s.detailRoot, { backgroundColor: theme.bg }]}
      contentContainerStyle={[s.content, { paddingHorizontal: layout.pageHorizontalPadding, paddingBottom: layout.scrollBottomPadding }]}>
      <LibraryDetailHeader title="我的歌单" count={`${app.state.playlists.length + references.length} 个歌单`}
        cover={firstCoverTrack?.cover} coverKey={firstCoverTrack?.coverKey ?? app.state.playlists[0]?.coverKey}
        coverCandidates={firstCoverTrack ? trackCoverCandidates(firstCoverTrack) : []} />
      <View testID="playlist-manager-actions" style={s.managerActions}>
        <Pressable testID="create-playlist-button" onPress={() => { setTitle(''); setEditing(true); }} style={[s.managerCreate, s.managerAction, { backgroundColor: theme.panelSoft }]}>
          <Text style={[s.managerCreateText, { color: theme.accent }]}>＋ 新建歌单</Text>
        </Pressable>
        <Pressable testID="import-playlist-button" onPress={() => app.openPlaylistImport()} style={[s.managerCreate, s.managerAction, { backgroundColor: theme.panelSoft }]}>
          <Text style={[s.managerCreateText, { color: theme.accent }]}>导入平台歌单</Text>
        </Pressable>
      </View>
      <View style={s.managerGrid}>
        {references.map(item => <LibraryPlaylistCard key={`${item.provider}:${item.id}`} item={item} suppressLongPress onPress={() => onOpenCollection(item)} />)}
        {app.state.playlists.map(item => <LibraryPlaylistCard key={item.id} item={item}
          coverTrack={tracksById.get(item.trackIds[0] ?? '')} cardTestID={`user-playlist-${item.id}`}
          suppressLongPress onPress={() => onOpenPersonalPlaylist(item.id)} />)}
      </View>
    </LibraryDetailScrollView>
    {editing ? <PlaylistTitleEditor heading="新建歌单" title={title} onChange={setTitle} onSave={save} onClose={() => { setEditing(false); setTitle(''); }} /> : null}
  </>;
}
const s = StyleSheet.create({
  detailRoot: { flex: 1 },
  content: { paddingTop: 0 },
  managerActions: { flexDirection: 'row', gap: 12, margin: 18 },
  managerAction: { flex: 1, margin: 0 },
  managerCreate: {
    margin: 18,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  managerCreateText: { fontSize: 15, fontWeight: '400' },
  managerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 18,
  },
});
