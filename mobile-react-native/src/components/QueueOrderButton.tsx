import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';

export function QueueOrderButton({ scale = 1 }: { scale?: number }) {
  const app = useApp();
  const c = useTheme();
  return (
    <Pressable
      testID="queue-reverse-button"
      accessibilityRole="button"
      accessibilityLabel={
        app.queueReversed ? '恢复播放列表原顺序' : '倒序播放列表'
      }
      accessibilityState={{
        selected: app.queueReversed,
        disabled: app.queue.length < 2 || app.queueOrderChanging,
      }}
      disabled={app.queue.length < 2 || app.queueOrderChanging}
      onPress={() => {
        void app.reverseQueue().catch(() => undefined);
      }}
      style={[
        s.button,
        {
          width: 46 * scale,
          height: 42 * scale,
          opacity: app.queue.length < 2 ? 0.4 : 1,
        },
      ]}
    >
      <Svg width={24 * scale} height={24 * scale} viewBox="0 0 24 24">
        <Path
          d="M5 4v16m-3-3 3 3 3-3M12 5h9M12 10h7M12 15h5M12 20h3"
          fill="none"
          stroke={app.queueReversed ? c.blue : c.text}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}
const s = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
});
