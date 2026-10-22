import React, { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Track } from '../domain/types';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { isTrackInPlaylist } from '../services/trackActionState';
import { TrackActionIcon } from './TrackActionIcon';
import { Glyph } from './UI';
const Context = createContext<((track: Track) => void) | null>(null);
export const usePlaylistMembershipPicker = () => useContext(Context);
/** The chooser outlives a row removed from its currently displayed playlist. */
export function PlaylistMembershipProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null);
  return <Context.Provider value={setTrack}>{children}
    {track ? <PlaylistMembershipDialog track={track} onClose={() => setTrack(null)} /> : null}
  </Context.Provider>;
}
export function PlaylistMembershipDialog({ track: playlistSelection, onClose: closePlaylist }: {
  track: Track; onClose: () => void;
}) {
  const app = useApp();
  const c = useTheme();
  return (
        <Modal transparent animationType="fade" onRequestClose={closePlaylist}>
          <View style={s.overlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closePlaylist}
            />
            <View style={[s.sheet, { backgroundColor: c.bg }]}>
              <View style={s.header}>
                <Text style={[s.title, { color: c.text }]}>添加至歌单</Text>
                <Pressable
                  accessibilityLabel="关闭歌单选择"
                  onPress={closePlaylist}
                >
                  <Glyph color={c.text} size={22}>
                    ×
                  </Glyph>
                </Pressable>
              </View>
              <Text numberOfLines={1} style={[s.subtitle, { color: c.muted }]}>
                {playlistSelection.title}
              </Text>
              <ScrollView
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                {app.state.playlists.map(playlist => {
                  const included = isTrackInPlaylist(
                    app.state,
                    playlistSelection,
                    playlist,
                  );
                  return (
                    <Pressable
                      key={playlist.id}
                      testID={`queue-playlist-choice-${playlist.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={included ? `从${playlist.title}移除` : `添加至${playlist.title}`}
                      accessibilityState={{ selected: included }}
                      onPress={() => {
                        if (included) app.removeTrackFromPlaylist(playlistSelection, playlist.id);
                        else app.addTrackToPlaylist(playlistSelection, playlist.id);
                      }}
                      style={s.row}
                    >
                      <Text
                        style={[
                          s.rowTitle,
                          { color: included ? c.accent : c.text },
                        ]}
                      >
                        {playlist.title}
                      </Text>
                      <Text testID={`queue-playlist-count-${playlist.id}`} style={[s.rowMeta, { color: c.muted }]}>
                        {`${playlist.trackIds.length} 首`}
                      </Text>
                      {included ? (
                        <TrackActionIcon
                          kind="playlist"
                          active
                          size={20}
                          color={c.accent}
                          testID={`queue-playlist-included-${playlist.id}`}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
                {!app.state.playlists.length ? (
                  <Text style={[s.empty, { color: c.muted }]}>
                    请先在音乐库中新建歌单
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheet: { maxHeight: '70%', borderRadius: 18, padding: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '400' },
  subtitle: { marginTop: 6, marginBottom: 10, fontSize: 12 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  rowTitle: { fontSize: 14 },
  rowMeta: { fontSize: 12 },
  empty: { paddingVertical: 20, fontSize: 13 },
});
