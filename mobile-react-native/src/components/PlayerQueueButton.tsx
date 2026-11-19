import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { StickyPressable } from './StickyPressable';
import {
  PLAYER_ACTION_ICON_SIZE,
  PLAYER_ACTION_SIZE,
} from './QueueTrackActions';

export function PlayerQueueButton({
  scale = 1,
  color,
  testID = 'player-queue-button',
  sticky = false,
}: {
  scale?: number;
  color: string;
  testID?: string;
  sticky?: boolean;
}) {
  const app = useApp();
  const Button = sticky ? StickyPressable : Pressable;
  return (
    <Button
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="打开播放列表"
      onPress={() => app.setQueueListOpen(true)}
      style={[
        s.button,
        {
          width: PLAYER_ACTION_SIZE * scale,
          height: PLAYER_ACTION_SIZE * scale,
        },
      ]}
    >
      <Svg
        width={PLAYER_ACTION_ICON_SIZE * scale}
        height={PLAYER_ACTION_ICON_SIZE * scale}
        viewBox="0 0 28 28"
      >
        <Path
          d="M4 6h20M4 14h20M4 22h13"
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </Svg>
    </Button>
  );
}
const s = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
