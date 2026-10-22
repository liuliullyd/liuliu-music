import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { trackQueueKey, type CatalogItem, type Track } from '../domain/types';
import {
  loadCollectionTrackBatch,
  type CollectionKind,
} from '../services/collectionPaging';
import { isTrackDownloaded } from '../services/trackActionState';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { DownloadConfirmationDialog } from './DownloadConfirmationDialog';
import { reachedListBottom } from './ListPaging';
import { TrackPlatformDuration } from './UI';
// This picker owns metadata and a cursor only. It never publishes a playback
// queue, warms song URLs or mounts covers for its not-yet-visible candidates.
export function PlaylistDownloadPicker({
  item,
  title,
  loadPage,
  kind,
  tracks,
  offset,
  hasMore,
  onClose,
}: {
  kind: CollectionKind;
  tracks: Track[];
  offset: number;
  hasMore: boolean;
  onClose: () => void;
} & (
  | {
      item: CatalogItem;
      title?: string;
      loadPage?: undefined;
    }
  | {
      item?: undefined;
      title: string;
      loadPage: (
        offset: number,
        size: number,
        signal: AbortSignal,
      ) => Promise<{
        tracks: Track[];
        hasMore: boolean;
      }>;
    }
)) {
  const app = useApp(),
    c = useTheme();
  const noun = '歌曲';
  const unit = '首';
  const collection = '整张歌单';
  const appRef = useRef(app);
  appRef.current = app;
  const active = useRef(true),
    locked = useRef(false);
  const pageController = useRef(new AbortController());
  const userScrolling = useRef(false),
    lastScrollOffset = useRef(0);
  const cursor = useRef({
    tracks: [
      ...new Map(tracks.map(track => [trackQueueKey(track), track])).values(),
    ],
    offset,
    hasMore,
    emptyPages: 0,
  });
  const [items, setItems] = useState(cursor.current.tracks);
  const [more, setMore] = useState(hasMore);
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState<'page' | 'all' | null>(null);
  const [error, setError] = useState('');
  const [confirmTracks, setConfirmTracks] = useState<Track[] | null>(null);
  const submitted = new Set(
    (app.downloadsFor ? app.downloadsFor('music') : app.state.downloads)
      .filter(entry => entry.status !== 'failed')
      .map(entry => trackQueueKey(entry.track)),
  );
  useEffect(() => {
    active.current = true;
    if (pageController.current.signal.aborted)
      pageController.current = new AbortController();
    const controller = pageController.current;
    return () => {
      active.current = false;
      controller.abort();
    };
  }, []);
  const close = () => {
    active.current = false;
    pageController.current.abort();
    onClose();
  };
  const eligible = (track: Track) =>
    !appRef.current.isTrackBlocked(track) &&
    !submitted.has(trackQueueKey(track));
  const selection = items.filter(
    track => selected.has(trackQueueKey(track)) && eligible(track),
  );
  const readPage = async () => {
    if (!active.current || !cursor.current.hasMore) return;
    const current = cursor.current;
    const result = loadPage
      ? await loadPage(current.offset, 20, pageController.current.signal)
      : await loadCollectionTrackBatch(
          item!.provider,
          kind,
          item!.id,
          current.offset,
          20,
          item!.metadata,
        );
    if (!active.current) return;
    const seen = new Set(current.tracks.map(trackQueueKey));
    const additions = result.tracks.filter(track => {
      const key = trackQueueKey(track);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const emptyPages = additions.length ? 0 : current.emptyPages + 1;
    if (result.hasMore && emptyPages >= 3)
      throw new Error(
        `连续分页未返回新${noun}，请稍后重试；尚未读取完整${'歌单'}`,
      );
    cursor.current = {
      tracks: [...current.tracks, ...additions],
      offset: current.offset + 20,
      hasMore: result.hasMore,
      emptyPages,
    };
    setItems(cursor.current.tracks);
    setMore(result.hasMore);
  };
  const load = async (all: boolean) => {
    if (locked.current || !active.current) return;
    locked.current = true;
    setBusy(all ? 'all' : 'page');
    setError('');
    try {
      if (all) {
        while (active.current && cursor.current.hasMore) await readPage();
        if (active.current)
          setSelected(
            new Set(cursor.current.tracks.filter(eligible).map(trackQueueKey)),
          );
      } else await readPage();
    } catch (err) {
      if (active.current)
        setError(
          err instanceof Error ? err.message : `读取${'歌单'}失败，请重试`,
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(null);
    }
  };
  const confirm = () => {
    if (locked.current || !active.current || !selection.length) return;
    setConfirmTracks([...selection]);
  };
  return (
    <>
      <Modal visible transparent animationType="fade" onRequestClose={close}>
        <View style={s.overlay}>
          <Pressable
            accessibilityLabel="关闭下载选择"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID="playlist-download-picker"
            style={[s.sheet, { backgroundColor: c.bg }]}
          >
            <View style={s.header}>
              <Text style={[s.title, { color: c.text }]}>{'选择下载歌曲'}</Text>
              <Pressable
                testID="playlist-download-close"
                accessibilityLabel="关闭下载选择"
                onPress={close}
                style={s.smallButton}
              >
                <Text style={[s.close, { color: c.text }]}>×</Text>
              </Pressable>
            </View>
            <Text numberOfLines={1} style={[s.subtitle, { color: c.muted }]}>
              {title ?? item?.title}
            </Text>
            <View style={s.toolbar}>
              <Pressable
                testID="playlist-download-select-all"
                disabled={!!busy}
                onPress={() => load(true)}
                style={s.smallButton}
              >
                <Text style={{ color: c.accent }}>
                  {loadPage ? '全选列表单集' : '全选整张歌单'}
                </Text>
              </Pressable>
              <Pressable
                testID="playlist-download-clear"
                disabled={!!busy}
                onPress={() => setSelected(new Set())}
                style={s.smallButton}
              >
                <Text style={{ color: c.muted }}>清空选择</Text>
              </Pressable>
              <Text style={[s.count, { color: c.muted }]}>
                已选 {selection.length} {unit}
              </Text>
            </View>
            <ScrollView
              testID="playlist-download-list"
              style={s.list}
              onScrollBeginDrag={({ nativeEvent }) => {
                userScrolling.current = true;
                lastScrollOffset.current = nativeEvent.contentOffset.y;
              }}
              onMomentumScrollEnd={() => {
                userScrolling.current = false;
              }}
              onScroll={({ nativeEvent }) => {
                const y = nativeEvent.contentOffset.y;
                const movedDown =
                  userScrolling.current && y > lastScrollOffset.current;
                lastScrollOffset.current = y;
                if (
                  movedDown &&
                  nativeEvent.contentSize.height >
                    nativeEvent.layoutMeasurement.height &&
                  more &&
                  !busy &&
                  !error &&
                  reachedListBottom(nativeEvent)
                )
                  load(false).catch(() => undefined);
              }}
              scrollEventThrottle={100}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              {items.map(track => {
                const key = trackQueueKey(track),
                  checked = selected.has(key) && eligible(track);
                return (
                  <Pressable
                    key={key}
                    testID={`playlist-download-choice-${track.id}`}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${track.title} · ${track.artist}`}
                    accessibilityState={{
                      checked,
                      disabled: !eligible(track) || !!busy,
                    }}
                    disabled={!eligible(track) || !!busy}
                    style={[s.song, { borderBottomColor: c.line }]}
                    onPress={() =>
                      setSelected(previous => {
                        const next = new Set(previous);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    <Text
                      style={[s.check, { color: checked ? c.accent : c.muted }]}
                    >
                      {checked ? '☑' : '□'}
                    </Text>
                    <View style={s.copy}>
                      <Text
                        numberOfLines={1}
                        style={[s.songTitle, { color: c.text }]}
                      >
                        {track.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[s.artist, { color: c.muted }]}
                      >
                        {track.artist}
                      </Text>
                    </View>
                    {submitted.has(key) ? (
                      <Text
                        style={[
                          s.artist,
                          {
                            color: isTrackDownloaded(app.state, track)
                              ? c.accent
                              : c.muted,
                          },
                        ]}
                      >
                        {isTrackDownloaded(app.state, track)
                          ? '已下载'
                          : '已提交'}
                      </Text>
                    ) : null}
                    <TrackPlatformDuration
                      track={track}
                      color={c.muted}
                      testIDPrefix="playlist-download"
                    />
                  </Pressable>
                );
              })}
              {more ? (
                <Pressable
                  testID="playlist-download-load-more"
                  disabled={!!busy}
                  onPress={() => load(false)}
                  style={s.smallButton}
                >
                  <Text style={{ color: c.accent }}>
                    {error ? `重试读取${noun}` : `读取更多${noun}`}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
            {busy === 'all' ? (
              <Text style={[s.status, { color: c.muted }]}>
                正在读取{collection}，已读取 {items.length} {unit}
              </Text>
            ) : null}
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[s.status, { color: c.red }]}
              >
                {error}
              </Text>
            ) : null}
            <Pressable
              testID="playlist-download-confirm"
              accessibilityRole="button"
              accessibilityLabel={`下载所选${noun}`}
              disabled={!selection.length || !!busy}
              onPress={confirm}
              style={[
                s.confirm,
                { backgroundColor: c.accent },
                (!selection.length || !!busy) && s.disabled,
              ]}
            >
              <Text style={s.confirmText}>
                下载所选{noun}（{selection.length}）
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {confirmTracks ? (
        <DownloadConfirmationDialog
          tracks={confirmTracks}
          onClose={() => setConfirmTracks(null)}
          onDownload={(track, resolved) =>
            appRef.current.downloadTrack(track, {
              useLaunchBinding: true,
              resolved,
            })
          }
        />
      ) : null}
    </>
  );
}
const s = StyleSheet.create({
  disabled: { opacity: 0.45 },
  overlay: {
    flex: 1,
    padding: 18,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  sheet: { maxHeight: '84%', borderRadius: 20, padding: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '400' },
  close: { fontSize: 28 },
  subtitle: { fontSize: 13, marginBottom: 6 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smallButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  count: { flex: 1, textAlign: 'right', fontSize: 12 },
  list: { flexGrow: 0 },
  song: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { fontSize: 24, width: 34 },
  copy: { flex: 1, minWidth: 0 },
  songTitle: { fontSize: 15 },
  artist: { fontSize: 12, marginTop: 3 },
  status: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  confirm: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '400' },
});
