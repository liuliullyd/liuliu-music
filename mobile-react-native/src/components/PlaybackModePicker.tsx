import React from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import {
  playbackModeFromSettings,
  playbackModeLabels,
  type PlaybackMode,
} from '../domain/types';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import {
  PLAYER_ACTION_ICON_SIZE,
  PLAYER_ACTION_SIZE,
} from './QueueTrackActions';
import { StickyPressable } from './StickyPressable';

const modes: PlaybackMode[] = ['sequence', 'shuffle', 'repeat-one'];
function RepeatIcon({
  color,
  size,
  single,
}: {
  color: string;
  size: number;
  single: boolean;
}) {
  return (
    <Svg
      testID={single ? 'playback-repeat-one-icon' : 'playback-list-loop-icon'}
      width={size}
      height={size}
      viewBox="0 0 42 42"
    >
      <Path
        d="M8 14h22l-5-5M34 28H12l5 5"
        fill="none"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M30 14a8 8 0 0 1 4 7M12 28a8 8 0 0 1-4-7"
        fill="none"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      {single ? (
        <SvgText
          x="21"
          y="26"
          fill={color}
          fontSize="13"
          fontWeight="700"
          textAnchor="middle"
        >
          1
        </SvgText>
      ) : null}
    </Svg>
  );
}

function ShuffleIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      testID="playback-shuffle-icon"
      width={size}
      height={size}
      viewBox="0 0 42 42"
    >
      <Path
        d="M7 10h4c7 0 9 22 16 22h8M29 10h6v6M35 10l-7 7M7 32h4c2.5 0 4.5-2 6.5-5M29 32h6v-6M35 32l-7-7"
        fill="none"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlaybackModePicker({
  compact = false,
  player = false,
  style,
  scale = 1,
  playerColor,
  sticky = false,
  testID,
}: {
  compact?: boolean;
  player?: boolean;
  style?: StyleProp<ViewStyle>;
  scale?: number;
  playerColor?: string;
  /** Use the sticky-header responder geometry when rendered in a native sticky bar. */
  sticky?: boolean;
  testID?: string;
}) {
  const app = useApp();
  const c = useTheme();
  const current = playbackModeFromSettings(app.state.settings);
  const next = modes[(modes.indexOf(current) + 1) % modes.length]!;
  const buttonColor = player ? playerColor ?? '#fff' : c.text;
  const Button = sticky ? StickyPressable : Pressable;
  return (
    <Button
      testID={testID ?? (compact ? 'queue-mode-button' : 'player-mode-button')}
      accessibilityRole="button"
      accessibilityLabel={`播放模式：${playbackModeLabels[current]}`}
      onPress={() => app.setPlaybackMode(next).catch(() => undefined)}
      style={[
        s.button,
        compact && {
          minHeight: 42 * scale,
          paddingHorizontal: 10 * scale,
          backgroundColor: 'transparent',
          borderRadius: 0,
        },
        player && {
          width: PLAYER_ACTION_SIZE * scale,
          height: PLAYER_ACTION_SIZE * scale,
          minWidth: PLAYER_ACTION_SIZE * scale,
          minHeight: PLAYER_ACTION_SIZE * scale,
          backgroundColor: 'transparent',
          borderRadius: 0,
        },
        style,
      ]}
    >
      {current === 'sequence' || current === 'repeat-one' ? (
        <RepeatIcon
          color={buttonColor}
          size={(player ? PLAYER_ACTION_ICON_SIZE : 24) * scale}
          single={current === 'repeat-one'}
        />
      ) : (
        <ShuffleIcon
          color={buttonColor}
          size={(player ? PLAYER_ACTION_ICON_SIZE : 24) * scale}
        />
      )}
    </Button>
  );
}

const s = StyleSheet.create({
  button: {
    minWidth: 46,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,248,245,0.14)',
  },
  compactButton: { minHeight: 42, paddingHorizontal: 10 },
});
