import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { covers } from '../assets/covers';
import { LibraryDetailScrollView } from '../components/LibraryDetailAppearance';
import { LibraryDetailHeader } from '../components/LibraryDetailHeader';
import { LibraryMusicTrackRow } from '../components/LibraryMusicTrackRow';
import { LibraryPlaylistActions } from '../components/LibraryPlaylistActions';
import {
  LibraryPlaylistCard,
  LibraryPlaylistSection,
  type LibraryPlaylistTab,
} from '../components/LibraryPlaylistSection';
import { PersonalPlaylistDetail } from '../components/PersonalPlaylistDetail';
import { PersonalPlaylistManager } from '../components/PersonalPlaylistManager';
import {
  PlaylistDetailGradientViewport,
  usePlaylistDetailScrollGradient,
} from '../components/PlaylistDetailScrollGradient';
import {
  PlaylistInformationGradient,
  PlaylistInformationTopGradient,
} from '../components/PlaylistInformationSurface';
import { RecentPlaybackDetail } from '../components/RecentPlaybackDetail';
import { ResilientHomeCover } from '../components/ResilientHomeCover';
import { StickyBackgroundExtension } from '../components/StickyBackgroundExtension';
import { StickyPressable } from '../components/StickyPressable';
import { TrackActionIcon } from '../components/TrackActionIcon';
import { Cover, Glyph } from '../components/UI';
import { platformCaption } from '../components/platformLabels';
import {
  traceRoamBackground,
  traceRoamHistoryScroll,
} from '../components/roamBackgroundDiagnostic';
import { useLibraryRecordPages } from '../components/useLibraryRecordPages';
import { useStableNativeScrollEvent } from '../components/useStableNativeScrollEvent';
import { useVisibleTrackPrewarm } from '../components/useVisibleTrackPrewarm';
import type {
  CatalogItem,
  HistoryEntry,
  MusicEntityHistoryEntry,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import {
  collectionEntityKind,
  collectionFavoriteKey,
} from '../services/collectionIdentity';
import {
  downloadRecordRows,
  downloadStatusText,
  downloadTrackKey,
  type DownloadActivity,
} from '../services/downloadPresentation';
import {
  libraryPlaybackTrack,
  localPlaybackReference,
} from '../services/libraryPlayback';
import {
  collectKnownTracks,
  libraryPlayableTracks,
  libraryReason,
  playLibraryTrack,
} from '../services/libraryPlaybackActions';
import { linkedPlaylists } from '../services/linkedPlaylist';
import {
  mediaDownloads,
  mediaHistory,
  mediaLocalTracks,
  trackMediaKind,
} from '../services/mediaLibrary';
import { musicEntityHistoryKey } from '../services/musicEntityHistory';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { subscribeRuntimeTrackBlacklist } from '../services/trackPlaybackPolicy';
import { useApp, useCatalogViewState } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { useLibraryPlaylists } from '../state/useLibraryPlaylists';
import { serif, useTheme, type ThemePalette } from '../theme';
import { CollectionDetail } from './HomeScreen';
type LibraryMode = 'music';
type LibraryListPage = 'local' | 'favorites' | 'history' | 'downloads';
const modeInfo: Record<
  LibraryMode,
  {
    label: string;
    glyph: string;
    unit: string;
  }
> = {
  music: { label: '音乐', glyph: '♫', unit: '首' },
};
const findKnownTrack = (tracks: Track[], id: string, kind: LibraryMode) =>
  tracks.find(track => track.id === id && trackMediaKind(track) === kind);
export function LibraryScreen({
  backgroundScrollY,
}: {
  backgroundScrollY?: Animated.Value;
}) {
  const s = useLibraryStyles();
  const [, setTrackAvailabilityVersion] = useState(0);
  useEffect(
    () =>
      subscribeRuntimeTrackBlacklist(() =>
        setTrackAvailabilityVersion(value => value + 1),
      ),
    [],
  );
  const app = useApp();
  const theme = useTheme();
  const layout = useLayout();
  const localScrollY = useRef(new Animated.Value(0)).current;
  const libraryScrollY = backgroundScrollY ?? localScrollY;
  const overviewPrewarm = useRef<ReturnType<
    typeof useVisibleTrackPrewarm
  > | null>(null);
  const libraryScrollEvent = useStableNativeScrollEvent(libraryScrollY, event =>
    overviewPrewarm.current?.onScroll(event.nativeEvent),
  );
  const libraryRoot = app.page === 'root';
  useEffect(() => {
    if (libraryRoot) {
      traceRoamBackground('root-scroll-reset-before');
      libraryScrollY.setValue(0);
      traceRoamBackground('root-scroll-reset-after');
    }
  }, [libraryRoot, libraryScrollY]);
  const mode: LibraryMode = 'music';
  const downloadViewVersion = {
    current: app.downloadDestination?.version ?? 0,
  };
  useEffect(() => {
    if (app.page === 'downloads' && app.downloadDestination)
      app.consumeDownloadDestination?.(app.downloadDestination.version);
  }, [app.page, app.downloadDestination, app.consumeDownloadDestination]);
  const [musicList, setMusicList] = useCatalogViewState<LibraryListPage>(
    'library-music-list',
    'history',
  );
  const [playlistTab, setPlaylistTab] = useCatalogViewState<LibraryPlaylistTab>(
    'library-playlist-tab',
    'curated',
  );
  const playlistPages = useLibraryPlaylists(
    playlistTab === 'curated' &&
      !app.startup?.visible &&
      (app.page === 'root' || app.page === 'library-browse'),
  );
  const [mediaLists, setMediaLists] = useCatalogViewState<
    Record<never, LibraryListPage>
  >('library-media-list', {});
  const selectedList = musicList;
  const [detailItem, setDetailItem] = useCatalogViewState<CatalogItem | null>(
    'library-detail',
    null,
  );
  const [homeReferenceDetail, setHomeReferenceDetail] = useCatalogViewState(
    'library-detail-home-reference',
    false,
  );
  const [detailResumeKey, setDetailResumeKey] = useCatalogViewState<
    string | null
  >('library-detail-resume-key', null);
  const selectDetailItem = (
    item: CatalogItem,
    homeReference = false,
    resume = false,
  ) => {
    setDetailItem(item);
    setHomeReferenceDetail(homeReference);
  };
  const [personalPlaylistId, setPersonalPlaylistId] = useCatalogViewState<
    string | null
  >('library-playlist-opened', null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [createPlaylistTitle, setCreatePlaylistTitle] = useState('');
  const [localScan, setLocalScan] = useState<{
    kind: Exclude<LibraryMode, 'music'>;
    candidates: Track[];
  } | null>(null);
  const supported = new Set<string>([]);
  const allowed = (item: Track | CatalogItem) => true;
  const knownTracks = collectKnownTracks(app.state, app.current);
  const favoriteTracks = [
    ...app.state.favorites
      .map(id => findKnownTrack(knownTracks, id, 'music'))
      .filter(Boolean),
  ] as Track[];
  const modeTracks = favoriteTracks.filter(track => allowed(track));
  const modeHistory = mediaHistory(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const modeDownloads = mediaDownloads(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const modeCollections = app.state.savedCollections.filter(item =>
    allowed(item),
  );
  const openCollection = (item: CatalogItem, resume = false) => {
    selectDetailItem(item, true, resume);
    app.open('search-playlist');
  };
  const openPersonalPlaylist = (id: string) => {
    setPersonalPlaylistId(id);
    app.open('personal-playlist');
  };
  const returnToPlaylistManager = () => {
    setPersonalPlaylistId(null);
    app.setTab('library');
    app.open('playlists');
  };
  if (app.page === 'personal-playlist') {
    const playlist = app.state.playlists.find(
      item => item.id === personalPlaylistId,
    );
    if (playlist) {
      const tracksById = new Map(knownTracks.map(track => [track.id, track]));
      return (
        <PersonalPlaylistDetail
          playlistId={playlist.id}
          title={playlist.title}
          tracks={playlist.trackIds.flatMap(id => tracksById.get(id) ?? [])}
          fallbackCoverKey={playlist.coverKey}
          playlistCover={playlist.cover}
          description={playlist.description}
          onBack={app.back}
          onDeleted={returnToPlaylistManager}
        />
      );
    }
  }
  if (app.page === 'search-playlist')
    return (
      <CollectionDetail
        item={detailItem}
        libraryAppearance
        homeReferenceAppearance={homeReferenceDetail}
      />
    );
  if (app.page === 'playlists' || app.page === 'personal-playlist')
    return (
      <PersonalPlaylistManager
        onOpenCollection={openCollection}
        onOpenPersonalPlaylist={openPersonalPlaylist}
      />
    );
  if (app.page === 'library-browse')
    return (
      <LibraryPlaylistBrowser
        pages={playlistPages}
        onOpen={item => {
          selectDetailItem(item, true);
          app.open('search-playlist');
        }}
      />
    );
  if (['local', 'favorites', 'history', 'downloads'].includes(app.page))
    return (
      <LibraryList
        key={`${app.page}:${
          app.page === 'downloads' ? downloadViewVersion.current : 0
        }`}
        mode={mode}
        page={app.page as LibraryListPage}
        onOpenCollection={item => {
          selectDetailItem(item, false, app.page === 'favorites');
          app.open('search-playlist');
        }}
        onOpenPlaylist={openPersonalPlaylist}
      />
    );
  const accent = theme.accent;
  const summary = [
    ['history', '', '最近播放', `${modeHistory.length} 首`],
    ['favorites', '', '我的收藏', `${modeTracks.length} 首`],
    ['downloads', '', '下载记录', `${modeDownloads.length} 首`],
    ['local', '', '本地音乐', `${app.state.localTracks.length} 首`],
  ];
  const mediaLocal = app.state.localTracks;
  const recentMusic = [
    ...new Map(
      [
        ...modeHistory.map(item => item.track),
        ...app.state.localTracks.slice().reverse(),
        ...app.state.downloads.map(item => item.track),
      ]
        .filter(track => true)
        .map(track => [track.id, track]),
    ).values(),
  ].slice(0, 3);
  const musicTracks =
    musicList === 'history'
      ? recentMusic
      : musicList === 'favorites'
      ? modeTracks
      : musicList === 'downloads'
      ? modeDownloads.map(item => item.track)
      : app.state.localTracks;
  const musicTitle = summary.find(item => item[0] === selectedList)?.[2] ?? '';
  const openBrowse = () => {
    app.open('library-browse');
  };
  return (
    <>
      <Animated.ScrollView
        testID="library-home"
        style={s.root}
        onLayout={event => overviewPrewarm.current?.onLayout(event)}
        onScroll={libraryScrollEvent}
        scrollEventThrottle={16}
        contentContainerStyle={[
          s.content,
          {
            paddingHorizontal: layout.pageHorizontalPadding,
            paddingTop: layout.pageTopPadding,
            paddingBottom: layout.scrollBottomPadding,
          },
        ]}
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
      >
        <LibraryTop />
        {
          <View testID="library-music-intro" style={s.musicIntro}>
            <Text style={[s.musicIntroTitle, { color: theme.text }]}>
              {'在音乐里\n遇见更好的自己'}
            </Text>
            <View style={s.musicIntroFooter}>
              <Text style={[s.musicIntroScript, { color: theme.muted }]}>
                {'Good\nMusic'}
              </Text>
              <Text style={[s.musicIntroCopy, { color: theme.muted }]}>
                {'让每一首歌\n陪你度过每一个日常'}
              </Text>
            </View>
          </View>
        }
        {
          <LibraryPlaylistSection
            tab={playlistTab}
            onTab={setPlaylistTab}
            curated={playlistPages.items}
            mine={[...app.state.playlists, ...linkedPlaylists(app.state)]}
            mineTracks={knownTracks}
            loading={playlistPages.loading}
            error={playlistPages.error}
            onMore={() =>
              playlistTab === 'curated' ? openBrowse() : app.open('playlists')
            }
            onCreate={() => {
              setCreatePlaylistTitle('');
              setCreatePlaylistOpen(true);
            }}
            onOpenCurated={openCollection}
            onOpenMine={item =>
              'provider' in item
                ? openCollection(item)
                : openPersonalPlaylist(item.id)
            }
            onLoadMore={() => {
              void playlistPages.loadMore();
            }}
          />
        }
        <View key={mode} testID="library-summary-cards" style={s.musicListTabs}>
          {summary.map(item => (
            <Pressable
              key={item[0]}
              testID={`library-summary-${item[0]}`}
              accessibilityLabel={item[2]}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedList === item[0] }}
              onPress={() => setMusicList(item[0] as LibraryListPage)}
              style={s.musicListTab}
            >
              <View style={s.musicListTabCopy}>
                <Text
                  numberOfLines={1}
                  style={[
                    s.musicListTabTitle,
                    { color: selectedList === item[0] ? accent : theme.text },
                    selectedList === item[0] && s.musicListTabTitleActive,
                  ]}
                >
                  {item[2]}
                </Text>
                <Text style={[s.summaryMeta, { color: theme.muted }]}>
                  {item[3]}
                </Text>
              </View>
              {selectedList === item[0] ? (
                <View
                  style={[s.musicListIndicator, { backgroundColor: accent }]}
                />
              ) : null}
            </Pressable>
          ))}
        </View>
        {
          <>
            <SectionHead
              title={musicTitle}
              action="更多 ›"
              actionTestID="library-music-more"
              onPress={() => app.open(selectedList)}
              accent={accent}
            />
            <LibraryOverviewTracks
              tracks={musicTracks.slice(0, 3)}
              identity={`${mode}:${selectedList}`}
              enabled={
                selectedList === 'history' || selectedList === 'favorites'
              }
              metricsRef={overviewPrewarm}
              testID={
                selectedList === 'history'
                  ? 'library-recent-list'
                  : `library-${selectedList}-preview`
              }
              style={s.recentList}
            >
              {musicTracks.slice(0, 3).map(track => (
                <LibraryMusicTrackRow
                  key={track.id}
                  track={track}
                  showPlaylist={true}
                  showProvider={true}
                  onDownload={undefined}
                  onPlay={() =>
                    playLibraryTrack(
                      app,
                      track,
                      musicTracks,
                      selectedList === 'downloads' || selectedList === 'local',
                      undefined,
                      undefined,
                    )
                  }
                  showDownload={
                    selectedList !== 'downloads' && selectedList !== 'local'
                  }
                  unavailableReason={libraryReason(
                    app,
                    track,
                    selectedList === 'downloads' || selectedList === 'local',
                  )}
                  downloadStatus={
                    selectedList === 'downloads'
                      ? downloadRowStatus(
                          modeDownloads,
                          app.downloadActivities ?? [],
                          track,
                        )
                      : undefined
                  }
                  subtitle={undefined}
                />
              ))}
              {null}
              {!musicTracks.length ? (
                <>
                  <Empty
                    text={
                      selectedList === 'history'
                        ? '还没有播放记录'
                        : selectedList === 'favorites'
                        ? '这里还没有记录'
                        : selectedList === 'downloads'
                        ? '暂无下载记录'
                        : '暂无本地音乐'
                    }
                    accent={accent}
                  />
                  {selectedList === 'local' ? (
                    <View style={s.localActions}>
                      <Pressable
                        testID="library-add-local"
                        onPress={() =>
                          app.addLocalMusicDirectory().catch(() => undefined)
                        }
                        style={[s.primaryButton, s.localActionButton]}
                      >
                        <Text style={s.primaryButtonText}>
                          {'添加本地音乐'}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID="library-scan-local"
                        onPress={() => {
                          {
                            app.scanLocalMusic().catch(() => undefined);
                            return;
                          }
                        }}
                        style={[s.secondaryButton, s.localActionButton]}
                      >
                        <Text style={s.secondaryButtonText}>
                          {'扫描本地音乐'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              ) : null}
            </LibraryOverviewTracks>
          </>
        }
      </Animated.ScrollView>
      {createPlaylistOpen ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setCreatePlaylistOpen(false)}
        >
          <View style={s.editorBackdrop}>
            <View
              testID="playlist-editor"
              style={[s.editorCard, { backgroundColor: theme.panel }]}
            >
              <Text style={[s.emptyTitle, { color: theme.text }]}>
                新建歌单
              </Text>
              <TextInput
                testID="playlist-title-input"
                value={createPlaylistTitle}
                onChangeText={setCreatePlaylistTitle}
                placeholder="输入歌单名称"
                placeholderTextColor={theme.muted}
                style={[
                  s.editorInput,
                  { backgroundColor: theme.panelSoft, color: theme.text },
                ]}
              />
              <Pressable
                testID="save-playlist-title"
                disabled={!createPlaylistTitle.trim()}
                onPress={() => {
                  const value = createPlaylistTitle.trim();
                  if (!value) return;
                  app.createPlaylist(value);
                  setCreatePlaylistOpen(false);
                  setCreatePlaylistTitle('');
                }}
                style={[
                  s.primaryButton,
                  { backgroundColor: theme.accent },
                  !createPlaylistTitle.trim() && { opacity: 0.45 },
                ]}
              >
                <Text style={s.primaryButtonText}>保存</Text>
              </Pressable>
              <Pressable
                testID="cancel-playlist-title"
                onPress={() => {
                  setCreatePlaylistOpen(false);
                  setCreatePlaylistTitle('');
                }}
                style={s.editorCancel}
              >
                <Text style={[s.selectionText, { color: theme.accent }]}>
                  取消
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
function LibraryPlaylistBrowser({
  pages,
  onOpen,
  title = '精选歌单',
  emptyText = '本次通过检测的平台暂无精选歌单',
  countLabel = '个已加载歌单',
}: {
  pages: Pick<
    ReturnType<typeof useLibraryPlaylists>,
    'items' | 'loading' | 'hasMore' | 'error' | 'loadMore'
  >;
  title?: string;
  emptyText?: string;
  countLabel?: string;
  onOpen: (item: CatalogItem) => void;
}) {
  const s = useLibraryStyles();
  const theme = useTheme();
  const layout = useLayout();
  const initialFill = useRef(false);
  const requesting = useRef(false);
  const bottomEntered = useRef(false);
  const loadMore = useCallback(
    async (size: number) => {
      if (requesting.current || pages.loading) return;
      requesting.current = true;
      try {
        await pages.loadMore(size);
      } finally {
        requesting.current = false;
      }
    },
    [pages],
  );
  useEffect(() => {
    if (initialFill.current || pages.loading) return;
    initialFill.current = true;
    if (pages.items.length < 20 && pages.hasMore && !pages.error)
      void loadMore(20 - pages.items.length);
  }, [pages, loadMore]);
  return (
    <>
      <LibraryDetailScrollView
        testID="library-curated-browser"
        style={s.detailRoot}
        contentContainerStyle={{
          paddingHorizontal: layout.pageHorizontalPadding,
          paddingTop: 0,
          paddingBottom: layout.scrollBottomPadding,
        }}
        scrollEventThrottle={100}
        onScrollBeginDrag={() => {
          if (!requesting.current && !pages.loading)
            bottomEntered.current = false;
        }}
        onScroll={({ nativeEvent }) => {
          const atBottom =
            nativeEvent.contentOffset.y +
              nativeEvent.layoutMeasurement.height >=
            nativeEvent.contentSize.height - 80;
          if (!atBottom) {
            bottomEntered.current = false;
            return;
          }
          if (bottomEntered.current) return;
          bottomEntered.current = true;
          if (pages.hasMore && !pages.error) void loadMore(20);
        }}
      >
        <LibraryDetailHeader
          title={title}
          count={`${pages.items.length} ${countLabel}`}
          cover={pages.items[0]?.cover}
          coverCandidates={pages.items[0]?.coverCandidates}
        />
        <View style={s.managerGrid}>
          {pages.items.map(item => (
            <LibraryPlaylistCard
              key={`${item.provider}:${item.id}`}
              item={item}
              onPress={() => onOpen(item)}
            />
          ))}
        </View>
        {pages.error ? (
          <Pressable
            testID="library-curated-browser-retry"
            onPress={() => {
              void loadMore(20);
            }}
          >
            <Text style={s.emptyText}>{pages.error}，点击重试</Text>
          </Pressable>
        ) : null}
        {!pages.loading && !pages.error && !pages.items.length ? (
          <Empty text={emptyText} accent={theme.accent} />
        ) : null}
      </LibraryDetailScrollView>
    </>
  );
}
function LibraryTop() {
  const s = useLibraryStyles();
  const theme = useTheme();
  return (
    <View testID="library-header" style={s.libraryTopRow}>
      <Text style={[s.pageTitle, { color: theme.text }]}>漫游</Text>
    </View>
  );
}
function SectionHead({
  title,
  action,
  onPress,
  accent,
  actionTestID,
  onPlay,
  playDisabled,
  playLabel = '开始播放',
}: {
  title: string;
  action?: string;
  onPress?: () => void;
  accent: string;
  actionTestID?: string;
  onPlay?: () => void;
  playDisabled?: boolean;
  playLabel?: string;
}) {
  const s = useLibraryStyles();
  const theme = useTheme();
  return (
    <View style={s.sectionHead}>
      <Text style={[s.sectionTitle, { color: theme.text }]}>{title}</Text>
      {onPlay ? (
        <Pressable
          testID="library-content-play"
          accessibilityLabel={playLabel}
          disabled={playDisabled}
          onPress={onPlay}
          style={[s.contentPlay, playDisabled && s.contentPlayDisabled]}
        >
          <Glyph color={accent} size={13}>
            ▶
          </Glyph>
          <Text style={[s.contentPlayText, { color: accent }]}>开始播放</Text>
        </Pressable>
      ) : null}
      {action && onPress ? (
        <Pressable
          testID={actionTestID}
          onPress={onPress}
          style={s.sectionActionButton}
        >
          <Text style={[s.sectionAction, { color: accent }]}>{action}</Text>
        </Pressable>
      ) : action ? (
        <Text style={[s.sectionAction, { color: theme.muted }]}>{action}</Text>
      ) : null}
    </View>
  );
}
function downloadRowStatus(
  entries: ReturnType<typeof mediaDownloads>,
  activities: DownloadActivity[],
  track: Track,
) {
  const key = downloadTrackKey(track);
  const entry = entries.find(item => downloadTrackKey(item.track) === key);
  return entry
    ? downloadStatusText(
        entry,
        activities.find(item => downloadTrackKey(item.track) === key),
      )
    : undefined;
}
function downloadRowProgress(activities: DownloadActivity[], track: Track) {
  const activity = activities.find(
    item => downloadTrackKey(item.track) === downloadTrackKey(track),
  );
  if (
    !activity ||
    !['queued', 'downloading'].includes(activity.phase) ||
    !activity.totalBytes
  )
    return undefined;
  return Math.max(
    0,
    Math.min(0.99, (activity.bytesDownloaded ?? 0) / activity.totalBytes),
  );
}
function LibraryListTrack({
  mode,
  ...props
}: {
  mode: LibraryMode;
  track: Track;
  tracks: Track[];
  index: number;
  accent: string;
  subtitle?: string;
  showFavoriteActions?: boolean;
  onDelete?: () => void;
  requireLocal?: boolean;
  resumeEntry?: HistoryEntry;
  downloadStatus?: string;
  downloadProgress?: number;
}) {
  const app = useApp();
  return (
    <LibraryMusicTrackRow
      track={props.track}
      subtitle={props.subtitle}
      downloadStatus={props.downloadStatus}
      downloadProgress={props.downloadProgress}
      onPlay={() =>
        playLibraryTrack(
          app,
          props.track,
          props.tracks,
          props.requireLocal,
          undefined,
          undefined,
        )
      }
      showDownload={!props.requireLocal}
      showPlaylist={true}
      showProvider={true}
      onDownload={undefined}
      unavailableReason={libraryReason(app, props.track, props.requireLocal)}
      onDelete={props.onDelete}
    />
  );
}
function LibraryOverviewTracks({
  tracks,
  identity,
  enabled,
  metricsRef,
  testID,
  style,
  children,
}: {
  tracks: Track[];
  identity: string;
  enabled: boolean;
  metricsRef: React.MutableRefObject<ReturnType<
    typeof useVisibleTrackPrewarm
  > | null>;
  testID: string;
  style: React.ComponentProps<typeof View>['style'];
  children: React.ReactNode;
}) {
  const app = useApp();
  const visible = useVisibleTrackPrewarm({
    identity: `library-overview:${identity}:${
      app.prewarmContextKey ?? app.state.settings.quality
    }`,
    enabled: enabled && app.tab === 'library' && app.page === 'root',
    tracks: tracks.map(track => libraryPlaybackTrack(track, app.state)),
    prewarm: app.prewarmDetailTracks,
    release: app.releaseDetailPrewarm,
  });
  metricsRef.current = visible;
  useEffect(
    () => () => {
      metricsRef.current = null;
    },
    [metricsRef],
  );
  return (
    <View testID={testID} style={style} onLayout={visible.onListLayout}>
      {React.Children.map(children, (child, index) => {
        const track = tracks[index];
        return !track ? (
          child
        ) : visible.failedKeys.has(trackQueueKey(track)) ? null : (
          <View
            onLayout={event => visible.onRowLayout(trackQueueKey(track), event)}
          >
            {child}
          </View>
        );
      })}
    </View>
  );
}
function LibraryList({
  mode,
  page,
  onOpenCollection,
  onOpenPlaylist,
}: {
  mode: LibraryMode;
  page: LibraryListPage;
  onOpenCollection: (item: CatalogItem) => void;
  onOpenPlaylist: (entry: string) => void;
}) {
  const s = useLibraryStyles();
  const app = useApp();
  const theme = useTheme();
  const defaultFilter = page === 'history' ? 'track' : 'all';
  const musicDownloads = page === 'downloads';
  const recentMusicHistory = page === 'history';
  const [recordFilters, setRecordFilters] = useCatalogViewState<
    Record<string, string>
  >('library-record-filters', {});
  const filterKey = `${mode}:${page}`;
  const selectedFilter = recordFilters[filterKey] ?? defaultFilter;
  const setFilter = (next: string) =>
    setRecordFilters({ ...recordFilters, [filterKey]: next });
  const filter = musicDownloads ? 'all' : selectedFilter;
  const [deleteTrack, setDeleteTrack] = useState<Track | null>(null);
  const supported = new Set<string>([]);
  const allowed = (item: Track | CatalogItem) => true;
  const knownTracks = collectKnownTracks(app.state, app.current);
  const favoriteTracks = [
    ...app.state.favorites
      .map(id => findKnownTrack(knownTracks, id, 'music'))
      .filter(Boolean),
  ] as Track[];
  const tracks = favoriteTracks.filter(track => allowed(track));
  const savedCollections = app.state.savedCollections.filter(item =>
    allowed(item),
  );
  const favoriteKeys = app.state.favoriteCollections;
  const history = mediaHistory(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const persistedDownloads = mediaDownloads(app.state, mode);
  const downloadEntries =
    page === 'downloads'
      ? downloadRecordRows(
          persistedDownloads,
          app.downloadActivities ?? [],
          mode,
        )
      : persistedDownloads;
  const downloads = downloadEntries.filter(entry => allowed(entry.track));
  const sizeRequestKey =
    page === 'downloads'
      ? persistedDownloads
          .filter(entry => entry.status === 'downloaded' && !entry.fileSize)
          .map(entry => entry.id)
          .join('|')
      : '';
  useEffect(() => {
    if (page === 'downloads')
      void app
        .refreshDownloadFileSizes?.(persistedDownloads)
        .catch(() => undefined);
  }, [page, mode, sizeRequestKey, app.refreshDownloadFileSizes]);
  const accent = theme.accent;
  const title =
    page === 'favorites'
      ? '我的收藏'
      : page === 'history'
      ? '最近播放'
      : '下载记录';
  const tabs =
    page === 'favorites'
      ? [
          ['all', '歌曲'],
          ['collection', '歌单'],
          ['album', '专辑'],
          ['artist', '歌手'],
        ]
      : page === 'history'
      ? [
          ['track', '歌曲'],
          ['collection', '歌单'],
          ['album', '专辑'],
          ['artist', '歌手'],
        ]
      : [];
  const historyTracks = history.filter(entry => true).map(entry => entry.track);
  const downloadTracks = downloads.map(entry => entry.track);
  const showCollections =
    page === 'favorites' &&
    (filter === 'collection' || filter === 'artist' || filter === 'album');
  const showHistoryEntities = page === 'history' && filter !== 'track';
  const recentEntities = showHistoryEntities
    ? (app.state.musicEntityHistory ?? [])
        .filter(
          entry =>
            entry.kind === (filter === 'collection' ? 'playlist' : filter),
        )
        .sort((a, b) => b.playedAt - a.playedAt)
    : [];
  const baseTracks =
    page === 'favorites'
      ? tracks
      : page === 'history'
      ? historyTracks
      : downloadTracks;
  const grouped: Array<{
    name: string;
    tracks: Track[];
    cover?: string;
  }> = [];
  const showEntityContent =
    showCollections || grouped.length > 0 || recentEntities.length > 0;
  const trackRows =
    filter === 'collection' || filter === 'album' || filter === 'artist'
      ? []
      : baseTracks;
  const collections = savedCollections.filter(item => {
    if (!favoriteKeys.includes(collectionFavoriteKey(item))) return false;
    const type = collectionEntityKind(item);
    return filter === 'artist'
      ? type === 'artist'
      : filter === 'album'
      ? type === 'album'
      : type !== 'artist' && type !== 'album';
  });
  const collectionRows = showCollections ? collections : [];
  const paginationTotal =
    trackRows.length +
    collectionRows.length +
    recentEntities.length +
    grouped.length;
  const pagination = useLibraryRecordPages(
    `${page}:${mode}:${filter}`,
    paginationTotal,
  );
  const visiblePrewarm = useVisibleTrackPrewarm({
    identity: `records:${page}:${mode}:${filter}:${
      app.prewarmContextKey ?? app.state.settings.quality
    }:${app.pageRefreshToken ?? 0}`,
    enabled:
      app.tab === 'library' &&
      app.page === page &&
      (page === 'history' || page === 'favorites') &&
      !showCollections &&
      !showHistoryEntities,
    tracks: trackRows
      .slice(0, pagination.visibleCount)
      .map(track => libraryPlaybackTrack(track, app.state)),
    nestedList: true,
    prewarm: app.prewarmDetailTracks,
    release: app.releaseDetailPrewarm,
  });
  if (page === 'local') return <LocalMusic />;
  const visibleTracks = trackRows
    .slice(0, pagination.visibleCount)
    .filter(track => !visiblePrewarm.failedKeys.has(trackQueueKey(track)));
  const visibleCollections = collectionRows.slice(
    0,
    Math.max(0, pagination.visibleCount - trackRows.length),
  );
  const visibleEntities = recentEntities.slice(
    0,
    Math.max(
      0,
      pagination.visibleCount - trackRows.length - collectionRows.length,
    ),
  );
  const visibleGroups = grouped.slice(
    0,
    Math.max(
      0,
      pagination.visibleCount -
        trackRows.length -
        collectionRows.length -
        recentEntities.length,
    ),
  );
  const count = showHistoryEntities
    ? `${recentEntities.length} ${
        filter === 'artist'
          ? '位歌手'
          : filter === 'album'
          ? '张专辑'
          : '个歌单'
      }`
    : `${paginationTotal} ${modeInfo[mode].unit}`;
  const firstEntity = recentEntities[0];
  const favoriteCover =
    page === 'favorites' && (showCollections || !baseTracks.length)
      ? collections[0]
      : undefined;
  const headerCover = showHistoryEntities
    ? firstEntity && 'item' in firstEntity
      ? firstEntity.item.cover
      : undefined
    : favoriteCover?.cover ?? baseTracks[0]?.cover;
  const headerCoverCandidates = showHistoryEntities
    ? firstEntity && 'item' in firstEntity
      ? firstEntity.item.coverCandidates
      : []
    : favoriteCover?.coverCandidates ??
      (baseTracks[0] ? trackCoverCandidates(baseTracks[0]) : []);
  const headerCoverKey = showHistoryEntities
    ? firstEntity && 'playlistId' in firstEntity
      ? firstEntity.coverKey
      : baseTracks[0]?.coverKey
    : baseTracks[0]?.coverKey;
  const actions = (
    <LibraryPlaylistActions
      tracks={libraryPlayableTracks(
        app,
        filter === 'collection' || filter === 'album' || filter === 'artist'
          ? []
          : baseTracks,
        page === 'downloads',
      )}
      showDownload={!showCollections && page !== 'downloads'}
      showFavorite={!showCollections && page === 'history'}
      surfaceColor="transparent"
      contentInset={12}
      mediaKind={mode}
      sticky
    />
  );
  const filters = tabs.length ? (
    <View
      testID="library-list-filters"
      style={[s.listTabs, { backgroundColor: 'transparent' }]}
    >
      {tabs.map(item => (
        <StickyPressable
          key={item[0]}
          testID={`library-filter-${item[0]}`}
          onPress={() => setFilter(item[0])}
          style={[s.listTab, filter === item[0] && s.listTabSelected]}
        >
          <Text
            style={[s.listTabText, filter === item[0] && { color: accent }]}
          >
            {item[1]}
          </Text>
        </StickyPressable>
      ))}
    </View>
  ) : null;
  const content = (
    <>
      {page === 'history' &&
      (history.length || app.state.musicEntityHistory?.length) ? (
        <Pressable
          testID="library-clear-history"
          onPress={() => app.clearHistory(mode)}
          style={s.clearButton}
        >
          <Text
            onPress={() => app.clearHistory(mode)}
            style={{ color: accent }}
          >
            清空
          </Text>
        </Pressable>
      ) : null}
      <View
        testID="library-record-track-list"
        onLayout={visiblePrewarm.onListContainerLayout}
        style={{ marginHorizontal: 18 }}
      >
        {visibleTracks.map((track, index) => (
          <View
            key={`${track.id}-${index}`}
            testID={`library-record-prewarm-${trackQueueKey(track)}`}
            onLayout={event =>
              visiblePrewarm.onRowLayout(trackQueueKey(track), event)
            }
          >
            <LibraryListTrack
              key={`${track.id}-${index}`}
              mode={mode}
              track={track}
              tracks={baseTracks}
              index={index}
              accent={accent}
              resumeEntry={undefined}
              subtitle={undefined}
              downloadStatus={
                page === 'downloads'
                  ? downloadRowStatus(
                      downloads,
                      app.downloadActivities ?? [],
                      track,
                    )
                  : undefined
              }
              downloadProgress={
                page === 'downloads'
                  ? downloadRowProgress(app.downloadActivities ?? [], track)
                  : undefined
              }
              showFavoriteActions={page === 'favorites'}
              requireLocal={page === 'downloads'}
              onDelete={
                page === 'downloads' ? () => setDeleteTrack(track) : undefined
              }
            />
          </View>
        ))}
      </View>
      {showCollections
        ? visibleCollections.map(item => (
            <CatalogRow
              key={collectionFavoriteKey(item)}
              item={item}
              accent={accent}
              onPress={() =>
                onOpenCollection({
                  ...item,
                  metadata: { ...item.metadata, detailLayout: 'playlist' },
                })
              }
            />
          ))
        : null}
      {visibleEntities.map(entry =>
        'playlistId' in entry ? (
          <RecentOwnPlaylistRow
            key={musicEntityHistoryKey(entry)}
            entry={entry}
            onPress={() => onOpenPlaylist(entry.playlistId)}
          />
        ) : (
          <View
            key={musicEntityHistoryKey(entry)}
            testID={`library-history-${entry.kind}-${entry.item.provider}-${entry.item.id}`}
          >
            <CatalogRow
              item={entry.item}
              accent={accent}
              onPress={() => onOpenCollection(entry.item)}
            />
          </View>
        ),
      )}
      {visibleGroups.map(group => (
        <GroupRow
          key={group.name}
          group={group}
          accent={accent}
          mediaKind={mode}
          requireLocal={page === 'downloads'}
        />
      ))}
      {!visibleTracks.length && !showEntityContent ? (
        <>
          <Empty
            text={
              page === 'downloads'
                ? '暂无下载记录'
                : showHistoryEntities
                ? `还没有最近播放${
                    filter === 'artist'
                      ? '歌手'
                      : filter === 'album'
                      ? '专辑'
                      : '歌单'
                  }`
                : '这里还没有记录'
            }
            accent={accent}
          />
          {page === 'downloads' ? (
            <Pressable
              onPress={() => app.setTab('search')}
              style={s.primaryButton}
            >
              <Text style={s.primaryButtonText}>
                去发现{modeInfo[mode].label}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {showCollections && !collections.length && !visibleTracks.length ? (
        <Empty text="还没有收藏合集" accent={accent} />
      ) : null}
    </>
  );
  if (recentMusicHistory)
    return (
      <RecentPlaybackDetail
        identity={undefined}
        title={title}
        count={count}
        cover={headerCover}
        coverCandidates={headerCoverCandidates}
        coverKey={headerCoverKey}
        actions={actions}
        filters={filters}
        onScrollOffset={traceRoamHistoryScroll}
        onLayout={visiblePrewarm.onLayout}
        onControlsLayout={visiblePrewarm.onControlsLayout}
        onTrackListLayout={visiblePrewarm.onListLayout}
        onScroll={event => {
          pagination.onScroll(event);
          visiblePrewarm.onScroll(event.nativeEvent);
        }}
      >
        {content}
      </RecentPlaybackDetail>
    );
  return (
    <LibraryListDetail
      page={page}
      mode={mode}
      title={title}
      count={count}
      cover={headerCover}
      coverCandidates={headerCoverCandidates}
      coverKey={headerCoverKey}
      actions={actions}
      filters={filters}
      onScroll={pagination.onScroll}
      visiblePrewarm={visiblePrewarm}
      overlay={
        page === 'downloads' && deleteTrack ? (
          <TrackDeleteModal
            track={deleteTrack}
            kind="download"
            onClose={() => setDeleteTrack(null)}
          />
        ) : null
      }
    >
      {content}
    </LibraryListDetail>
  );
}
function LibraryListDetail({
  page,
  mode,
  title,
  count,
  cover,
  coverCandidates,
  coverKey,
  actions,
  filters,
  onScroll,
  visiblePrewarm,
  children,
  overlay,
}: {
  page: LibraryListPage;
  mode: LibraryMode;
  title: string;
  count: string;
  cover?: string;
  coverCandidates?: string[];
  coverKey?: Track['coverKey'];
  actions: React.ReactNode;
  filters: React.ReactNode;
  onScroll?: React.ComponentProps<typeof ScrollView>['onScroll'];
  visiblePrewarm?: ReturnType<typeof useVisibleTrackPrewarm>;
  children: React.ReactNode;
  overlay: React.ReactNode;
}) {
  const s = useLibraryStyles();
  const layout = useLayout();
  const theme = useTheme();
  const musicDownloads = page === 'downloads';
  const [detailColor, setDetailColor] = useState(theme.bg);
  const scrollGradient = usePlaylistDetailScrollGradient(
    `library-list:${page}:${mode}`,
  );
  return (
    <View style={s.detailRoot}>
      <PlaylistDetailGradientViewport stuck={scrollGradient.stuck} />
      <LibraryDetailScrollView
        testID={`library-${page}`}
        style={s.detailRoot}
        stickyHeaderIndices={[1]}
        onLayout={visiblePrewarm?.onLayout}
        onScroll={event => {
          scrollGradient.onScroll(event.nativeEvent.contentOffset.y);
          visiblePrewarm?.onScroll(event.nativeEvent);
          onScroll?.(event);
        }}
        contentContainerStyle={{
          paddingHorizontal: layout.pageHorizontalPadding,
          paddingTop: 0,
          paddingBottom: layout.scrollBottomPadding,
        }}
      >
        <LibraryDetailHeader
          title={title}
          cover={cover}
          coverKey={coverKey}
          coverCandidates={coverCandidates}
          count={count}
          showTopGradient
          onColorChange={setDetailColor}
        />
        <View
          testID="library-list-controls"
          onLayout={event => {
            scrollGradient.onStickyLayout(event);
            visiblePrewarm?.onControlsLayout(event);
          }}
          style={[
            s.listStickyGroup,
            musicDownloads && s.listStickyActionsOnly,
            {
              marginHorizontal: -layout.pageHorizontalPadding,
              paddingHorizontal: 0,
            },
          ]}
        >
          <LibraryReferenceActions
            color={detailColor}
            stuck={scrollGradient.stuck}
          >
            {actions}
          </LibraryReferenceActions>
          {filters}
        </View>
        <View onLayout={visiblePrewarm?.onListLayout}>{children}</View>
      </LibraryDetailScrollView>
      {overlay}
    </View>
  );
}
function LibraryReferenceActions({
  color,
  stuck,
  children,
}: {
  color: string;
  stuck: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      testID="library-reference-action-surface"
      style={{ height: 72, backgroundColor: color }}
    >
      <StickyBackgroundExtension active={stuck} color={theme.bg} />
      {stuck ? <PlaylistInformationTopGradient /> : null}
      <PlaylistInformationGradient />
      {children}
    </View>
  );
}
function LocalMusic() {
  const s = useLibraryStyles();
  const app = useApp();
  const layout = useLayout();
  const theme = useTheme();
  const tracks = app.state.localTracks;
  const pagination = useLibraryRecordPages('local:music', tracks.length);
  const [detailColor, setDetailColor] = useState(theme.bg);
  const scrollGradient = usePlaylistDetailScrollGradient(
    'library-list:local:music',
  );
  const [deleteTrack, setDeleteTrack] = useState<Track | null>(null);
  const [deleteAllTracks, setDeleteAllTracks] = useState<Track[] | null>(null);
  useEffect(() => {
    app.refreshLocalMusicArtwork?.().catch(() => undefined);
  }, [app.refreshLocalMusicArtwork]);
  return (
    <View style={s.detailRoot}>
      <PlaylistDetailGradientViewport stuck={scrollGradient.stuck} />
      <LibraryDetailScrollView
        testID="library-local"
        style={s.detailRoot}
        stickyHeaderIndices={[1]}
        onScroll={event => {
          scrollGradient.onScroll(event.nativeEvent.contentOffset.y);
          pagination.onScroll(event);
        }}
        contentContainerStyle={{
          paddingHorizontal: layout.pageHorizontalPadding,
          paddingTop: 0,
          paddingBottom:
            layout.scrollBottomPadding +
            (app.current ? layout.miniPlayerCoverSize + 12 : 0),
        }}
      >
        <LibraryDetailHeader
          title="本地音乐"
          count={`${tracks.length} 首`}
          cover={tracks[0]?.cover}
          coverKey={tracks[0]?.coverKey}
          coverCandidates={tracks[0] ? trackCoverCandidates(tracks[0]) : []}
          description="扫描手机内的音乐文件"
          showTopGradient
          onColorChange={setDetailColor}
        />
        <View
          testID="library-list-controls"
          onLayout={scrollGradient.onStickyLayout}
          style={[
            s.listControls,
            {
              marginHorizontal: -layout.pageHorizontalPadding,
              backgroundColor: detailColor,
              paddingHorizontal: 0,
            },
          ]}
        >
          <LibraryReferenceActions
            color={detailColor}
            stuck={scrollGradient.stuck}
          >
            <LibraryPlaylistActions
              tracks={libraryPlayableTracks(app, tracks, true)}
              showDownload
              showFavorite
              surfaceColor="transparent"
              contentInset={12}
              onScanLocal={() => app.scanLocalMusic().catch(() => undefined)}
              onAddLocal={() =>
                app.addLocalMusicDirectory().catch(() => undefined)
              }
              onDeleteAllLocal={() => setDeleteAllTracks([...tracks])}
              deleteAllDisabled={!tracks.length}
              sticky
            />
          </LibraryReferenceActions>
        </View>
        {tracks.length ? (
          <View>
            {tracks.slice(0, pagination.visibleCount).map(track => (
              <LibraryMusicTrackRow
                key={track.id}
                track={track}
                onPlay={() => playLibraryTrack(app, track, tracks, true)}
                showDownload
                unavailableReason={libraryReason(app, track, true)}
                onDelete={() => setDeleteTrack(track)}
              />
            ))}
          </View>
        ) : (
          <View style={s.localEmpty}>
            <View style={s.localFolder}>
              <Text style={s.localFolderGlyph}>♫</Text>
            </View>
            <Text style={s.emptyTitle}>暂无本地音乐</Text>
            <Text style={s.emptyText}>
              可以扫描设备中的音乐文件{`\n`}添加到本地音乐库
            </Text>
          </View>
        )}
      </LibraryDetailScrollView>
      {deleteTrack ? (
        <TrackDeleteModal
          track={deleteTrack}
          kind="local"
          onClose={() => setDeleteTrack(null)}
        />
      ) : null}
      {deleteAllTracks?.length ? (
        <TrackDeleteModal
          track={deleteAllTracks[0]!}
          tracks={deleteAllTracks}
          kind="local"
          onClose={() => setDeleteAllTracks(null)}
        />
      ) : null}
    </View>
  );
}
function CatalogRow({
  item,
  accent,
  onPress,
}: {
  item: CatalogItem;
  accent: string;
  onPress: () => void;
}) {
  const s = useLibraryStyles();
  const app = useApp();
  return (
    <View style={s.catalogRow}>
      <Pressable
        onPress={onPress}
        accessibilityLabel={`打开 ${item.title}`}
        style={s.catalogOpen}
      >
        <ResilientHomeCover
          uri={item.cover}
          uris={item.coverCandidates}
          fallback={covers.vinyl}
          testID="library-catalog-cover"
          style={s.catalogCover}
          imageStyle={s.catalogCoverRadius}
        />
        <View style={s.compactCopy}>
          <Text numberOfLines={1} style={s.compactTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={s.compactMeta}>
            {platformCaption(item.description, item.provider)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={
          app.isCollectionFavorite(item) ? '取消收藏合集' : '收藏合集'
        }
        onPress={() => app.toggleCollectionFavorite(item)}
        hitSlop={10}
      >
        <TrackActionIcon
          kind="favorite"
          active={app.isCollectionFavorite(item)}
          color={accent}
          size={22}
        />
      </Pressable>
    </View>
  );
}
function TrackDeleteModal({
  track,
  tracks,
  kind,
  mediaKind = 'music',
  onClose,
}: {
  track: Track;
  tracks?: Track[];
  kind: 'local' | 'download';
  mediaKind?: LibraryMode;
  onClose: () => void;
}) {
  const s = useLibraryStyles();
  const app = useApp();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [systemConfirmation, setSystemConfirmation] = useState(false);
  const deleteLocal = async (
    removeFromPlaylists: boolean,
    deleteFile = false,
  ) => {
    if (!tracks) {
      return mediaKind === 'music'
        ? deleteFile
          ? app.removeLocalTrack(track.id, removeFromPlaylists, true)
          : app.removeLocalTrack(track.id, removeFromPlaylists)
        : app.removeLocalTrack(track.id, false, deleteFile, mediaKind);
    }
    // Freeze the full list when the dialog opens. Never include new additions
    // or a replacement file, and do not retry entries already removed.
    const current = mediaLocalTracks(app.state, mediaKind);
    const targets = tracks.filter(item =>
      current.some(
        value =>
          trackQueueKey(value) === trackQueueKey(item) &&
          localPlaybackReference(value) === localPlaybackReference(item),
      ),
    );
    let removed = 0;
    let failed = 0;
    for (const item of targets) {
      try {
        await (mediaKind === 'music'
          ? app.removeLocalTrack(item.id, removeFromPlaylists, deleteFile)
          : app.removeLocalTrack(item.id, false, deleteFile, mediaKind));
        removed += 1;
      } catch (error) {
        if (
          (
            error as {
              code?: string;
            }
          )?.code === 'DELETE_FILE_CANCELLED'
        )
          throw new Error(`已取消删除，已移除 ${removed} 条记录，其余记录保留`);
        failed += 1;
      }
    }
    if (failed)
      throw new Error(
        `已移除 ${removed} 条记录，${failed} 条删除失败，记录仍保留`,
      );
    app.notify(`已移除 ${removed} 条本地记录`);
  };
  const run = async (action: () => Promise<void>, deletesFile = false) => {
    if (busy) return;
    setBusy(true);
    setSystemConfirmation(deletesFile);
    try {
      await action();
      onClose();
    } catch (error) {
      app.notify(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(false);
      setSystemConfirmation(false);
    }
  };
  return (
    <Modal
      visible={!systemConfirmation}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={s.editorBackdrop}>
        <View
          testID="track-delete-modal"
          style={[s.deleteDialog, { backgroundColor: theme.panel }]}
        >
          <Text style={[s.deleteDialogTitle, { color: theme.text }]}>
            {tracks
              ? `全部删除本地${modeInfo[mediaKind].label}（${tracks.length} 条）`
              : `删除“${track.title}”`}
          </Text>
          <Text style={[s.deleteDialogCopy, { color: theme.muted }]}>
            {kind === 'local'
              ? mediaKind === 'music'
                ? '选择是否同时从歌单和设备文件中移除。'
                : '选择是否同时从设备文件中移除。'
              : '选择是否同时删除设备上的下载文件。'}
          </Text>
          <Pressable
            testID="delete-record-only"
            disabled={busy}
            onPress={() =>
              run(
                kind === 'local'
                  ? () => deleteLocal(false)
                  : () => app.removeDownload(track.id, false),
              )
            }
            style={[s.deleteOption, { backgroundColor: theme.panelSoft }]}
          >
            <Text style={[s.deleteOptionText, { color: theme.text }]}>
              仅移除记录
            </Text>
          </Pressable>
          {kind === 'local' && mediaKind === 'music' ? (
            <Pressable
              testID="delete-record-playlist"
              disabled={busy}
              onPress={() => run(() => deleteLocal(true))}
              style={[s.deleteOption, { backgroundColor: theme.panelSoft }]}
            >
              <Text style={[s.deleteOptionText, { color: theme.text }]}>
                移除记录并从歌单移除
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="delete-file"
            disabled={busy}
            onPress={() =>
              run(
                kind === 'local'
                  ? () => deleteLocal(mediaKind === 'music', true)
                  : () => app.removeDownload(track.id, true),
                true,
              )
            }
            style={[
              s.deleteOption,
              {
                backgroundColor: theme.panelSoft,
                borderColor: theme.red,
                borderWidth: 1,
              },
            ]}
          >
            <Text style={[s.deleteDangerText, { color: theme.red }]}>
              删除本地文件并移除记录
            </Text>
          </Pressable>
          <Pressable
            testID="cancel-delete"
            disabled={busy}
            onPress={onClose}
            style={s.editorCancel}
          >
            <Text style={[s.selectionText, { color: theme.accent }]}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
function RecentOwnPlaylistRow({
  entry,
  onPress,
}: {
  entry: Extract<
    MusicEntityHistoryEntry,
    {
      playlistId: string;
    }
  >;
  onPress: () => void;
}) {
  const s = useLibraryStyles();
  return (
    <View
      testID={`library-history-playlist-${entry.playlistId}`}
      style={s.catalogRow}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开 ${entry.title}`}
        onPress={onPress}
        style={s.catalogOpen}
      >
        <Cover
          coverKey={entry.coverKey}
          moduleKey="library-history-playlists"
          testID="library-history-playlist-cover"
          size={50}
          radius={8}
        />
        <View style={s.compactCopy}>
          <Text numberOfLines={1} style={s.compactTitle}>
            {entry.title}
          </Text>
          <Text numberOfLines={1} style={s.compactMeta}>
            最近播放
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
function GroupRow({
  group,
  accent,
  requireLocal = false,
  mediaKind = 'music',
}: {
  group: {
    name: string;
    tracks: Track[];
  };
  accent: string;
  requireLocal?: boolean;
  mediaKind?: LibraryMode;
}) {
  const s = useLibraryStyles();
  const theme = useTheme();
  const app = useApp();
  const playable = libraryPlayableTracks(app, group.tracks, requireLocal);
  return (
    <View style={s.catalogRow}>
      <Cover
        coverKey={group.tracks[0]?.coverKey ?? 'vinyl'}
        uri={group.tracks[0]?.cover}
        fallbackUris={
          group.tracks[0] ? trackCoverCandidates(group.tracks[0]) : []
        }
        moduleKey="library-collection-results"
        testID="library-collection-cover"
        size={50}
        radius={8}
      />
      <View style={s.compactCopy}>
        <Text
          style={[s.compactTitle, !playable.length && { color: theme.muted }]}
        >
          {group.name}
        </Text>
        <Text style={s.compactMeta}>
          {group.tracks.length} {modeInfo[mediaKind].unit}
        </Text>
      </View>
      <Pressable
        disabled={!playable.length}
        onPress={() =>
          playable[0] &&
          playLibraryTrack(app, playable[0], playable, requireLocal)
        }
        style={[s.compactPlay, { backgroundColor: tint(accent, 0) }]}
      >
        <Glyph color={accent}>▶</Glyph>
      </Pressable>
    </View>
  );
}
function Empty({ text, accent }: { text: string; accent: string }) {
  const s = useLibraryStyles();
  return (
    <View style={s.empty}>
      <Glyph color={accent} size={36}>
        ♫
      </Glyph>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}
const groupTracks = (tracks: Track[], field: 'album' | 'artist') =>
  [
    ...new Map(
      tracks.map(track => [
        track[field] || (field === 'album' ? '未知专辑' : '未知歌手'),
        [] as Track[],
      ]),
    ).keys(),
  ].map(name => ({
    name,
    tracks: tracks.filter(
      track =>
        (track[field] || (field === 'album' ? '未知专辑' : '未知歌手')) ===
        name,
    ),
  }));
const tint = (accent: string, index: number) =>
  `${accent}${['12', '10', '0D', '0A'][index % 4]}`;
function useLibraryStyles() {
  const theme = useTheme();
  return useMemo(() => libraryStyles(theme), [theme]);
}
const libraryStyles = (theme: ThemePalette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    detailRoot: { flex: 1, backgroundColor: theme.bg },
    content: { paddingHorizontal: 18, paddingTop: 6 },
    libraryTopRow: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    pageTitle: { color: theme.text, fontSize: 26, fontWeight: '500' },
    brandRow: { height: 48, flexDirection: 'row', alignItems: 'center' },
    brandIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandIconText: { color: '#fff', fontSize: 17, fontWeight: '400' },
    brand: { marginLeft: 7, fontSize: 18, fontWeight: '400' },
    modeTabs: {
      height: 44,
      flexDirection: 'row',
      gap: 24,
      justifyContent: 'flex-start',
    },
    modeTab: { minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    modeTabText: { color: theme.muted, fontSize: 17, fontWeight: '400' },
    modeTabTextActive: { color: theme.text },
    modeIndicator: {
      position: 'absolute',
      bottom: 0,
      width: 27,
      height: 2,
      borderRadius: 2,
    },
    musicIntro: {
      height: 140,
      width: '48%',
      paddingTop: 32,
      backgroundColor: 'transparent',
    },
    musicIntroTitle: {
      color: theme.text,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: '700',
    },
    musicIntroFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 9,
      gap: 8,
    },
    musicIntroScript: {
      color: theme.muted,
      fontFamily: 'cursive',
      fontSize: 23,
      lineHeight: 24,
      transform: [{ rotate: '-12deg' }],
      width: 57,
    },
    musicIntroCopy: {
      color: theme.muted,
      fontSize: 9,
      lineHeight: 14,
      flex: 1,
    },
    musicListTabs: {
      flexDirection: 'row',
      height: 64,
      backgroundColor: 'transparent',
    },
    musicListTab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    musicListTabCopy: { alignItems: 'center' },
    musicListTabTitle: { color: theme.text, fontSize: 15, fontWeight: '400' },
    musicListTabTitleActive: { fontWeight: '600' },
    musicListIndicator: {
      position: 'absolute',
      bottom: 0,
      height: 2,
      width: 27,
      borderRadius: 2,
    },
    summaryMeta: { color: theme.muted, fontSize: 12, marginTop: 2 },
    heroRadius: { borderRadius: 14 },
    sectionHead: {
      minHeight: 44,
      marginTop: 24,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    sectionTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 20,
      fontWeight: '500',
    },
    sectionAction: { fontSize: 12, fontWeight: '400' },
    contentPlay: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    contentPlayText: { fontSize: 12 },
    contentPlayDisabled: { opacity: 0.45 },
    collectionCoverRadius: { borderRadius: 9 },
    compactArtworkRadius: { borderRadius: 7 },
    compactCopy: { flex: 1, minWidth: 0 },
    compactTitle: { color: theme.text, fontSize: 14, fontWeight: '400' },
    compactMeta: { color: theme.muted, fontSize: 12, marginTop: 3 },
    compactPlay: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recentList: { width: '100%', minWidth: 0 },
    listTabs: {
      flexDirection: 'row',
      height: 40,
      paddingHorizontal: 18,
      marginTop: 6,
      marginBottom: 8,
      gap: 6,
      backgroundColor: theme.bg,
    },
    listControls: {
      height: 72,
      paddingHorizontal: 12,
      backgroundColor: theme.bg,
    },
    listStickyGroup: {
      minHeight: 126,
      paddingHorizontal: 12,
      backgroundColor: theme.bg,
    },
    listStickyActionsOnly: { minHeight: 72 },
    listTopBar: {
      height: 44,
      marginHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    listHero: {
      marginHorizontal: 20,
      marginBottom: 14,
      flexDirection: 'row',
      gap: 16,
      alignItems: 'center',
    },
    listHeroIcon: {
      width: 74,
      height: 74,
      borderRadius: 37,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listHeroTitle: { color: theme.text, fontSize: 21, fontWeight: '400' },
    catalogOpen: {
      flex: 1,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
    },
    listTab: {
      flex: 1,
      height: 32,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    listTabSelected: {
      borderColor: theme.accent,
    },
    listTabText: { color: theme.muted, fontSize: 12 },
    clearButton: { alignSelf: 'flex-end', marginRight: 20, padding: 10 },
    catalogRow: {
      minHeight: 66,
      marginHorizontal: 18,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    catalogCover: { width: 50, height: 50 },
    catalogCoverRadius: { borderRadius: 8 },
    localEmpty: { alignItems: 'center', paddingTop: 48 },
    localFolder: {
      width: 82,
      height: 67,
      borderRadius: 12,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    localFolderGlyph: { color: theme.accent, fontSize: 35 },
    empty: { alignItems: 'center', paddingVertical: 32 },
    emptyTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '400',
      marginTop: 15,
    },
    emptyText: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      marginTop: 6,
    },
    primaryButton: {
      alignSelf: 'center',
      minWidth: 145,
      height: 39,
      borderRadius: 20,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
    },
    primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '400' },
    secondaryButton: {
      alignSelf: 'center',
      minWidth: 145,
      height: 39,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    secondaryButtonText: {
      color: theme.accent,
      fontSize: 14,
      fontWeight: '400',
    },
    localActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginTop: 18,
    },
    localActionButton: { marginTop: 0 },
    sectionActionButton: {
      paddingRight: 24,
      minHeight: 44,
      justifyContent: 'center',
    },
    managerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      paddingHorizontal: 18,
    },
    selectionText: { color: theme.accent, fontSize: 14, fontWeight: '400' },
    editorCard: {
      width: '82%',
      borderRadius: 18,
      backgroundColor: theme.panel,
      padding: 22,
      elevation: 8,
    },
    editorBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    editorCancel: { alignSelf: 'center', padding: 10, marginTop: 6 },
    deleteDialog: {
      width: '82%',
      borderRadius: 20,
      padding: 20,
      backgroundColor: theme.panel,
    },
    deleteDialogTitle: { color: theme.text, fontSize: 17, fontWeight: '500' },
    deleteDialogCopy: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 8,
    },
    deleteOption: {
      minHeight: 44,
      borderRadius: 12,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
    },
    deleteOptionText: { color: theme.text, fontSize: 14 },
    deleteDangerText: { color: theme.red, fontSize: 14 },
    editorInput: {
      height: 43,
      borderRadius: 12,
      backgroundColor: theme.panelSoft,
      color: theme.text,
      paddingHorizontal: 12,
      marginTop: 14,
    },
    detailTitle: {
      color: theme.text,
      fontFamily: serif,
      fontSize: 24,
      fontWeight: '400',
    },
    detailMeta: { color: theme.muted, fontSize: 13, marginTop: 5 },
  });
