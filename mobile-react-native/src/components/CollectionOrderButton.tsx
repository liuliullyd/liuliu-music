import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { StickyPressable } from './StickyPressable';
import { useTheme } from '../theme';
import type { StyleProp, ViewStyle } from 'react-native';

export function CollectionOrderButton({
  oldestFirst,
  loading,
  onPress,
  style,
}: {
  oldestFirst: boolean;
  loading: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <StickyPressable
      testID="collection-order-button"
      accessibilityRole="button"
      accessibilityLabel={
        oldestFirst ? '恢复合集原顺序' : '倒序，从合集首集开始'
      }
      accessibilityState={{ selected: oldestFirst, busy: loading }}
      onPress={onPress}
      style={style}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          d="M5 4v16m-3-3 3 3 3-3M12 5h9M12 10h7M12 15h5M12 20h3"
          fill="none"
          stroke={oldestFirst ? c.accent : c.text}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </StickyPressable>
  );
}
