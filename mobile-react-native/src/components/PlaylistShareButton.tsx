import React, { useRef, useState } from 'react';
import { Modal, NativeModules, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { CatalogItem } from '../domain/types';
import { createPlaylistShare, formatPlaylistShare } from '../services/playlistShare';
import { createReferencePersonalPlaylistShare, personalPlaylistCopyLink } from '../services/personalPlaylistShare';
import type { CoverKey, Track } from '../domain/types';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { covers } from '../assets/covers';
import { ResilientHomeCover } from './ResilientHomeCover';

type SharePreview = {
  title: string; description?: string; cover?: string; coverCandidates?: string[]; coverKey: CoverKey;
  count?: number; tracks?: Track[]; text: string; personal: boolean;
};

export function PlaylistShareButton({ item, personal }: {
  item?: CatalogItem;
  personal?: { title: string; description?: string; cover?: string; coverKey: CoverKey; tracks: Track[]; expectedTrackCount?: number };
}) {
  const app = useApp();
  const layout = useLayout();
  const theme = useTheme();
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const copyingRef = useRef(false);
  const openingRef = useRef(false);
  const close = () => { if (!copyingRef.current) { setPreview(null); setError(''); } };
  const share = async () => {
    if (preview || openingRef.current) return;
    openingRef.current = true;
    try {
      const content = personal ? await createReferencePersonalPlaylistShare(personal) : item ? createPlaylistShare(item) : null;
      if (!content) throw new Error('歌单暂不可分享');
      setError('');
      setPreview({ title: content.title, description: personal?.description ?? item?.description,
        cover: personal?.cover ?? item?.cover, coverCandidates: item?.coverCandidates,
        coverKey: personal?.coverKey ?? 'vinyl', count: personal ? personal.tracks.length : item?.trackCount,
        tracks: personal?.tracks, text: content.message, personal: !!personal });
    } catch (reason) {
      app.notify(reason instanceof Error ? reason.message : '歌单分享失败，请重试');
    } finally { openingRef.current = false; }
  };
  const copy = async () => {
    if (!preview || copyingRef.current) return;
    copyingRef.current = true; setCopying(true); setError('');
    try {
      const bridge = NativeModules.LiuliuMediaLibrary;
      if (!bridge?.copyPlaylistShare) throw new Error('当前版本暂不支持复制歌单，请更新后重试');
      const link = preview.personal ? await personalPlaylistCopyLink(preview.text) : { text: preview.text, shortened: false };
      await bridge.copyPlaylistShare(preview.personal ? formatPlaylistShare(preview.title, link.text) : link.text);
      setPreview(null);
      app.notify('expiresInDays' in link && typeof link.expiresInDays === 'number' ? `已复制短链接，有效期 ${link.expiresInDays} 天`
        : preview.personal && !link.shortened ? '短链接暂不可用，已复制精简链接' : '歌单链接已复制');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '复制失败，请重试');
    } finally { copyingRef.current = false; setCopying(false); }
  };
  return <><Pressable testID="playlist-detail-share" accessibilityRole="button" accessibilityLabel="分享歌单"
    onPress={share} style={[styles.button, { width: layout.headerButtonSize, height: layout.headerButtonSize }]}>
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth={1.7}>
      <Path d="m8.5 10 7-4M8.5 14l7 4" strokeLinecap="round" />
      <Circle cx={6} cy={12} r={3} /><Circle cx={18} cy={4.5} r={3} /><Circle cx={18} cy={19.5} r={3} />
    </Svg>
  </Pressable>
    {preview ? <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable testID="playlist-share-dismiss" accessibilityRole="button" accessibilityLabel="取消分享"
          style={StyleSheet.absoluteFill} onPress={close} disabled={copying} />
        <View testID="playlist-share-preview" accessibilityViewIsModal style={[styles.dialog, { backgroundColor: theme.panel }]}>
          <View style={styles.header}>
            <Text style={[styles.heading, { color: theme.text }]}>分享歌单</Text>
            <Pressable testID="playlist-share-close" accessibilityRole="button" accessibilityLabel="关闭分享"
              onPress={close} disabled={copying} hitSlop={8} style={styles.close}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={1.7}>
                <Path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            <ResilientHomeCover testID="playlist-share-cover" uri={preview.cover} uris={preview.coverCandidates}
              fallback={covers[preview.coverKey]} style={styles.cover} imageStyle={styles.cover} clipToImageStyle />
            <Text testID="playlist-share-title" style={[styles.title, { color: theme.text }]} numberOfLines={3}>{preview.title}</Text>
            {preview.count !== undefined ? <Text style={{ color: theme.muted }}>共 {preview.count} 首</Text> : null}
            {preview.description ? <Text style={[styles.description, { color: theme.muted }]} numberOfLines={3}>{preview.description}</Text> : null}
            {preview.tracks?.slice(0, 3).map((track, index) => <Text key={index} numberOfLines={1}
              style={[styles.track, { color: theme.text }]}>{index + 1}. {track.title} · {track.artist}</Text>)}
          </ScrollView>
          <Text style={[styles.hint, { color: theme.muted }]}>{preview.personal ? '好友导入时需联网读取歌曲资料' : '复制歌单链接，好友可在“导入歌单”中粘贴识别'}</Text>
          {error ? <Text testID="playlist-share-error" accessibilityLiveRegion="polite" style={{ color: theme.text }}>{error}</Text> : null}
          <Pressable testID="playlist-share-copy" accessibilityRole="button" disabled={copying} onPress={copy}
            style={styles.copy}>
            <Text style={[styles.copyText, { color: theme.accent }]}>{copying ? '正在复制…' : '复制链接'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal> : null}
  </>;
}
const styles = StyleSheet.create({
  button: { marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0008' },
  dialog: { width: '100%', maxWidth: 360, maxHeight: '85%', borderRadius: 18, padding: 22, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '600' }, close: { padding: 4 },
  content: { flexGrow: 0 }, contentInner: { alignItems: 'center', gap: 10 },
  cover: { width: 140, height: 140, borderRadius: 12 },
  title: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  description: { textAlign: 'center', lineHeight: 21 }, track: { alignSelf: 'stretch', fontSize: 14 },
  hint: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  copy: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, copyText: { fontSize: 16, fontWeight: '600' },
});
