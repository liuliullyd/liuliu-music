import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type LayoutChangeEvent,
} from 'react-native';
import { covers } from '../assets/covers';
import type { CoverKey } from '../domain/types';
import { sampleLibraryCoverEdgeColor } from '../services/libraryArtwork';
import { useLayout } from '../state/LayoutContext';
import { serif, useTheme } from '../theme';
import {
  PlaylistInformationGradient,
  PlaylistInformationSurface,
  PlaylistInformationTopGradient,
  usePlaylistInformationColor,
} from './PlaylistInformationSurface';
import {
  PlaylistDetailGradientViewport,
  usePlaylistDetailScrollGradient,
} from './PlaylistDetailScrollGradient';
import { ResilientHomeCover } from './ResilientHomeCover';
import { Glyph } from './UI';
import { StickyBackgroundExtension } from './StickyBackgroundExtension';

/** Home New Releases owns this frame; callers supply their existing data/actions. */
export function HomePlaylistDetail({
  identity,
  title,
  subtitle,
  description,
  cover,
  coverCandidates = [],
  coverKey = 'train',
  remotePending = false,
  libraryArtwork = false,
  ready = true,
  onBack,
  headerActions,
  actions,
  filters,
  children,
  footer,
  scrollTestID = 'playlist-detail',
  rootTestID = 'home-playlist-detail',
  headerTestID = 'collection-detail-header',
  coverTestID = 'collection-detail-cover',
  titleTestID = 'collection-detail-title',
  controlsTestID = 'playlist-sticky-actions',
  listTestID = 'playlist-detail-track-list',
  insetList = false,
  onScrollOffset,
  onScroll,
  onScrollBeginDrag,
  onLayout,
  onContentSizeChange,
  scrollRef,
  onTrackListLayout,
  onControlsLayout,
}: {
  identity: string;
  title: string;
  subtitle?: string;
  description?: string;
  cover?: string;
  coverCandidates?: string[];
  coverKey?: CoverKey;
  remotePending?: boolean;
  /** Local/bundled Library covers extend the same Home sampler. */
  libraryArtwork?: boolean;
  ready?: boolean;
  onBack: () => void;
  headerActions?: React.ReactNode;
  actions: React.ReactNode;
  filters?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scrollTestID?: string;
  rootTestID?: string;
  headerTestID?: string;
  coverTestID?: string;
  titleTestID?: string;
  controlsTestID?: string;
  listTestID?: string;
  insetList?: boolean;
  onScrollOffset?: (offset: number) => void;
  onScroll?: ScrollViewProps['onScroll'];
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  onLayout?: ScrollViewProps['onLayout'];
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  scrollRef?: React.RefObject<ScrollView | null>;
  onTrackListLayout?: (event: LayoutChangeEvent) => void;
  onControlsLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const layout = useLayout();
  const artworkIdentity = `${identity}:${coverKey}:${
    cover ?? ''
  }:${coverCandidates.join('|')}`;
  const currentIdentity = useRef(artworkIdentity);
  currentIdentity.current = artworkIdentity;
  const [loaded, setLoaded] = useState({ identity: '', uri: '' });
  const [failedLocalIdentity, setFailedLocalIdentity] = useState('');
  const localFailure = useRef('');
  const acceptCover = useCallback(
    (uri: string) => {
      if (!uri || currentIdentity.current !== artworkIdentity) return;
      setLoaded(current =>
        current.identity === artworkIdentity && current.uri === uri
          ? current
          : { identity: artworkIdentity, uri },
      );
    },
    [artworkIdentity],
  );
  const fallbackUri = Image.resolveAssetSource(covers[coverKey])?.uri ?? '';
  const localCover = /^(file|content):\/\//i.test(cover ?? '');
  const remoteCover = [cover, ...coverCandidates].some(uri =>
    /^https?:\/\//i.test(uri ?? ''),
  );
  useEffect(() => {
    if (libraryArtwork && !remotePending && !localCover && !remoteCover)
      acceptCover(fallbackUri);
  }, [
    acceptCover,
    fallbackUri,
    libraryArtwork,
    localCover,
    remoteCover,
    remotePending,
  ]);
  const coverUri = loaded.identity === artworkIdentity ? loaded.uri : '';
  const color = usePlaylistInformationColor(
    true,
    artworkIdentity,
    coverUri,
    libraryArtwork ? sampleLibraryCoverEdgeColor : undefined,
  );
  const gradient = usePlaylistDetailScrollGradient(identity);
  const artworkStyle = [s.cover, { borderColor: theme.line }];
  return (
    <View testID={rootTestID} style={[s.root, { backgroundColor: theme.bg }]}>
      <StickyBackgroundExtension active={ready && gradient.stuck} color={theme.bg} />
      <PlaylistDetailGradientViewport stuck={gradient.stuck} />
      <ScrollView
        ref={scrollRef}
        testID={scrollTestID}
        style={s.root}
        stickyHeaderIndices={ready ? [1] : undefined}
        removeClippedSubviews={false}
        scrollEventThrottle={100}
        onScroll={event => {
          gradient.onScroll(event.nativeEvent.contentOffset.y);
          onScrollOffset?.(event.nativeEvent.contentOffset.y);
          onScroll?.(event);
        }}
        onLayout={onLayout}
        onScrollBeginDrag={onScrollBeginDrag}
        onContentSizeChange={onContentSizeChange}
        contentContainerStyle={{ paddingBottom: layout.scrollBottomPadding }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        <PlaylistInformationSurface
          enabled
          identity={artworkIdentity}
          coverUri={coverUri}
          color={color}
          showGradient={false}
          showTopGradient={false}
          style={s.information}
        >
          <View
            testID={headerTestID}
            style={[
              s.backHeader,
              { paddingHorizontal: layout.pageHorizontalPadding },
            ]}
          >
            <Pressable
              accessibilityLabel="返回"
              onPress={onBack}
              style={[
                s.backButton,
                {
                  width: layout.headerButtonSize,
                  height: layout.headerButtonSize,
                },
              ]}
            >
              <Glyph color={theme.text} size={31}>
                ‹
              </Glyph>
            </Pressable>
            {headerActions}
          </View>
          {ready ? (
            <>
              <View style={s.hero}>
                {localCover ? (
                  <View
                    key={artworkIdentity}
                    testID={coverTestID}
                    style={artworkStyle}
                  >
                    <Image
                      source={covers[coverKey]}
                      style={[StyleSheet.absoluteFill, s.radius]}
                    />
                    {failedLocalIdentity !== artworkIdentity ? (
                      <Image
                        testID={`${coverTestID}-local`}
                        source={{ uri: cover! }}
                        fadeDuration={0}
                        style={[StyleSheet.absoluteFill, s.radius]}
                        onLoad={() => {
                          if (localFailure.current !== artworkIdentity)
                            acceptCover(cover!);
                        }}
                        onError={() => {
                          if (currentIdentity.current !== artworkIdentity)
                            return;
                          localFailure.current = artworkIdentity;
                          setFailedLocalIdentity(artworkIdentity);
                          acceptCover(fallbackUri);
                        }}
                      />
                    ) : null}
                  </View>
                ) : (
                  <ResilientHomeCover
                    clipToImageStyle
                    uri={cover}
                    uris={coverCandidates}
                    fallback={covers[coverKey]}
                    remotePending={remotePending}
                    testID={coverTestID}
                    moduleKey={coverTestID}
                    style={artworkStyle}
                    imageStyle={s.radius}
                    onLoadedUri={acceptCover}
                    onExhausted={
                      libraryArtwork
                        ? () => acceptCover(fallbackUri)
                        : undefined
                    }
                  />
                )}
              </View>
              <Text
                testID={titleTestID}
                numberOfLines={2}
                style={[s.title, { color: theme.text }]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  testID="collection-detail-stats"
                  style={[s.subtitle, { color: theme.muted }]}
                >
                  {subtitle}
                </Text>
              ) : null}
              {description ? (
                <Text
                  testID="playlist-detail-description"
                  numberOfLines={2}
                  style={[s.description, { color: theme.muted }]}
                >
                  {description}
                </Text>
              ) : null}
            </>
          ) : null}
        </PlaylistInformationSurface>
        {ready ? (
          <View
            testID={controlsTestID}
            onLayout={event => {
              gradient.onStickyLayout(event);
              onControlsLayout?.(event);
            }}
            style={[
              s.controls,
              filters ? s.filteredControls : null,
              { backgroundColor: color },
            ]}
          >
            {gradient.stuck ? <PlaylistInformationTopGradient /> : null}
            <PlaylistInformationGradient />
            {actions}
            {filters}
          </View>
        ) : null}
        <View
          testID={listTestID}
          onLayout={onTrackListLayout}
          style={[
            s.list,
            { backgroundColor: theme.bg },
            insetList && { paddingHorizontal: layout.pageHorizontalPadding },
          ]}
        >
          {children}
        </View>
        {footer}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  information: { paddingBottom: 10 },
  backHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: { alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingTop: 4, paddingHorizontal: 18 },
  cover: {
    width: 168,
    height: 168,
    maxWidth: 168,
    marginHorizontal: 18,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  radius: { borderRadius: 22 },
  title: {
    fontFamily: serif,
    fontWeight: '400',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 6,
    marginHorizontal: 18,
  },
  subtitle: { fontSize: 12, textAlign: 'center', marginHorizontal: 18 },
  description: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginHorizontal: 30,
    marginTop: 8,
  },
  controls: { height: 72, minHeight: 72, marginBottom: 8 },
  filteredControls: { height: 126, minHeight: 126 },
  list: { marginTop: 12 },
});
