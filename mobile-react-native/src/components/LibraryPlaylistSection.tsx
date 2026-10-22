import React, { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { covers } from '../assets/covers';
import type { CatalogItem, Playlist, Track } from '../domain/types';
import { trackCoverCandidates } from '../services/onlineCatalog';
import { collectionMediaKind } from '../services/mediaLibrary';
import { useTheme } from '../theme';
import { ResilientHomeCover } from './ResilientHomeCover';

export type LibraryPlaylistTab = 'curated' | 'mine';
// Consume long holds so release cannot become an ordinary open tap.
const ignoreLongPress = () => {};
export function LibraryPlaylistCard({
  item,
  onPress,
  suppressLongPress = false,
  cardTestID,
  coverTrack,
}: {
  item: CatalogItem | Playlist;
  onPress: () => void;
  suppressLongPress?: boolean;
  cardTestID?: string;
  coverTrack?: Track;
}) {
  const c = useTheme();
  const online = 'provider' in item;
  const unit =
    online && collectionMediaKind(item) !== 'music'
      ? collectionMediaKind(item) === 'podcast'
        ? '集'
        : '章'
      : '首';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开 ${item.title}`}
      testID={
        cardTestID ??
        `library-playlist-card-${online ? `${item.provider}:` : ''}${item.id}`
      }
      onPress={onPress}
      onLongPress={suppressLongPress ? ignoreLongPress : undefined}
      style={s.card}
    >
      <ResilientHomeCover
        uri={online ? item.cover : item.cover ?? coverTrack?.cover}
        uris={
          online
            ? item.coverCandidates
            : item.cover ? [item.cover] : coverTrack
            ? trackCoverCandidates(coverTrack)
            : undefined
        }
        fallback={
          covers[online ? 'vinyl' : coverTrack?.coverKey ?? item.coverKey]
        }
        testID="library-playlist-card-cover"
        clipToImageStyle
        style={s.cover}
        imageStyle={s.radius}
      />
      <View style={s.copy}>
        <Text numberOfLines={1} style={[s.title, { color: c.text }]}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={[s.count, { color: c.muted }]}>
          {online
            ? item.trackCount === undefined
              ? item.description
              : `${item.trackCount} ${unit}`
            : `${item.trackIds.length} 首`}
        </Text>
      </View>
    </Pressable>
  );
}
export function LibraryPlaylistSection({
  tab,
  onTab,
  curated,
  mine,
  mineTracks = [],
  loading,
  error,
  onMore,
  onCreate,
  onOpenCurated,
  onOpenMine,
  onLoadMore,
  collectionLabel,
  moreTestID = 'library-playlists-more',
}: {
  tab: LibraryPlaylistTab;
  onTab: (tab: LibraryPlaylistTab) => void;
  curated: CatalogItem[];
  mine: (Playlist | CatalogItem)[];
  mineTracks?: Track[];
  loading: boolean;
  error: string;
  onMore: () => void;
  onCreate: () => void;
  onOpenCurated: (item: CatalogItem) => void;
  onOpenMine: (item: Playlist | CatalogItem) => void;
  onLoadMore: () => void;
  collectionLabel?: string;
  moreTestID?: string;
}) {
  const c = useTheme();
  const gesture = useRef({ dragging: false, start: 0, triggered: false });
  return (
    <View testID="library-playlist-section">
      <View style={s.header}>
        <View style={s.tabs} testID="library-playlist-tabs">
          {(collectionLabel
            ? (['curated'] as const)
            : (['curated', 'mine'] as const)
          ).map(value => (
            <Pressable
              key={value}
              testID={`library-playlist-tab-${value}`}
              accessibilityRole="tab"
              accessibilityLabel={
                value === 'curated' ? collectionLabel ?? '精选歌单' : '我的歌单'
              }
              accessibilityState={{ selected: value === tab }}
              onPress={() => onTab(value)}
              style={s.tab}
            >
              <Text
                style={[s.tabText, { color: value === tab ? c.text : c.muted }]}
              >
                {value === 'curated'
                  ? collectionLabel ?? '精选歌单'
                  : '我的歌单'}
              </Text>
              {value === tab ? (
                <View style={[s.indicator, { backgroundColor: c.blue }]} />
              ) : null}
            </Pressable>
          ))}
        </View>
        <Pressable
          testID={moreTestID}
          accessibilityRole="button"
          onPress={onMore}
          style={s.more}
        >
          <Text style={[s.moreText, { color: c.blue }]}>查看更多 ›</Text>
        </Pressable>
      </View>
      <ScrollView
        key={tab}
        testID="library-curated-playlists"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.rail}
        scrollEventThrottle={16}
        onScrollBeginDrag={({ nativeEvent }) => {
          gesture.current = {
            dragging: true,
            start: nativeEvent.contentOffset.x,
            triggered: false,
          };
        }}
        onScrollEndDrag={() => {
          gesture.current.dragging = false;
        }}
        onScroll={({ nativeEvent }) => {
          if (
            tab === 'curated' &&
            gesture.current.dragging &&
            !gesture.current.triggered &&
            nativeEvent.contentOffset.x > gesture.current.start
          ) {
            gesture.current.triggered = true;
            onLoadMore();
          }
        }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'curated' ? (
          curated.map(item => (
            <LibraryPlaylistCard
              key={`${item.provider}:${item.id}`}
              item={item}
              onPress={() => onOpenCurated(item)}
            />
          ))
        ) : (
          <>
            <Pressable
              testID="create-playlist-button"
              accessibilityRole="button"
              accessibilityLabel="新建歌单"
              onPress={onCreate}
              style={[s.card, s.create]}
            >
              <Text style={[s.plus, { color: c.blue }]}>＋</Text>
              <Text style={[s.title, { color: c.blue }]}>新建歌单</Text>
            </Pressable>
            {mine.map(item => (
              <LibraryPlaylistCard
                key={'provider' in item ? `${item.provider}:${item.id}` : item.id}
                item={item}
                coverTrack={mineTracks.find(
                  track => !('provider' in item) && track.id === item.trackIds[0],
                )}
                suppressLongPress
                onPress={() => onOpenMine(item)}
              />
            ))}
          </>
        )}
      </ScrollView>
      {tab === 'curated' && error ? (
        <Pressable testID="library-playlists-retry" onPress={onLoadMore}>
          <Text style={[s.empty, { color: c.muted }]}>{error}，点击重试</Text>
        </Pressable>
      ) : null}
      {tab === 'curated' && !curated.length && !loading && !error ? (
        <Text style={[s.empty, { color: c.muted }]}>
          {collectionLabel
            ? `本次通过检测的平台暂无${collectionLabel}`
            : '本次通过检测的平台暂无精选歌单'}
        </Text>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 8,
  },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  tab: { minHeight: 44, justifyContent: 'center' },
  tabText: { fontSize: 20, fontWeight: '500' },
  indicator: {
    position: 'absolute',
    bottom: 2,
    width: 24,
    height: 2,
    borderRadius: 1,
  },
  more: { minHeight: 44, justifyContent: 'center', paddingRight: 12 },
  moreText: { fontSize: 12 },
  rail: { gap: 10, paddingRight: 18 },
  card: {
    width: 92,
    height: 82,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  cover: { width: 92, height: 50 },
  radius: { borderRadius: 12 },
  copy: { paddingHorizontal: 8, paddingTop: 5 },
  title: { fontSize: 10, fontWeight: '500' },
  count: { fontSize: 8, marginTop: 2 },
  create: { alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, lineHeight: 38 },
  empty: { fontSize: 12, lineHeight: 18, paddingVertical: 12 },
});
