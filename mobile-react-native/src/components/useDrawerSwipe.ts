import { useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';

/** Capture a directional drag without taking taps or horizontal song swipes. */
export function useDrawerSwipe(direction: 'up' | 'down', onSwipe?: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swipeActive = useRef(false);
  const ownsGesture = useRef(false);
  const point = (event: GestureResponderEvent) =>
    event.nativeEvent.changedTouches?.[0] ?? event.nativeEvent;
  const displacement = (event: GestureResponderEvent) => {
    if (!start.current) return null;
    const touch = point(event);
    return {
      dx: touch.pageX - start.current.x,
      dy: touch.pageY - start.current.y,
    };
  };
  const matches = (dx: number, dy: number, threshold: number) =>
    (direction === 'down' ? dy : -dy) > threshold &&
    Math.abs(dy) > Math.abs(dx);
  const cancel = () => {
    start.current = null;
    ownsGesture.current = false;
  };
  const release = (event: GestureResponderEvent) => {
    const delta = displacement(event);
    const owned = ownsGesture.current;
    cancel();
    if (owned && onSwipe && delta && matches(delta.dx, delta.dy, 24)) onSwipe();
  };
  return {
    swipeActive,
    touchHandlers: {
      onTouchStart: (event: GestureResponderEvent) => {
        const touch = point(event);
        start.current = { x: touch.pageX, y: touch.pageY };
        swipeActive.current = false;
        ownsGesture.current = false;
      },
      onStartShouldSetResponderCapture: () => false,
      onMoveShouldSetResponderCapture: (event: GestureResponderEvent) => {
        const delta = displacement(event);
        const capture = Boolean(
          onSwipe && delta && matches(delta.dx, delta.dy, 10),
        );
        if (capture) swipeActive.current = true;
        return capture;
      },
      onResponderGrant: () => {
        ownsGesture.current = true;
        swipeActive.current = true;
      },
      onResponderMove: () => undefined,
      onResponderRelease: release,
      onResponderTerminationRequest: () => !ownsGesture.current,
      onResponderTerminate: cancel,
      onTouchEnd: () => {
        if (!ownsGesture.current) start.current = null;
      },
      onTouchCancel: cancel,
    },
  };
}
