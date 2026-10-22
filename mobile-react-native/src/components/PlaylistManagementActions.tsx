import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { StickyPressable } from './StickyPressable';

export function PlaylistTitleEditor({ heading, title, onChange, onSave, onClose }: {
  heading: string; title: string; onChange: (title: string) => void;
  onSave: () => void; onClose: () => void;
}) {
  const c = useTheme();
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={s.backdrop}><View testID="playlist-editor" style={[s.editor, { backgroundColor: c.panel }]}>
      <Text style={[s.heading, { color: c.text }]}>{heading}</Text>
      <TextInput testID="playlist-title-input" value={title} onChangeText={onChange}
        onSubmitEditing={() => { if (title.trim()) onSave(); }} placeholder="输入歌单名称"
        placeholderTextColor={c.muted} style={[s.input, { color: c.text, backgroundColor: c.panelSoft }]} />
      <Pressable testID="save-playlist-title" accessibilityRole="button" disabled={!title.trim()} onPress={onSave}
        style={[s.save, { backgroundColor: c.accent }, !title.trim() && s.disabled]}>
        <Text style={s.saveText}>保存</Text>
      </Pressable>
      <Pressable testID="cancel-playlist-title" accessibilityRole="button" onPress={onClose} style={s.cancel}>
        <Text style={[s.cancelText, { color: c.accent }]}>取消</Text>
      </Pressable>
    </View></View>
  </Modal>;
}

/** Only callers owning a personal or imported playlist supply these actions. */
export function PlaylistManagementActions({ title, onRename, onDelete, onDeleted, style }: {
  title: string; onRename: (title: string) => void; onDelete: () => void;
  onDeleted: () => void; style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteCommitted = useRef(false);
  return <>
    <StickyPressable testID="playlist-delete" accessibilityRole="button" accessibilityLabel="删除歌单"
      onPress={() => { deleteCommitted.current = false; setConfirmingDelete(true); }} style={style}>
      <Svg width={24} height={24} viewBox="0 0 24 24"><Path
        d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"
        fill="none" stroke={c.text} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </StickyPressable>
    <StickyPressable testID="playlist-rename" accessibilityRole="button" accessibilityLabel="重命名歌单"
      onPress={() => { setDraft(title); setEditing(true); }} style={style}>
      <Svg width={24} height={24} viewBox="0 0 24 24"><Path
        d="m14 5 5 5M4 20l1-6L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 19l-6 1ZM14 21h7"
        fill="none" stroke={c.text} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>
    </StickyPressable>
    {editing ? <PlaylistTitleEditor heading="重命名歌单" title={draft} onChange={setDraft}
      onSave={() => { if (!draft.trim()) return; onRename(draft.trim()); setEditing(false); }}
      onClose={() => setEditing(false)} /> : null}
    {confirmingDelete ? <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmingDelete(false)}>
      <View style={s.backdrop}>
        <View testID="playlist-delete-dialog" accessibilityViewIsModal
          style={[s.editor, s.deleteDialog, { backgroundColor: c.panel, borderColor: c.line, shadowColor: c.shadow }]}>
          <Text testID="playlist-delete-heading" style={[s.heading, { color: c.text }]}>删除歌单</Text>
          <Text testID="playlist-delete-copy" style={[s.deleteCopy, { color: c.text }]}>{`确定删除“${title}”吗？`}</Text>
          <Text testID="playlist-delete-note" style={[s.deleteNote, { color: c.muted }]}>仅移除此歌单，收藏、歌曲、下载及当前播放不受影响。</Text>
          <Pressable testID="confirm-playlist-delete" accessibilityRole="button" onPress={() => {
            if (deleteCommitted.current) return;
            deleteCommitted.current = true;
            setConfirmingDelete(false);
            onDelete();
            onDeleted();
          }} style={[s.save, { backgroundColor: c.panelSoft }]}>
            <Text testID="confirm-playlist-delete-label" style={[s.cancelText, { color: c.red }]}>确认删除</Text>
          </Pressable>
          <Pressable testID="cancel-playlist-delete" accessibilityRole="button" onPress={() => setConfirmingDelete(false)} style={s.cancel}>
            <Text testID="cancel-playlist-delete-label" style={[s.cancelText, { color: c.accent }]}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal> : null}
  </>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
  editor: { width: '82%', borderRadius: 18, padding: 22, elevation: 8 },
  heading: { fontSize: 18, fontWeight: '500', marginBottom: 12 },
  input: { borderRadius: 10, paddingHorizontal: 12, minHeight: 44, marginVertical: 12, fontSize: 15 },
  save: { borderRadius: 24, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontSize: 14 },
  cancel: { alignSelf: 'center', padding: 10, marginTop: 6 },
  cancelText: { fontSize: 14 },
  disabled: { opacity: 0.45 },
  deleteDialog: { borderWidth: StyleSheet.hairlineWidth },
  deleteCopy: { fontSize: 16, lineHeight: 23, marginBottom: 10 },
  deleteNote: { fontSize: 13, lineHeight: 20, marginBottom: 20 },
});

export const playlistManagementLayout = StyleSheet.create({
  row: { gap: 4 },
  icon: { width: undefined, minWidth: 32, flex: 1 },
  playAll: { width: 110, minWidth: 110 },
});
