import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type Direction = 'up' | 'down' | 'left' | 'right';
const paths: Record<Direction, string> = {
  up: 'm5 15.5 7-7 7 7',
  down: 'm5 8.5 7 7 7-7',
  left: 'm14.5 5-7 7 7 7',
  right: 'm9.5 5 7 7-7 7',
};

/** Mounted only while the shared bottom-player tutorial is visible. */
export function PlayerGestureArrow({
  direction,
  color,
  testID,
  size = 18,
  travel = 28,
}: {
  direction: Direction;
  color: string;
  testID: string;
  size?: number;
  travel?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  const horizontal = direction === 'left' || direction === 'right';
  const outward = direction === 'left' || direction === 'up' ? -travel : travel;
  const movement = pulse.interpolate({
    inputRange: [0, 0.15, 0.78, 1],
    outputRange: [0, 0, outward, outward],
  });
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      style={{
        opacity: pulse.interpolate({
          inputRange: [0, 0.15, 0.78, 0.9, 1],
          outputRange: [0, 1, 1, 0, 0],
        }),
        transform: horizontal
          ? [{ translateX: movement }]
          : [{ translateY: movement }],
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d={paths[direction]}
          fill="none"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}
