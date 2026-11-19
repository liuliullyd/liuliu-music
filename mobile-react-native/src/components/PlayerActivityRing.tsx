import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const reach = 6;

export function PlayerActivityRing({
  size,
  color,
  playing,
  identity,
}: {
  size: number;
  color: string;
  playing: boolean;
  identity: string;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive',
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', state =>
      setForeground(state === 'active'),
    );
    return () => listener.remove();
  }, []);
  const active = foreground && playing && Boolean(identity);
  useEffect(() => {
    if (!active) return;
    rotation.setValue(0);
    // One native transform runs continuously; no JS frame updates or audio polling.
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [active, rotation]);

  const extent = size + reach * 2;
  const center = extent / 2;
  const radius = size / 2 + 3;
  const point = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return [
      center + Math.cos(radians) * radius,
      center + Math.sin(radians) * radius,
    ];
  };
  const arc = (start: number, end: number) => {
    const from = point(start),
      to = point(end);
    return `M${from[0]},${from[1]}A${radius},${radius} 0 0 1 ${to[0]},${to[1]}`;
  };
  const head = point(52);
  return (
    <View
      testID="nav-player-activity"
      pointerEvents="none"
      accessible={false}
      style={[
        s.ring,
        { top: -reach, left: -reach, width: extent, height: extent },
      ]}
    >
      {active ? (
        <Animated.View
          testID="nav-player-activity-motion"
          style={{
            width: extent,
            height: extent,
            transform: [
              {
                rotate: rotation.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              },
            ],
          }}
        >
          <Svg width={extent} height={extent}>
            <Path
              d={arc(-110, -40)}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.15}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d={arc(-40, 12)}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.45}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d={arc(12, 52)}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
            />
            <Circle cx={head[0]} cy={head[1]} r={2.4} fill={color} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({ ring: { position: 'absolute' } });
