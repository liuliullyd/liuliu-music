import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export function EffectConfirmationDialog({
  id, title, message, buttons, onCancel, busy = false,
}: {
  id: string;
  title: string;
  message: string;
  buttons: { id: string; label: string; onPress: () => void; primary?: boolean }[];
  onCancel: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => { if (!busy) onCancel(); }}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="取消音效操作" disabled={busy}
          onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View testID={id} accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: theme.panel, borderColor: theme.line }]}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text testID={id + '-message'} style={[styles.message, { color: theme.muted }]}>{message}</Text>
          <View style={styles.actions}>
            {buttons.map(button => (
              <Pressable key={button.id} testID={button.id} accessibilityRole="button"
                disabled={busy} accessibilityState={{ disabled: busy }} onPress={button.onPress}
                style={[styles.button, { backgroundColor: button.primary ? theme.selectedSurface : theme.panelSoft,
                  borderColor: button.primary ? theme.gold : theme.line, opacity: busy ? 0.6 : 1 }]}>
                <Text style={[styles.buttonText, { color: theme.text }]}>{button.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.48)' },
  dialog: { width: '90%', maxWidth: 420, borderWidth: 1, borderRadius: 22, padding: 20 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 12 },
  message: { fontSize: 15, lineHeight: 23 },
  actions: { gap: 8, marginTop: 20 },
  button: { minHeight: 46, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
