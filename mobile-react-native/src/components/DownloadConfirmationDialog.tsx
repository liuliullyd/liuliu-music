import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { settingsQualityLabel, type Track } from '../domain/types';
import { downloadNetworkQuality } from '../services/networkQuality';
import {
  downloadTrackKey,
  downloadQualityText,
  formatFileSize,
  type DownloadPreview,
} from '../services/downloadPresentation';
import { isTrackDownloaded } from '../services/trackActionState';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';

export function DownloadConfirmationDialog({
  tracks,
  onClose,
  onDownload,
  usePlaybackUrl = false,
}: {
  tracks: Track[];
  onClose: () => void;
  onDownload?: (track: Track, resolved?: DownloadPreview) => Promise<void>;
  usePlaybackUrl?: boolean;
}) {
  const app = useApp(),
    theme = useTheme();
  const [previews, setPreviews] = useState<Record<string, DownloadPreview>>({});
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const quality = downloadNetworkQuality(app.state.settings);
  const trackKeys = tracks.map(downloadTrackKey).join('|');
  const sourceKey = app.state.sources
    .map(
      source =>
        `${source.id}:${source.scriptSha256 ?? source.script ?? ''}:${
          source.enabled
        }:${source.healthy}:${source.pinnedBackend ?? ''}`,
    )
    .join('|');
  const localOnly = tracks.some(track => track.provider === 'custom');
  const prepare = useRef(app.prepareDownloadPreview);
  prepare.current = app.prepareDownloadPreview;
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError('');
    setPreviews({});
    if (localOnly) {
      setError('本地文件无需重复下载');
      setPending(false);
      return () => abort.abort();
    }
    // Only this explicitly selected batch; two bounded metadata requests.
    let index = 0;
    const results: Record<string, DownloadPreview> = {};
    const worker = async () => {
      while (index < tracks.length && !abort.signal.aborted) {
        const track = tracks[index++];
        try {
          const value = await prepare.current(track, abort.signal, {
            useLaunchBinding: Boolean(onDownload),
            ...(usePlaybackUrl ? { usePlaybackUrl: true } : {}),
          });
          if (!abort.signal.aborted) {
            results[downloadTrackKey(track)] = value;
            setPreviews({ ...results });
          }
        } catch (failure) {
          if (!abort.signal.aborted)
            setError(
              failure instanceof Error ? failure.message : '文件大小暂不可读',
            );
        }
      }
    };
    Promise.all([worker(), worker()]).finally(() => {
      if (!abort.signal.aborted) setPending(false);
    });
    return () => abort.abort();
    // A quality or identity change cancels the old header query before replacing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKeys, quality, sourceKey, localOnly, usePlaybackUrl]);
  const close = () => {
    if (locked.current) return;
    locked.current = true;
    controller.current?.abort();
    onClose();
  };
  const confirm = () => {
    if (locked.current || pending || localOnly || !tracks.length) return;
    locked.current = true;
    controller.current?.abort();
    const selected = [...tracks];
    onClose();
    app.beginUserDownloads(selected, { onDownload, preferredQuality: quality,
      resolved: { ...previews },
      ...(usePlaybackUrl ? { usePlaybackUrl: true } : {}) });
  };
  const downloaded =
    tracks.length === 1 && isTrackDownloaded(app.state, tracks[0]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="取消下载"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="download-confirmation"
          accessibilityViewIsModal
          style={[
            styles.dialog,
            { backgroundColor: theme.panel, borderColor: theme.line },
          ]}
        >
          <Text style={[styles.title, { color: theme.text }]}>
            {downloaded
              ? '是否重新下载？'
              : tracks.length === 1
              ? '是否下载这首歌曲？'
              : `是否下载所选 ${tracks.length} 首？`}
          </Text>
          {!usePlaybackUrl || downloadQualityText(tracks[0], previews[downloadTrackKey(tracks[0])]) ? <Text
            testID="download-preferred-quality"
            style={[styles.meta, { color: theme.muted }]}
          >
            {usePlaybackUrl
              ? `下载音质：${downloadQualityText(tracks[0], previews[downloadTrackKey(tracks[0])])}`
              : `下载设置：${settingsQualityLabel(quality)}`}
          </Text> : null}
          <ScrollView style={styles.list}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {tracks.map(track => {
              const preview = previews[downloadTrackKey(track)];
              return (
                <View key={downloadTrackKey(track)} style={styles.song}>
                  <Text
                    numberOfLines={2}
                    style={[styles.songTitle, { color: theme.text }]}
                  >
                    {track.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.meta, { color: theme.muted }]}
                  >
                    {track.artist}
                  </Text>
                  <Text
                    testID={`download-preview-${track.id}`}
                    style={[styles.meta, { color: theme.muted }]}
                  >
                    {downloadQualityText(track, preview)
                      ? `${downloadQualityText(track, preview)} · `
                      : ''}
                    {pending && !preview
                      ? '正在读取文件大小…'
                      : formatFileSize(preview?.sizeBytes)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
          {error ? (
            <Text
              testID="download-preview-error"
              style={[styles.meta, { color: theme.muted }]}
            >
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              testID="download-cancel"
              accessibilityRole="button"
              onPress={close}
              style={[styles.button, { backgroundColor: theme.panelSoft }]}
            >
              <Text style={{ color: theme.text }}>取消</Text>
            </Pressable>
            <Pressable
              testID="download-confirm"
              accessibilityRole="button"
              disabled={pending || localOnly}
              accessibilityState={{ disabled: pending || localOnly }}
              onPress={confirm}
              style={[
                styles.button,
                {
                  backgroundColor: theme.selectedSurface,
                  opacity: pending ? 0.5 : 1,
                },
              ]}
            >
              <Text style={{ color: theme.accent }}>
                {downloaded ? '重新下载' : '下载'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '75%',
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  },
  title: { fontSize: 19, lineHeight: 26, marginBottom: 10 },
  list: { flexGrow: 0 },
  song: { paddingVertical: 12 },
  songTitle: { fontSize: 16, lineHeight: 23 },
  meta: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  button: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
