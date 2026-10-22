import { PersonalPlaylistDetail } from '../components/PersonalPlaylistDetail';
import { LibraryPlaylistActions } from '../components/LibraryPlaylistActions';
import { collectKnownTracks, libraryReason, libraryPlayableTracks, playLibraryTrack } from '../services/libraryPlaybackActions';
import { PersonalPlaylistManager } from '../components/PersonalPlaylistManager';
import { linkedPlaylists } from '../services/linkedPlaylist';
import { HomePlaylistDetail } from '../components/HomePlaylistDetail';
import { useVisibleTrackPrewarm } from '../components/useVisibleTrackPrewarm';
import { useStableNativeScrollEvent } from '../components/useStableNativeScrollEvent';
import { RecentPlaybackDetail } from '../components/RecentPlaybackDetail';
import {
  collectionEntityKind,
  collectionFavoriteKey,
} from '../services/collectionIdentity';
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
import { Cover, Glyph } from '../components/UI';
import { platformCaption } from '../components/platformLabels';
import { ResilientHomeCover } from '../components/ResilientHomeCover';
import { StickyPressable } from '../components/StickyPressable';
import { LibraryMusicTrackRow } from '../components/LibraryMusicTrackRow';
import { TrackActionIcon } from '../components/TrackActionIcon';
import { downloadRecordRows, downloadStatusText, downloadTrackKey, type DownloadActivity } from '../services/downloadPresentation';
import { LibraryDetailHeader } from '../components/LibraryDetailHeader';
import { LibraryDetailScrollView } from '../components/LibraryDetailAppearance';
import { StickyBackgroundExtension } from '../components/StickyBackgroundExtension';
import {
  traceRoamBackground,
  traceRoamHistoryScroll,
} from '../components/roamBackgroundDiagnostic';
import {
  PlaylistDetailGradientViewport,
  usePlaylistDetailScrollGradient,
} from '../components/PlaylistDetailScrollGradient';
import {
  PlaylistInformationGradient,
  PlaylistInformationTopGradient,
} from '../components/PlaylistInformationSurface';
import { useLibraryRecordPages } from '../components/useLibraryRecordPages';
import {
  LibraryPlaylistSection,
  LibraryPlaylistCard,
  type LibraryPlaylistTab,
} from '../components/LibraryPlaylistSection';
import { CollectionDetail } from './HomeScreen';
import {
  mediaProviders,
  hasExternalMediaOrigin,
} from '../services/mediaDiscoveryPaging';
import {
  mediaDownloads,
  mediaHistory,
  mediaLocalTracks,
  trackMediaKind,
} from '../services/mediaLibrary';
import type {
  CatalogItem,
  MusicEntityHistoryEntry,
  HistoryEntry,
  Track,
} from '../domain/types';
import { useApp, useCatalogViewState } from '../state/AppContext';
import { useLibraryPlaylists } from '../state/useLibraryPlaylists';
import { useLibraryMediaPages } from '../state/useLibraryMediaPages';
import { useLayout } from '../state/LayoutContext';
import { serif, useTheme, type ThemePalette } from '../theme';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { trackQueueKey } from '../domain/types';
import {
  libraryPlaybackTrack,
  localPlaybackReference,
} from '../services/libraryPlayback';
import { subscribeRuntimeTrackBlacklist } from '../services/trackPlaybackPolicy';
import { musicEntityHistoryKey } from '../services/musicEntityHistory';
import { lastPlayedCollectionTrack, mediaProgressLabel } from '../services/mediaPlaybackProgress';

type LibraryMode = 'music' | 'podcast' | 'audiobook';
type LibraryListPage = 'local' | 'favorites' | 'history' | 'downloads';
const modeInfo: Record<
  LibraryMode,
  { label: string; glyph: string; unit: string }
> = {
  music: { label: '音乐', glyph: '♫', unit: '首' },
  podcast: { label: '播客', glyph: '◉', unit: '集' },
  audiobook: { label: '听书', glyph: '▣', unit: '章' },
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
  const overviewPrewarm = useRef<ReturnType<typeof useVisibleTrackPrewarm> | null>(null);
  const libraryScrollEvent = useStableNativeScrollEvent(
    libraryScrollY,
    event => overviewPrewarm.current?.onScroll(event.nativeEvent),
  );
  const libraryRoot = app.page === 'root';
  useEffect(() => {
    if (libraryRoot) {
      traceRoamBackground('root-scroll-reset-before');
      libraryScrollY.setValue(0);
      traceRoamBackground('root-scroll-reset-after');
    }
  }, [libraryRoot, libraryScrollY]);
  const [storedMode, setMode] = useCatalogViewState<LibraryMode>(
    'library-mode',
    'music',
  );
  const mode = app.page === 'downloads' && app.downloadDestination ? app.downloadDestination.kind : storedMode;
  const downloadViewVersion = useRef(0);
  if (app.page === 'downloads' && app.downloadDestination) downloadViewVersion.current = app.downloadDestination.version;
  useEffect(() => {
    if (app.page === 'downloads' && app.downloadDestination) {
      setMode(app.downloadDestination.kind);
      app.consumeDownloadDestination?.(app.downloadDestination.version);
    }
  // The request is consumed once; ordinary page/tab entries retain stored mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.page, app.downloadDestination, app.consumeDownloadDestination, setMode]);
  const [musicList, setMusicList] = useCatalogViewState<LibraryListPage>(
    'library-music-list',
    'history',
  );
  const [playlistTab, setPlaylistTab] = useCatalogViewState<LibraryPlaylistTab>(
    'library-playlist-tab',
    'curated',
  );
  const playlistPages = useLibraryPlaylists(
    mode === 'music' &&
      playlistTab === 'curated' &&
      !app.startup?.visible &&
      (app.page === 'root' || app.page === 'library-browse'),
  );
  const mediaKind = mode === 'music' ? 'podcast' : mode;
  const mediaEnabled = mode !== 'music' && !app.startup?.visible;
  const mediaCollections = useLibraryMediaPages<CatalogItem>(
    mediaKind,
    'collections',
    mediaEnabled &&
      (app.page === 'root' || app.page === 'library-browse'),
  );
  const collections = mediaCollections.items;
  const [mediaLists, setMediaLists] = useCatalogViewState<
    Record<'podcast' | 'audiobook', LibraryListPage>
  >('library-media-list', { podcast: 'history', audiobook: 'history' });
  const selectedList = mode === 'music' ? musicList : mediaLists[mode];
  const [detailItem, setDetailItem] = useCatalogViewState<CatalogItem | null>(
    'library-detail',
    null,
  );
  const [homeReferenceDetail, setHomeReferenceDetail] = useCatalogViewState(
    'library-detail-home-reference',
    false,
  );
  const [detailResumeKey, setDetailResumeKey] = useCatalogViewState<string | null>(
    'library-detail-resume-key', null,
  );
  const selectDetailItem = (item: CatalogItem, homeReference = false, resume = false) => {
    setDetailResumeKey(resume && mode !== 'music' ? lastPlayedCollectionTrack(app.state, item) : null);
    setDetailItem(
      mode === 'music'
        ? item
        : { ...item, metadata: { ...item.metadata, detailLayout: 'playlist' } },
    );
    setHomeReferenceDetail(homeReference || mode !== 'music');
  };
  const [personalPlaylistId, setPersonalPlaylistId] = useCatalogViewState<string | null>(
    'library-playlist-opened',
    null,
  );
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [createPlaylistTitle, setCreatePlaylistTitle] = useState('');
  const [localScan, setLocalScan] = useState<{
    kind: Exclude<LibraryMode, 'music'>;
    candidates: Track[];
  } | null>(null);
  const supported = new Set<string>(
    mode === 'music'
      ? []
      : mediaProviders(app.recommendationPlatforms, mode, true),
  );
  const allowed = (item: Track | CatalogItem) =>
    mode === 'music' ||
    ('duration' in item &&
      trackMediaKind(item) === mode &&
      Boolean(localPlaybackReference(item))) ||
    (supported.has(item.provider) && !hasExternalMediaOrigin(item));
  const knownTracks = collectKnownTracks(app.state, app.current);
  const favoriteTracks = [
    ...app.state.favorites
      .map(id => findKnownTrack(knownTracks, id, 'music'))
      .filter(Boolean),
    ...app.state.podcastLibrary.favorites
      .map(id => findKnownTrack(knownTracks, id, 'podcast'))
      .filter(Boolean),
    ...app.state.audiobookLibrary.favorites
      .map(id => findKnownTrack(knownTracks, id, 'audiobook'))
      .filter(Boolean),
  ] as Track[];
  const modeTracks = favoriteTracks.filter(
    track => trackMediaKind(track) === mode && allowed(track),
  );
  const modeHistory = mediaHistory(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const modeDownloads = mediaDownloads(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const modeCollections = (
    mode === 'music'
      ? app.state.savedCollections
      : mode === 'podcast'
      ? app.state.podcastLibrary.savedCollections
      : app.state.audiobookLibrary.savedCollections
  ).filter(item => allowed(item));

  const openCollection = (item: CatalogItem, resume = false) => {
    selectDetailItem(item, mode === 'music', resume);
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
    const playlist = app.state.playlists.find(item => item.id === personalPlaylistId);
    if (playlist) {
      const tracksById = new Map(knownTracks.map(track => [track.id, track]));
      return <PersonalPlaylistDetail playlistId={playlist.id} title={playlist.title}
        tracks={playlist.trackIds.flatMap(id => tracksById.get(id) ?? [])}
        fallbackCoverKey={playlist.coverKey} playlistCover={playlist.cover}
        description={playlist.description} onBack={app.back} onDeleted={returnToPlaylistManager} />;
    }
  }
  if (app.page === 'search-playlist')
    return (
      <CollectionDetail
        item={detailItem}
        libraryAppearance
        homeReferenceAppearance={homeReferenceDetail}
        resumeTrackKey={detailResumeKey}
      />
    );
  if (app.page === 'playlists' || app.page === 'personal-playlist')
    return <PersonalPlaylistManager onOpenCollection={openCollection} onOpenPersonalPlaylist={openPersonalPlaylist} />;
  if (app.page === 'library-browse' && mode === 'music')
    return (
      <LibraryPlaylistBrowser
        pages={playlistPages}
        onOpen={item => {
          selectDetailItem(item, true);
          app.open('search-playlist');
        }}
      />
    );
  if (app.page === 'library-browse' && mode !== 'music')
    return (
      <LibraryPlaylistBrowser
        pages={mediaCollections}
        title={mode === 'podcast' ? '推荐播客' : '推荐听书'}
        countLabel={mode === 'podcast' ? '个已加载节目' : '本已加载书籍'}
        emptyText="本次通过检测的平台暂时没有此类内容"
        onOpen={item => {
          selectDetailItem(item);
          app.open('search-playlist');
        }}
      />
    );
  if (['local', 'favorites', 'history', 'downloads'].includes(app.page))
    return (
      <LibraryList
        key={`${app.page}:${app.page === 'downloads' ? downloadViewVersion.current : 0}`}
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
  const summary =
    mode === 'music'
      ? [
          ['history', '', '最近播放', `${modeHistory.length} 首`],
          ['favorites', '', '我的收藏', `${modeTracks.length} 首`],
          ['downloads', '', '下载记录', `${modeDownloads.length} 首`],
          ['local', '', '本地音乐', `${app.state.localTracks.length} 首`],
        ]
      : [
          [
            'history',
            '',
            '最近播放',
            `${modeHistory.length} ${modeInfo[mode].unit}`,
          ],
          [
            'favorites',
            '',
            '我的收藏',
            modeCollections.length
              ? `${modeCollections.length} ${
                  mode === 'podcast' ? '个节目' : '本书'
                } · ${modeTracks.length} ${modeInfo[mode].unit}`
              : `${modeTracks.length} ${modeInfo[mode].unit}`,
          ],
          [
            'downloads',
            '',
            '下载记录',
            `${modeDownloads.length} ${modeInfo[mode].unit}`,
          ],
          [
            'local',
            '',
            mode === 'podcast' ? '本地播客' : '本地听书',
            `${mediaLocalTracks(app.state, mode).length} ${modeInfo[mode].unit}`,
          ],
        ];
  const mediaLocal =
    mode === 'music' ? app.state.localTracks : mediaLocalTracks(app.state, mode);
  const recentMusic = [
    ...new Map(
      [
        ...modeHistory.map(item => item.track),
        ...app.state.localTracks.slice().reverse(),
        ...app.state.downloads.map(item => item.track),
      ]
        .filter(track => trackMediaKind(track) === 'music')
        .map(track => [track.id, track]),
    ).values(),
  ].slice(0, 3);
  const musicTracks =
    mode !== 'music'
      ? selectedList === 'history'
        ? modeHistory.map(entry => entry.track)
        : selectedList === 'favorites'
        ? modeTracks
        : selectedList === 'downloads'
        ? modeDownloads.map(entry => entry.track)
        : mediaLocal
      : musicList === 'history'
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
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        <LibraryTop mode={mode} setMode={setMode} />
        {
          <View testID="library-music-intro" style={s.musicIntro}>
            <Text style={[s.musicIntroTitle, { color: theme.text }]}>
              {mode === 'music'
                ? '在音乐里\n遇见更好的自己'
                : mode === 'podcast'
                ? '在声音里\n遇见更大的世界'
                : '在故事里\n遇见另一种人生'}
            </Text>
            <View style={s.musicIntroFooter}>
              <Text style={[s.musicIntroScript, { color: theme.muted }]}>
                {mode === 'music'
                  ? 'Good\nMusic'
                  : mode === 'podcast'
                  ? 'Good\nPodcast'
                  : 'Good\nBooks'}
              </Text>
              <Text style={[s.musicIntroCopy, { color: theme.muted }]}>
                {mode === 'music'
                  ? '让每一首歌\n陪你度过每一个日常'
                  : mode === 'podcast'
                  ? '让每一期节目\n陪你发现新的日常'
                  : '让每一本好书\n陪你走进新的故事'}
              </Text>
            </View>
          </View>
        }
        {mode === 'music' ? (
          <LibraryPlaylistSection
            tab={playlistTab}
            onTab={setPlaylistTab}
            curated={playlistPages.items}
            mine={[...app.state.playlists, ...linkedPlaylists(app.state)]}
            mineTracks={knownTracks}
            loading={playlistPages.loading}
            error={playlistPages.error}
            onMore={() =>
              playlistTab === 'curated'
                ? openBrowse()
                : app.open('playlists')
            }
            onCreate={() => {
              setCreatePlaylistTitle('');
              setCreatePlaylistOpen(true);
            }}
            onOpenCurated={openCollection}
            onOpenMine={item => 'provider' in item ? openCollection(item) : openPersonalPlaylist(item.id)}
            onLoadMore={() => {
              void playlistPages.loadMore();
            }}
          />
        ) : (
          <LibraryPlaylistSection
            tab="curated"
            onTab={() => undefined}
            curated={collections}
            mine={[]}
            loading={mediaCollections.loading}
            error={mediaCollections.error}
            collectionLabel={mode === 'podcast' ? '推荐播客' : '推荐听书'}
            moreTestID="library-all-collections"
            onMore={openBrowse}
            onCreate={() => undefined}
            onOpenCurated={openCollection}
            onOpenMine={() => undefined}
            onLoadMore={() => {
              void mediaCollections.loadMore(10);
            }}
          />
        )}
        <View key={mode} testID="library-summary-cards" style={s.musicListTabs}>
          {summary.map(item => (
            <Pressable
              key={item[0]}
              testID={`library-summary-${item[0]}`}
              accessibilityLabel={item[2]}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedList === item[0] }}
              onPress={() =>
                mode === 'music'
                  ? setMusicList(item[0] as LibraryListPage)
                  : setMediaLists(previous => ({
                      ...previous,
                      [mode]: item[0] as LibraryListPage,
                    }))
              }
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
              enabled={mode === 'music' && (selectedList === 'history' || selectedList === 'favorites')}
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
                  showPlaylist={mode === 'music'}
                  showProvider={mode === 'music'}
                  onDownload={
                    mode !== 'music'
                      ? (value, resolved) =>
                          app.downloadTrack(value, { useLaunchBinding: true, resolved })
                      : undefined
                  }
                  onPlay={() =>
                    playLibraryTrack(
                      app,
                      track,
                      musicTracks,
                      selectedList === 'downloads' || selectedList === 'local',
                      undefined,
                      selectedList === 'history' && mode !== 'music'
                        ? modeHistory.find(entry => trackQueueKey(entry.track) === trackQueueKey(track))
                        : undefined,
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
                  downloadStatus={selectedList === 'downloads'
                    ? downloadRowStatus(modeDownloads, app.downloadActivities ?? [], track)
                    : undefined}
                  subtitle={
                    selectedList === 'history' && mode !== 'music'
                      ? `${track.artist} · ${mediaProgressLabel(modeHistory.find(entry =>
                          trackQueueKey(entry.track) === trackQueueKey(track)), app.player, app.current)}`
                      : undefined
                  }
                />
              ))}
              {mode !== 'music' && selectedList === 'favorites'
                ? modeCollections
                    .slice(0, Math.max(0, 3 - musicTracks.length))
                    .map(item => (
                      <CatalogRow
                        key={collectionFavoriteKey(item)}
                        item={item}
                        accent={accent}
                        onPress={() => openCollection(item, true)}
                      />
                    ))
                : null}
              {!musicTracks.length &&
              !(
                mode !== 'music' &&
                selectedList === 'favorites' &&
                modeCollections.length
              ) ? (
                <>
                  <Empty
                    text={
                      selectedList === 'history'
                        ? '还没有播放记录'
                        : selectedList === 'favorites'
                        ? '这里还没有记录'
                        : selectedList === 'downloads'
                        ? '暂无下载记录'
                        : mode === 'music'
                        ? '暂无本地音乐'
                        : mode === 'podcast'
                        ? '暂无本地播客'
                        : '暂无本地听书'
                    }
                    accent={accent}
                  />
                  {selectedList === 'local' ? (
                    <View style={s.localActions}>
                      <Pressable
                        testID="library-add-local"
                        onPress={() =>
                          (mode === 'music'
                            ? app.addLocalMusicDirectory()
                            : app.addLocalMediaDirectory(mode)
                          ).catch(() => undefined)
                        }
                        style={[s.primaryButton, s.localActionButton]}
                      >
                        <Text style={s.primaryButtonText}>
                          {mode === 'music' ? '添加本地音乐' : `添加本地${modeInfo[mode].label}`}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID="library-scan-local"
                        onPress={() => {
                          if (mode === 'music') {
                            app.scanLocalMusic().catch(() => undefined);
                            return;
                          }
                          app.scanLocalMedia(mode)
                            .then(candidates => setLocalScan({ kind: mode, candidates }))
                            .catch(error => app.notify(error instanceof Error ? error.message : '扫描失败'));
                        }}
                        style={[s.secondaryButton, s.localActionButton]}
                      >
                        <Text style={s.secondaryButtonText}>
                          {mode === 'music' ? '扫描本地音乐' : `扫描本地${modeInfo[mode].label}`}
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
      {localScan ? (
        <LocalMediaScanPicker
          kind={localScan.kind}
          candidates={localScan.candidates}
          onClose={() => setLocalScan(null)}
          onConfirm={selected => {
            app.addLocalMediaTracks(localScan.kind, selected);
            setLocalScan(null);
          }}
        />
      ) : null}
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

function LibraryTop({
  mode,
  setMode,
}: {
  mode: LibraryMode;
  setMode: (mode: LibraryMode) => void;
}) {
  const s = useLibraryStyles();
  const theme = useTheme();
  return (
    <>
      <View testID="library-header" style={s.libraryTopRow}>
        <Text style={[s.pageTitle, { color: theme.text }]}>漫游</Text>
      </View>
      <View testID="library-mode-tabs" style={s.modeTabs}>
        {(Object.keys(modeInfo) as LibraryMode[]).map(item => (
          <Pressable
            key={item}
            testID={`library-mode-${item}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            onPress={() => setMode(item)}
            style={s.modeTab}
          >
            <Text
              style={[
                s.modeTabText,
                { color: mode === item ? theme.text : theme.muted },
              ]}
            >
              {modeInfo[item].label}
            </Text>
            {mode === item ? (
              <View
                style={[s.modeIndicator, { backgroundColor: theme.accent }]}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
    </>
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

function downloadRowStatus(entries: ReturnType<typeof mediaDownloads>, activities: DownloadActivity[], track: Track) {
  const key = downloadTrackKey(track);
  const entry = entries.find(item => downloadTrackKey(item.track) === key);
  return entry ? downloadStatusText(entry, activities.find(item => downloadTrackKey(item.track) === key)) : undefined;
}
function downloadRowProgress(activities: DownloadActivity[], track: Track) {
  const activity = activities.find(item => downloadTrackKey(item.track) === downloadTrackKey(track));
  if (!activity || !['queued', 'downloading'].includes(activity.phase) || !activity.totalBytes) return undefined;
  return Math.max(0, Math.min(0.99, (activity.bytesDownloaded ?? 0) / activity.totalBytes));
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
        playLibraryTrack(app, props.track, props.tracks, props.requireLocal, undefined, props.resumeEntry)
      }
      showDownload={!props.requireLocal}
      showPlaylist={mode === 'music'}
      showProvider={mode === 'music'}
      onDownload={
        mode !== 'music'
          ? (track, resolved) => app.downloadTrack(track, { useLaunchBinding: true, resolved })
          : undefined
      }
      unavailableReason={libraryReason(app, props.track, props.requireLocal)}
      onDelete={props.onDelete}
    />
  );
}

function LibraryOverviewTracks({ tracks, identity, enabled, metricsRef, testID, style, children }: {
  tracks: Track[]; identity: string; enabled: boolean;
  metricsRef: React.MutableRefObject<ReturnType<typeof useVisibleTrackPrewarm> | null>;
  testID: string; style: React.ComponentProps<typeof View>['style']; children: React.ReactNode;
}) {
  const app = useApp();
  const visible = useVisibleTrackPrewarm({
    identity: `library-overview:${identity}:${app.prewarmContextKey ?? app.state.settings.quality}`,
    enabled: enabled && app.tab === 'library' && app.page === 'root',
    tracks: tracks.map(track => libraryPlaybackTrack(track, app.state)),
    prewarm: app.prewarmDetailTracks, release: app.releaseDetailPrewarm,
  });
  metricsRef.current = visible;
  useEffect(() => () => { metricsRef.current = null; }, [metricsRef]);
  return <View testID={testID} style={style} onLayout={visible.onListLayout}>
    {React.Children.map(children, (child, index) => {
      const track = tracks[index];
      return !track ? child : visible.failedKeys.has(trackQueueKey(track)) ? null :
        <View onLayout={event => visible.onRowLayout(trackQueueKey(track), event)}>{child}</View>;
    })}
  </View>;
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
  const defaultFilter =
    page === 'history' && mode === 'music' ? 'track' : 'all';
  const musicDownloads = page === 'downloads' && mode === 'music';
  const recentMusicHistory = page === 'history';
  const [recordFilters, setRecordFilters] = useCatalogViewState<Record<string, string>>('library-record-filters', {});
  const filterKey = `${mode}:${page}`;
  const selectedFilter = recordFilters[filterKey] ?? defaultFilter;
  const setFilter = (next: string) => setRecordFilters({ ...recordFilters, [filterKey]: next });
  const filter = musicDownloads ? 'all' : selectedFilter;
  const [deleteTrack, setDeleteTrack] = useState<Track | null>(null);
  const supported = new Set<string>(
    mode === 'music'
      ? []
      : mediaProviders(app.recommendationPlatforms, mode, true),
  );
  const allowed = (item: Track | CatalogItem) =>
    mode === 'music' ||
    ('duration' in item &&
      trackMediaKind(item) === mode &&
      Boolean(localPlaybackReference(item))) ||
    (supported.has(item.provider) && !hasExternalMediaOrigin(item));
  const knownTracks = collectKnownTracks(app.state, app.current);
  const favoriteTracks = [
    ...app.state.favorites
      .map(id => findKnownTrack(knownTracks, id, 'music'))
      .filter(Boolean),
    ...app.state.podcastLibrary.favorites
      .map(id => findKnownTrack(knownTracks, id, 'podcast'))
      .filter(Boolean),
    ...app.state.audiobookLibrary.favorites
      .map(id => findKnownTrack(knownTracks, id, 'audiobook'))
      .filter(Boolean),
  ] as Track[];
  const tracks = favoriteTracks.filter(
    track => trackMediaKind(track) === mode && allowed(track),
  );
  const savedCollections = (
    mode === 'music'
      ? app.state.savedCollections
      : mode === 'podcast'
      ? app.state.podcastLibrary.savedCollections
      : app.state.audiobookLibrary.savedCollections
  ).filter(item => allowed(item));
  const favoriteKeys =
    mode === 'music'
      ? app.state.favoriteCollections
      : mode === 'podcast'
      ? app.state.podcastLibrary.favoriteCollections
      : app.state.audiobookLibrary.favoriteCollections;
  const collections = savedCollections.filter(item => {
    if (!favoriteKeys.includes(collectionFavoriteKey(item))) return false;
    if (mode !== 'music') return true;
    const type = collectionEntityKind(item);
    return filter === 'artist'
      ? type === 'artist'
      : filter === 'album'
      ? type === 'album'
      : type !== 'artist' && type !== 'album';
  });
  const history = mediaHistory(app.state, mode).filter(entry =>
    allowed(entry.track),
  );
  const persistedDownloads = mediaDownloads(app.state, mode);
  const downloadEntries = page === 'downloads' ? downloadRecordRows(persistedDownloads, app.downloadActivities ?? [], mode) : persistedDownloads;
  const downloads = downloadEntries.filter(entry =>
    allowed(entry.track),
  );
  const sizeRequestKey = page === 'downloads' ? persistedDownloads.filter(entry => entry.status === 'downloaded' && !entry.fileSize).map(entry => entry.id).join('|') : '';
  useEffect(() => {
    if (page === 'downloads') void app.refreshDownloadFileSizes?.(persistedDownloads).catch(() => undefined);
  // Progress ticks must not restart old-record file queries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, mode, sizeRequestKey, app.refreshDownloadFileSizes]);
  const accent = theme.accent;
  const title =
    page === 'favorites'
      ? '我的收藏'
      : page === 'history'
      ? mode === 'music'
        ? '最近播放'
        : '最近播放'
      : '下载记录';
  const tabs =
    page === 'favorites'
      ? mode === 'music'
        ? [
            ['all', '歌曲'],
            ['collection', '歌单'],
            ['album', '专辑'],
            ['artist', '歌手'],
          ]
        : mode === 'podcast'
        ? [
            ['all', '全部'],
            ['collection', '节目'],
            ['track', '单集'],
          ]
        : [
            ['all', '全部'],
            ['collection', '书籍'],
            ['track', '章节'],
          ]
      : page === 'history'
      ? mode === 'music'
        ? [
            ['track', '歌曲'],
            ['collection', '歌单'],
            ['album', '专辑'],
            ['artist', '歌手'],
          ]
        : mode === 'podcast'
        ? [
            ['all', '全部'],
            ['completed', '已播完'],
            ['unfinished', '未播完'],
          ]
        : [
            ['all', '全部'],
            ['unfinished', '正在听'],
            ['completed', '已听完'],
          ]
      : mode === 'music'
      ? []
      : [
          ['all', '全部'],
          ['collection', mode === 'podcast' ? '节目' : '书籍'],
          ['track', mode === 'podcast' ? '单集' : '章节'],
        ];
  const historyTracks = history
    .filter(entry =>
      mode === 'music'
        ? true
        : filter === 'all' ||
          (filter === 'completed'
            ? entry.completed
            : filter === 'unfinished'
            ? !entry.completed
            : true),
    )
    .map(entry => entry.track);
  const downloadTracks = downloads.map(entry => entry.track);
  const showCollections =
    page === 'favorites' &&
    (filter === 'collection' ||
      (mode === 'music' && (filter === 'artist' || filter === 'album')) ||
      (filter === 'all' && mode !== 'music'));
  const showHistoryEntities =
    page === 'history' && mode === 'music' && filter !== 'track';
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
  const grouped =
    page !== 'favorites' &&
    mode !== 'music' &&
    (filter === 'album' ||
      filter === 'artist' ||
      (filter === 'collection' && page === 'downloads'))
      ? groupTracks(baseTracks, filter === 'artist' ? 'artist' : 'album')
      : [];
  const showEntityContent =
    showCollections || grouped.length > 0 || recentEntities.length > 0;
  const trackRows =
    filter === 'collection' || filter === 'album' || filter === 'artist'
      ? []
      : baseTracks;
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
    identity: `records:${page}:${mode}:${filter}:${app.prewarmContextKey ?? app.state.settings.quality}:${app.pageRefreshToken ?? 0}`,
    enabled: app.tab === 'library' && app.page === page && mode === 'music' &&
      (page === 'history' || page === 'favorites') && !showCollections && !showHistoryEntities,
    tracks: trackRows.slice(0, pagination.visibleCount).map(track => libraryPlaybackTrack(track, app.state)),
    nestedList: true, prewarm: app.prewarmDetailTracks, release: app.releaseDetailPrewarm,
  });
  if (page === 'local' && mode !== 'music') return <LocalMedia kind={mode} />;
  if (page === 'local') return <LocalMusic />;
  const visibleTracks = trackRows.slice(0, pagination.visibleCount).filter(track => !visiblePrewarm.failedKeys.has(trackQueueKey(track)));
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
    : mode !== 'music' && (collectionRows.length || grouped.length)
    ? `${collectionRows.length + grouped.length} ${
        mode === 'podcast' ? '个节目' : '本书'
      }${
        trackRows.length ? ` · ${trackRows.length} ${modeInfo[mode].unit}` : ''
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
      (history.length ||
        (mode === 'music' && app.state.musicEntityHistory?.length)) ? (
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
      <View testID="library-record-track-list" onLayout={visiblePrewarm.onListContainerLayout} style={{ marginHorizontal: 18 }}>
        {visibleTracks.map((track, index) => (
          <View key={`${track.id}-${index}`} testID={`library-record-prewarm-${trackQueueKey(track)}`} onLayout={event => visiblePrewarm.onRowLayout(trackQueueKey(track), event)}>
          <LibraryListTrack
            key={`${track.id}-${index}`}
            mode={mode}
            track={track}
            tracks={baseTracks}
            index={index}
            accent={accent}
            resumeEntry={page === 'history' && mode !== 'music'
              ? history.find(entry => trackQueueKey(entry.track) === trackQueueKey(track))
              : undefined}
            subtitle={
              page === 'history' && mode !== 'music'
                ? `${track.artist} · ${mediaProgressLabel(history.find(entry =>
                    trackQueueKey(entry.track) === trackQueueKey(track)), app.player, app.current)}`
                : undefined
            }
            downloadStatus={page === 'downloads' ? downloadRowStatus(downloads, app.downloadActivities ?? [], track) : undefined}
            downloadProgress={page === 'downloads' ? downloadRowProgress(app.downloadActivities ?? [], track) : undefined}
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
        identity={
          mode === 'music' ? undefined : `recent-playback-detail:${mode}`
        }
        title={title}
        count={count}
        cover={headerCover}
        coverCandidates={headerCoverCandidates}
        coverKey={headerCoverKey}
        actions={actions}
        filters={filters}
        onScrollOffset={mode === 'music' ? traceRoamHistoryScroll : undefined}
        onLayout={visiblePrewarm.onLayout}
        onControlsLayout={visiblePrewarm.onControlsLayout}
        onTrackListLayout={visiblePrewarm.onListLayout}
        onScroll={event => { pagination.onScroll(event); visiblePrewarm.onScroll(event.nativeEvent); }}
      >
        {content}
      </RecentPlaybackDetail>
    );
  if (mode !== 'music')
    return (
      <>
        <HomePlaylistDetail
          identity={`library-list:${page}:${mode}`}
          title={title}
          subtitle={count}
          cover={headerCover}
          coverCandidates={headerCoverCandidates}
          coverKey={headerCoverKey}
          libraryArtwork
          insetList
          onBack={app.back}
          scrollTestID={`library-${page}`}
          controlsTestID="library-list-controls"
          actions={actions}
          filters={filters}
          onScroll={pagination.onScroll}
        >
          {content}
        </HomePlaylistDetail>
        {page === 'downloads' && deleteTrack ? (
          <TrackDeleteModal
            track={deleteTrack}
            kind="download"
            onClose={() => setDeleteTrack(null)}
          />
        ) : null}
      </>
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
  const musicDownloads = page === 'downloads' && mode === 'music';
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
          showTopGradient={false}
          onColorChange={setDetailColor}
        />
        <View
          testID="library-list-controls"
          onLayout={event => { scrollGradient.onStickyLayout(event); visiblePrewarm?.onControlsLayout(event); }}
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
          showTopGradient={false}
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
              showDownload={false}
              showFavorite={false}
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
                showDownload={false}
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

function LocalMedia({ kind }: { kind: Exclude<LibraryMode, 'music'> }) {
  const s = useLibraryStyles();
  const app = useApp();
  const layout = useLayout();
  const theme = useTheme();
  const tracks = mediaLocalTracks(app.state, kind);
  const pagination = useLibraryRecordPages(`local:${kind}`, tracks.length);
  const [detailColor, setDetailColor] = useState(theme.bg);
  const scrollGradient = usePlaylistDetailScrollGradient(`library-list:local:${kind}`);
  const [deleteTrack, setDeleteTrack] = useState<Track | null>(null);
  const [deleteAllTracks, setDeleteAllTracks] = useState<Track[] | null>(null);
  const [scanCandidates, setScanCandidates] = useState<Track[] | null>(null);
  const refreshArtwork = app.refreshLocalMediaArtwork;
  useEffect(() => {
    refreshArtwork?.(kind).catch(() => undefined);
  }, [refreshArtwork, kind]);
  const label = kind === 'podcast' ? '播客' : '听书';
  const visibleTracks = tracks.slice(0, pagination.visibleCount);
  return (
    <View style={s.detailRoot}>
      <PlaylistDetailGradientViewport stuck={scrollGradient.stuck} />
      <LibraryDetailScrollView
        testID={`library-local-${kind}`}
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
          title={`本地${label}`}
          count={`${tracks.length} ${modeInfo[kind].unit}`}
          cover={tracks[0]?.cover}
          coverKey={tracks[0]?.coverKey}
          coverCandidates={tracks[0] ? trackCoverCandidates(tracks[0]) : []}
          description={`扫描手机内的${label}文件`}
          showTopGradient={false}
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
              showDownload={false}
              showFavorite={false}
              onDeleteAllLocal={() => setDeleteAllTracks([...tracks])}
              deleteAllDisabled={!tracks.length}
              mediaKind={kind}
              surfaceColor="transparent"
              contentInset={12}
              sticky
              onScanLocal={() => {
                app
                  .scanLocalMedia(kind)
                  .then(candidates => setScanCandidates(candidates))
                  .catch(error =>
                    app.notify(error instanceof Error ? error.message : '扫描失败'),
                  );
              }}
              onAddLocal={() =>
                app.addLocalMediaDirectory(kind).catch(error =>
                  app.notify(error instanceof Error ? error.message : '添加失败'),
                )
              }
            />
          </LibraryReferenceActions>
        </View>
        {visibleTracks.length ? (
          <View>
            {visibleTracks.map(track => (
              <LibraryMusicTrackRow
                key={track.id}
                track={track}
                onPlay={() => playLibraryTrack(app, track, tracks, true)}
                showDownload={false}
                showPlaylist={false}
                showProvider={false}
                unavailableReason={libraryReason(app, track, true)}
                onDelete={() => setDeleteTrack(track)}
              />
            ))}
          </View>
        ) : (
          <View style={s.localEmpty}>
            <View style={s.localFolder}>
              <Text style={s.localFolderGlyph}>{modeInfo[kind].glyph}</Text>
            </View>
            <Text style={s.emptyTitle}>暂无本地{label}</Text>
            <Text style={s.emptyText}>
              可以扫描设备中的{label}文件{`\n`}手动选择添加到本地{label}
            </Text>
          </View>
        )}
      </LibraryDetailScrollView>
      {deleteTrack ? (
        <TrackDeleteModal
          track={deleteTrack}
          kind="local"
          mediaKind={kind}
          onClose={() => setDeleteTrack(null)}
        />
      ) : null}
      {deleteAllTracks?.length ? (
        <TrackDeleteModal
          track={deleteAllTracks[0]!}
          tracks={deleteAllTracks}
          kind="local"
          mediaKind={kind}
          onClose={() => setDeleteAllTracks(null)}
        />
      ) : null}
      {scanCandidates ? (
        <LocalMediaScanPicker
          kind={kind}
          candidates={scanCandidates}
          onClose={() => setScanCandidates(null)}
          onConfirm={selected => {
            app.addLocalMediaTracks(kind, selected);
            setScanCandidates(null);
          }}
        />
      ) : null}
    </View>
  );
}

function LocalMediaScanPicker({
  kind,
  candidates,
  onClose,
  onConfirm,
}: {
  kind: Exclude<LibraryMode, 'music'>;
  candidates: Track[];
  onClose: () => void;
  onConfirm: (tracks: Track[]) => void;
}) {
  const s = useLibraryStyles();
  const theme = useTheme();
  const label = kind === 'podcast' ? '播客' : '听书';
  const [selected, setSelected] = useState(() => new Set<string>());
  const toggle = (track: Track) =>
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(track.id)) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.editorBackdrop}>
        <View
          testID={`local-media-scan-picker-${kind}`}
          style={[s.editorCard, { backgroundColor: theme.panel, maxHeight: '82%' }]}
        >
          <Text style={[s.emptyTitle, { color: theme.text }]}>
            选择本地{label}
          </Text>
          <Text style={[s.deleteDialogCopy, { color: theme.muted }]}>
            已扫描 {candidates.length} 个音频文件，请手动勾选要加入的内容。
          </Text>
          <ScrollView style={{ width: '100%', marginTop: 10 }}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {candidates.map(track => {
              const checked = selected.has(track.id);
              return (
                <Pressable
                  key={track.id}
                  testID={`local-media-candidate-${track.id}`}
                  onPress={() => toggle(track)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.line,
                  }}
                >
                  <Text style={{ color: checked ? theme.accent : theme.muted, fontSize: 22, width: 30 }}>
                    {checked ? '☑' : '□'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
                      {track.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
                      {track.artist} · {Math.round(track.duration)} 秒
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            testID="local-media-select-all"
            onPress={() =>
              setSelected(
                selected.size === candidates.length
                  ? new Set()
                  : new Set(candidates.map(track => track.id)),
              )
            }
            style={s.editorCancel}
          >
            <Text style={[s.selectionText, { color: theme.accent }]}>全选 / 取消全选</Text>
          </Pressable>
          <Pressable
            testID="local-media-confirm"
            disabled={!selected.size}
            onPress={() =>
              onConfirm(candidates.filter(track => selected.has(track.id)))
            }
            style={[
              s.primaryButton,
              { backgroundColor: theme.accent },
              !selected.size && { opacity: 0.45 },
            ]}
          >
            <Text style={s.primaryButtonText}>添加已选（{selected.size}）</Text>
          </Pressable>
          <Pressable testID="local-media-cancel" onPress={onClose} style={s.editorCancel}>
            <Text style={[s.selectionText, { color: theme.accent }]}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
        <TrackActionIcon kind="favorite" active={app.isCollectionFavorite(item)} color={accent} size={22} />
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
  const deleteLocal = async (removeFromPlaylists: boolean, deleteFile = false) => {
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
    const targets = tracks.filter(item => current.some(value =>
      trackQueueKey(value) === trackQueueKey(item) &&
      localPlaybackReference(value) === localPlaybackReference(item),
    ));
    let removed = 0;
    let failed = 0;
    for (const item of targets) {
      try {
        await (mediaKind === 'music'
          ? app.removeLocalTrack(item.id, removeFromPlaylists, deleteFile)
          : app.removeLocalTrack(item.id, false, deleteFile, mediaKind));
        removed += 1;
      } catch (error) {
        if ((error as { code?: string })?.code === 'DELETE_FILE_CANCELLED')
          throw new Error(`已取消删除，已移除 ${removed} 条记录，其余记录保留`);
        failed += 1;
      }
    }
    if (failed) throw new Error(`已移除 ${removed} 条记录，${failed} 条删除失败，记录仍保留`);
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
            {tracks ? `全部删除本地${modeInfo[mediaKind].label}（${tracks.length} 条）` : `删除“${track.title}”`}
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
                  : () =>
                      trackMediaKind(track) === 'music'
                        ? app.removeDownload(track.id, false)
                        : app.removeDownload(
                            track.id,
                            false,
                            trackMediaKind(track),
                          ),
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
                  : () =>
                      trackMediaKind(track) === 'music'
                        ? app.removeDownload(track.id, true)
                        : app.removeDownload(
                            track.id,
                            true,
                            trackMediaKind(track),
                          ),
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
  entry: Extract<MusicEntityHistoryEntry, { playlistId: string }>;
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
  group: { name: string; tracks: Track[] };
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
