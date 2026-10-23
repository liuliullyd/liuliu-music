import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { covers } from '../assets/covers';
import type { CoverKey } from '../domain/types';
import { useTheme } from '../theme';
import { Glyph } from './UI';
import { useLayout } from '../state/LayoutContext';
import { useApp } from '../state/AppContext';
import {
  PlaylistInformationSurface,
  usePlaylistInformationColor,
} from './PlaylistInformationSurface';
import { LibraryArtwork } from './LibraryArtwork';
import { sampleLibraryCoverEdgeColor } from '../services/libraryArtwork';
import {
  LibraryDetailTopGradient,
} from './LibraryDetailAppearance';

export function LibraryDetailHeader({
  title,
  count,
  description,
  cover,
  coverCandidates,
  coverKey = 'vinyl',
  onBack,
  showTopGradient = true,
  onColorChange,
}: {
  title: string;
  count: string;
  description?: string;
  cover?: string;
  coverCandidates?: string[];
  coverKey?: CoverKey;
  onBack?: () => void;
  showTopGradient?: boolean;
  onColorChange?: (color: string) => void;
}) {
  const c = useTheme();
  const layout = useLayout();
  const app = useApp();
  const identity = `${title}:${cover ?? coverKey}`;
  const [loaded, setLoaded] = useState({ identity: '', uri: '' });
  const coverUri =
    loaded.identity === identity
      ? loaded.uri
      : Image.resolveAssetSource(covers[coverKey])?.uri ?? '';
  const color = usePlaylistInformationColor(
    true,
    identity,
    coverUri,
    sampleLibraryCoverEdgeColor,
  );
  useEffect(() => {
    onColorChange?.(color);
  }, [color, onColorChange]);
  return (
    <View testID="library-detail-header">
      <PlaylistInformationSurface
        enabled
        identity={identity}
        coverUri={coverUri}
        color={color}
        style={{ marginHorizontal: -layout.pageHorizontalPadding }}
        showGradient={false}
        showTopGradient={false}
      >
        {showTopGradient ? <LibraryDetailTopGradient color={color} /> : null}
        <View
          testID="library-detail-back-header"
          style={[
            s.backHeader,
            { paddingHorizontal: layout.pageHorizontalPadding, minHeight: 56 },
          ]}
        >
          <Pressable
            accessibilityLabel="返回"
            onPress={onBack ?? app.back}
            style={{
              width: layout.headerButtonSize,
              height: layout.headerButtonSize,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Glyph color={c.text} size={31}>
              ‹
            </Glyph>
          </Pressable>
        </View>
        <View style={s.information}>
          <LibraryArtwork
            uri={cover}
            uris={coverCandidates}
            fallback={covers[coverKey]}
            testID="library-list-detail-cover"
            moduleKey="library-list-detail"
            onLoadedUri={uri => setLoaded({ identity, uri })}
            clipToImageStyle
            style={s.cover}
            imageStyle={s.radius}
          />
          <Text numberOfLines={2} style={[s.title, { color: c.text }]}>
            {title}
          </Text>
          <Text style={[s.count, { color: c.muted }]}>{count}</Text>
          {description ? (
            <Text numberOfLines={2} style={[s.description, { color: c.muted }]}>
              {description}
            </Text>
          ) : null}
        </View>
      </PlaylistInformationSurface>
    </View>
  );
}
const s = StyleSheet.create({
  backHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  information: { alignItems: 'center', paddingTop: 4, paddingBottom: 28 },
  cover: { width: 168, height: 168 },
  radius: { borderRadius: 18 },
  title: { fontSize: 20, lineHeight: 26, marginTop: 12, textAlign: 'center' },
  count: { fontSize: 12, marginTop: 6 },
  description: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
});
