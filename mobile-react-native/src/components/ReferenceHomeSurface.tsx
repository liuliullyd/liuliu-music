import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { referenceArtwork } from '../assets/reference';
import type { CatalogItem } from '../domain/types';
import type { HomeScenePlaylist } from '../services/homeScenePlaylists';
import { PlayPauseIcon } from './UI';
import { ResilientHomeCover } from './ResilientHomeCover';
import { StickyPressable } from './StickyPressable';
import { serif, useTheme } from '../theme';

export interface ReferenceHomeSurfaceProps {
  playlists: CatalogItem[];
  scenePlaylists: HomeScenePlaylist[];
  onOpenPlaylist: (item: CatalogItem) => void;
  onViewAllPlaylists: () => void;
  onRefreshRecommendations: () => void;
  onPlaylistDragStart?: (x: number) => void;
  onPlaylistScroll?: (event: { contentOffset: { x: number } }) => void;
  playlistSection?: 'scenes' | 'mine';
  onPlaylistSectionChange?: (section: 'scenes' | 'mine') => void;
}

export function ReferenceHomeSurface({
  playlists,
  scenePlaylists,
  onOpenPlaylist,
  onViewAllPlaylists,
  onRefreshRecommendations,
  onPlaylistDragStart,
  onPlaylistScroll,
  playlistSection = 'scenes',
  onPlaylistSectionChange,
}: ReferenceHomeSurfaceProps) {
  const theme = useTheme();
  // Keep the existing Home collection cursor visible in full. The rail still
  // starts with the reference card hierarchy, while later 6-item pages remain
  // reachable after the existing horizontal pagination callback fires.
  const recommendationItems = playlists;
  return (
    <View
      testID="reference-home-surface"
      style={[s.surface, !scenePlaylists.length && s.emptyScenes]}
    >
      {recommendationItems.length ? (
        <>
          <SectionHeader
            title="为你推荐"
            action="refresh"
            onPress={onRefreshRecommendations}
          />
          <ScrollView
            testID="home-playlist-rail"
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={200}
            onScrollBeginDrag={({ nativeEvent }) =>
              onPlaylistDragStart?.(nativeEvent.contentOffset.x)
            }
            onScroll={({ nativeEvent }) => onPlaylistScroll?.(nativeEvent)}
            contentContainerStyle={s.recommendRail}
            showsVerticalScrollIndicator={false}
          >
            {recommendationItems.map((item, index) => (
              <Pressable
                key={`${item.provider}:${item.id}`}
                testID="home-playlist-card"
                accessibilityRole="button"
                accessibilityLabel={`打开歌单 ${item.title}`}
                onPress={() => onOpenPlaylist(item)}
                style={index === 0 ? s.featuredCard : s.smallCard}
              >
                <ResilientHomeCover
                  uri={item.cover}
                  uris={item.coverCandidates}
                  fallback={
                    index === 0
                      ? referenceArtwork.recommendations.large
                      : index % 2
                      ? referenceArtwork.recommendations.plant
                      : referenceArtwork.recommendations.city
                  }
                  testID={`reference-home-recommendation-cover-${index}`}
                  moduleKey={`reference-home-recommendation-${item.provider}:${item.id}`}
                  style={StyleSheet.absoluteFill}
                  imageStyle={index === 0 ? s.featuredRadius : s.smallRadius}
                  clipToImageStyle
                  resizeMethod="resize"
                />
                <View style={s.recommendShade} />
                <View style={s.recommendCopy}>
                  <Text numberOfLines={1} style={s.recommendTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={s.recommendSub}>
                    {item.description || '精选音乐陪你度过日常'}
                  </Text>
                </View>
                <View
                  style={[s.recommendPlay, { backgroundColor: theme.panel }]}
                >
                  <PlayPauseIcon playing={false} color={theme.text} size={14} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
      {scenePlaylists.length || onPlaylistSectionChange ? (
        <SectionHeader
          title="场景歌单"
          action="all"
          onPress={onViewAllPlaylists}
          playlistSection={playlistSection}
          onPlaylistSectionChange={onPlaylistSectionChange}
        />
      ) : null}
    </View>
  );
}

export function ReferenceHomeScenes({
  scenePlaylists,
  onOpenScenePlaylist,
}: {
  scenePlaylists: HomeScenePlaylist[];
  onOpenScenePlaylist: (item: CatalogItem) => void;
}) {
  return <ReferenceHomePlaylistRail cards={scenePlaylists.map(scene => ({
    key: `${scene.item?.provider ?? 'pending'}:${scene.item?.id ?? scene.sceneId}:${scene.sceneId}`,
    title: scene.item?.title?.trim() || scene.title,
    copy: scene.item?.description?.trim() || scene.copy,
    cover: scene.item?.cover,
    coverCandidates: scene.item?.coverCandidates,
    coverTestID: `reference-home-scene-cover-${scene.sceneId}`,
    moduleKey: `reference-home-scene-${scene.item?.provider ?? 'pending'}:${scene.item?.id ?? scene.sceneId}`,
    onPress: scene.item ? () => onOpenScenePlaylist(scene.item!) : undefined,
  }))} />;
}

export interface HomePlaylistRailCard {
  key: string;
  title: string;
  copy: string;
  cover?: string;
  coverCandidates?: string[];
  coverTestID: string;
  moduleKey: string;
  fallback?: React.ComponentProps<typeof ResilientHomeCover>['fallback'];
  onPress?: () => void;
  suppressLongPress?: boolean;
}
const ignoreLongPress = () => {};

export function ReferenceHomePlaylistRail({ cards, emptyCopy }: { cards: HomePlaylistRailCard[]; emptyCopy?: string }) {
  const theme = useTheme();
  if (!cards.length) return emptyCopy ? <View testID="home-my-playlists-empty" style={s.emptyMine}>
    <Text style={{ color: theme.muted }}>{emptyCopy}</Text>
  </View> : null;
  return (
    <ScrollView
      testID="reference-home-scenes"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.sceneRail}
      showsVerticalScrollIndicator={false}
    >
      {cards.map(card => {
        return (
          <StickyPressable
            key={card.key}
            testID="home-scene-card"
            accessibilityRole="button"
            accessibilityLabel={`打开${card.title}`}
            onPress={card.onPress}
            onLongPress={card.suppressLongPress ? ignoreLongPress : undefined}
            style={s.sceneItem}
          >
            <ResilientHomeCover
              uri={card.cover}
              uris={card.coverCandidates}
              fallback={card.fallback}
              testID={card.coverTestID}
              moduleKey={card.moduleKey}
              style={s.sceneImage}
              imageStyle={s.sceneImageRadius}
              clipToImageStyle
              resizeMethod="resize"
            />
            <Text
              numberOfLines={1}
              style={[s.sceneTitle, { color: theme.text }]}
            >
              {card.title}
            </Text>
            <Text
              numberOfLines={1}
              style={[s.sceneCopy, { color: theme.muted }]}
            >
              {card.copy}
            </Text>
          </StickyPressable>
        );
      })}
    </ScrollView>
  );
}

function SectionHeader({
  title,
  action,
  onPress,
  playlistSection = 'scenes',
  onPlaylistSectionChange,
}: {
  title: string;
  action: 'refresh' | 'all';
  onPress: () => void;
  playlistSection?: 'scenes' | 'mine';
  onPlaylistSectionChange?: (section: 'scenes' | 'mine') => void;
}) {
  const theme = useTheme();
  // Keep the actions distinct from theme text/accent and outline them against
  // photographic backgrounds without adding a filled button surface.
  const color = theme.dark ? '#FFFFFF' : '#243A54';
  const highlight = theme.dark ? '#142033' : '#FFFFFF';
  const refreshPath = 'M20 7v5h-5M20 12a8 8 0 1 0-2.1 5.4';
  return (
    <View style={s.sectionHeader}>
      {onPlaylistSectionChange ? <View style={s.sectionTabs}>
        {(['scenes', 'mine'] as const).map(section => <Pressable key={section}
          testID={`home-playlist-section-${section}`} accessibilityRole="tab"
          accessibilityState={{ selected: playlistSection === section }}
          onPress={() => onPlaylistSectionChange(section)} style={s.sectionTab}>
          <Text style={[s.sectionTitle, { color: playlistSection === section ? theme.text : theme.muted }]}>
            {section === 'scenes' ? '场景歌单' : '我的歌单'}
          </Text>
        </Pressable>)}
      </View> : <Text style={[s.sectionTitle, { color: theme.text }]}>{title}</Text>}
      <Pressable
        testID={
          action === 'refresh'
            ? 'home-recommendation-refresh'
            : playlistSection === 'mine' ? 'home-my-playlists-all' : 'home-scenes-all'
        }
        accessibilityRole="button"
        accessibilityLabel={
          action === 'refresh' ? '刷新推荐歌单缓存' : playlistSection === 'mine' ? '查看全部我的歌单' : '查看全部场景歌单'
        }
        onPress={onPress}
        style={s.sectionAction}
        hitSlop={8}
      >
        {action === 'refresh' ? (
          <Svg
            testID="home-recommendation-refresh-icon"
            width={20}
            height={20}
            viewBox="0 0 24 24"
          >
            <Path
              d={refreshPath}
              fill="none"
              stroke={highlight}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={refreshPath}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : (
          <Text
            testID="home-scene-action-arrow"
            style={[s.sectionArrow, { color, textShadowColor: highlight }]}
          >
            ›
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const fill = {
  position: 'absolute' as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const s = StyleSheet.create({
  surface: { backgroundColor: 'transparent' },
  emptyScenes: { paddingBottom: 10 },
  emptyMine: { minHeight: 116, paddingHorizontal: 20, justifyContent: 'center' },
  sectionTabs: { flex: 1, flexDirection: 'row', gap: 20, alignItems: 'center' },
  sectionTab: { minHeight: 40, justifyContent: 'center' },
  sectionHeader: {
    minHeight: 40,
    marginTop: 21,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    flex: 1,
    fontFamily: serif,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
  },
  sectionAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionArrow: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '500',
    includeFontPadding: false,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1.5,
  },
  recommendRail: { gap: 8, paddingHorizontal: 18, paddingTop: 9 },
  featuredCard: {
    width: 236,
    height: 154,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  smallCard: {
    width: 100,
    height: 154,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  featuredRadius: { borderRadius: 16 },
  smallRadius: { borderRadius: 16 },
  recommendShade: { ...fill, backgroundColor: 'rgba(5,12,25,.14)' },
  recommendCopy: { position: 'absolute', right: 10, bottom: 10, left: 10 },
  recommendTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  recommendSub: {
    marginTop: 3,
    color: 'rgba(255,255,255,.84)',
    fontSize: 10,
  },
  recommendPlay: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 29,
    height: 29,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sceneRail: {
    gap: 15,
    paddingHorizontal: 20,
    paddingTop: 9,
    paddingBottom: 10,
  },
  sceneItem: { width: 88, alignItems: 'center' },
  sceneImage: { width: 72, height: 72 },
  sceneImageRadius: { borderRadius: 36 },
  sceneTitle: {
    marginTop: 7,
    fontSize: 13,
    fontWeight: '600',
  },
  sceneCopy: { marginTop: 2, fontSize: 10 },
});
