import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { sampleCoverEdgeColor } from '../services/playerAppearance';
import { useTheme, type ThemePalette } from '../theme';

const rgb = (color: string) => {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
};
const luminance = (channels: number[]) => {
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
};
const contrast = (first: number[], second: number[]) => {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Retain the sampled hue while keeping the existing theme text readable. */
export function playlistInformationColor(
  sample: string | null,
  theme: ThemePalette,
) {
  const tone = sample ? rgb(sample) : null;
  const background = rgb(theme.bg),
    text = rgb(theme.text),
    muted = rgb(theme.muted);
  if (!tone || !background || !text || !muted) return theme.bg;
  for (const ratio of [0.8, 0.65, 0.5, 0.35, 0.2, 0.1]) {
    const blended = tone.map((channel, index) =>
      Math.round(channel * ratio + background[index]! * (1 - ratio)),
    );
    if (contrast(blended, text) >= 4.5 && contrast(blended, muted) >= 3) {
      return `#${blended
        .map(channel => channel.toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }
  return theme.bg;
}

export function usePlaylistInformationColor(
  enabled: boolean,
  identity: string,
  coverUri: string,
  sampler = sampleCoverEdgeColor,
) {
  const theme = useTheme();
  const [sample, setSample] = useState<{
    identity: string;
    uri: string;
    color: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !coverUri) return undefined;
    let active = true;
    sampler(coverUri).then(color => {
      if (active) setSample({ identity, uri: coverUri, color });
    });
    return () => {
      active = false;
    };
  }, [enabled, identity, coverUri, sampler]);
  const color =
    sample?.identity === identity && sample.uri === coverUri
      ? sample.color
      : null;
  return playlistInformationColor(color, theme);
}

export function PlaylistInformationSurface({
  enabled,
  identity,
  coverUri,
  children,
  color,
  showGradient = true,
  showTopGradient = false,
  style,
  sampler,
  onLayout,
}: {
  enabled: boolean;
  identity: string;
  coverUri: string;
  children: React.ReactNode;
  color?: string;
  showGradient?: boolean;
  showTopGradient?: boolean;
  style?: StyleProp<ViewStyle>;
  sampler?: (uri: string) => Promise<string | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const sampledColor = usePlaylistInformationColor(
    enabled && color === undefined,
    identity,
    coverUri,
    sampler,
  );
  if (!enabled) return <>{children}</>;
  return (
    <View
      testID="playlist-information-surface"
      onLayout={onLayout}
      style={[{ backgroundColor: color ?? sampledColor }, style]}
    >
      {showTopGradient ? <PlaylistInformationTopGradient /> : null}
      {showGradient ? <PlaylistInformationGradient /> : null}
      {children}
    </View>
  );
}

export function PlaylistInformationGradient() {
  const theme = useTheme();
  return (
    <Svg
      testID="playlist-information-bottom-gradient"
      pointerEvents="none"
      width="100%"
      height={80}
      style={s.gradient}
    >
      <Defs>
        <LinearGradient
          id="playlistInformationBottom"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <Stop offset="0" stopColor={theme.bg} stopOpacity="0" />
          <Stop offset="1" stopColor={theme.bg} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#playlistInformationBottom)" />
    </Svg>
  );
}

export function PlaylistInformationTopGradient() {
  const theme = useTheme();
  return (
    <Svg
      testID="playlist-information-top-gradient"
      pointerEvents="none"
      width="100%"
      height={80}
      style={s.topGradient}
    >
      <Defs>
        <LinearGradient id="playlistInformationTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.bg} stopOpacity="1" />
          <Stop offset="1" stopColor={theme.bg} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#playlistInformationTop)" />
    </Svg>
  );
}

const s = StyleSheet.create({
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topGradient: { position: 'absolute', top: 0, left: 0, right: 0 },
});
