import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

type ScrollListener = (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

/** Keep the native binding stable while dispatching to the latest committed page. */
export function useStableNativeScrollEvent(
  scrollY: Animated.Value,
  listener?: ScrollListener,
) {
  const committed = useRef<{
    scrollY: Animated.Value;
    listener?: ScrollListener;
  } | null>(null);
  useLayoutEffect(() => {
    committed.current = { scrollY, listener };
    return () => { committed.current = null; };
  }, [scrollY, listener]);
  return useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } } }],
      {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const current = committed.current;
          if (current?.scrollY === scrollY) current.listener?.(event);
        },
      },
    ),
    [scrollY],
  );
}
