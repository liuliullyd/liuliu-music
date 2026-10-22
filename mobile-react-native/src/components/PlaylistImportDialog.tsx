import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme';
import { previewPlaylistImport, type PlaylistImportOptions, type PlaylistImportResult } from '../services/playlistImport';
import { isPersonalPlaylistShare, readPersonalPlaylistShare } from '../services/personalPlaylistShare';
import { covers } from '../assets/covers';

export function PlaylistImportDialog({ onClose, onCancel = onClose, onSave, isSaved, initialInput = '', autoRead = false }: {
  onClose: () => void; onCancel?: () => void;
  onSave: (preview: PlaylistImportResult, options?: PlaylistImportOptions) => void | Promise<void>;
  isSaved?: (preview: PlaylistImportResult) => boolean;
  initialInput?: string; autoRead?: boolean;
}) {
  const theme = useTheme();
  const [input, setInput] = useState(initialInput);
  const [preview, setPreview] = useState<PlaylistImportResult | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const overwrite = Boolean(preview && isSaved?.(preview));
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const cancel = () => { if (saving) return; request.current?.abort(); request.current = null; onCancel(); };
  const savePreview = async () => {
    if (!preview || saving) return;
    setError(''); setSaving(true);
    try {
      if (overwrite) await onSave(preview, { overwrite: true });
      else await onSave(preview);
      setSaving(false);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
      setSaving(false);
    }
  };
  const read = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller; setPreview(null); setError(''); setStatus('读取歌单…');
    try {
      if (request.current !== controller || controller.signal.aborted) return;
      const result = isPersonalPlaylistShare(input) ? await readPersonalPlaylistShare(input, controller.signal) : await previewPlaylistImport(input, controller.signal, (done, total) => {
        if (request.current === controller) setStatus(`已读取 ${done}${total === undefined ? '' : ` / ${total}`} 首`);
      });
      if (request.current === controller && !controller.signal.aborted) {
        setPreview(result);
      }
    } catch (reason) {
      if (request.current === controller && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '歌单读取失败，请重试');
    } finally { if (request.current === controller) { request.current = null; setStatus(''); } }
  }, [input]);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => { if (autoRead) readRef.current().catch(() => undefined); }, [autoRead]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') return;
      request.current?.abort(); request.current = null; setStatus('');
    });
    return () => subscription.remove();
  }, []);
  return <Modal visible transparent animationType="fade" onRequestClose={cancel}>
    <View style={styles.backdrop}><View style={[styles.dialog, { backgroundColor: theme.panel }]}>
      <Text style={[styles.title, { color: theme.text }]}>导入歌单</Text>
      {!autoRead && !preview ? <><Text style={{ color: theme.muted }}>粘贴平台或六六歌单分享内容</Text>
      <TextInput testID="playlist-import-input" accessibilityLabel="歌单链接或分享文本" multiline autoCapitalize="none"
        editable={!saving}
        placeholder="粘贴歌单链接或完整分享文本" placeholderTextColor={theme.muted} value={input}
        onChangeText={value => { request.current?.abort(); request.current = null; setStatus(''); setPreview(null); setError(''); setInput(value); }}
        style={[styles.input, { color: theme.text, borderColor: theme.muted }]} /></> : null}
      {status ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>{status}</Text> : null}
      {error ? <Text testID="playlist-import-error" style={{ color: theme.text }}>{error}</Text> : null}
      {overwrite ? <Text testID="playlist-import-overwrite" style={{ color: theme.text }}>当前歌单已保存，是否覆盖当前歌单？</Text> : null}
      {preview ? <ScrollView style={styles.preview}>
        {preview.cover || preview.kind === 'personal' ? <Image testID="playlist-import-cover" accessibilityLabel="歌单封面"
          source={preview.cover ? { uri: preview.cover } : covers[preview.kind === 'personal' ? preview.coverKey : 'vinyl']}
          style={styles.previewCover} /> : null}
        <Text style={[styles.title, { color: theme.text }]}>{preview.title}</Text>
        <Text style={{ color: theme.muted }}>共 {preview.total ?? '未知'} 首，预览 {preview.tracks.length} 首{preview.unavailableCount ? `，不可读取 ${preview.unavailableCount} 首` : ''}{preview.duplicateCount ? `，重复 ${preview.duplicateCount} 首` : ''}</Text>
        {preview.tracks.slice(0, 8).map(track => <Text key={track.id} style={{ color: theme.text }} numberOfLines={1}>{track.title} · {track.artist}</Text>)}
        <Text style={{ color: theme.muted }}>保存歌单后查看全部歌单内容</Text>
      </ScrollView> : null}
      <View style={styles.actions}>
        <Pressable testID="playlist-import-cancel" disabled={saving} onPress={cancel}><Text style={{ color: theme.muted }}>取消</Text></Pressable>
        <Pressable testID="playlist-import-submit" disabled={!input.trim() || !!status || saving} onPress={() => {
          if (preview) return savePreview();
          return read();
        }}><Text style={{ color: theme.accent }}>{saving ? '正在保存…' : preview ? overwrite ? '覆盖当前歌单' : '保存到我的歌单' : error ? '重试读取' : '读取歌单'}</Text></Pressable>
      </View>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({ backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0008' },
  dialog: { borderRadius: 18, padding: 22, gap: 14, maxHeight: '85%' }, title: { fontSize: 19, fontWeight: '600' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, minHeight: 90, maxHeight: 120, textAlignVertical: 'top' },
  preview: { maxHeight: 240 }, previewCover: { width: 80, height: 80, borderRadius: 10, marginBottom: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 } });
