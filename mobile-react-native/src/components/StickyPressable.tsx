import React, { useMemo, useRef } from 'react';
import {
  UIManager,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';
import { useLayout } from '../state/LayoutContext';

// RN's internal hook has no published TypeScript declaration in this version.
// Keeping the native Pressability state machine here is important: sticky
// headers can be visually translated by the native scroll view while Fabric's
// responder target still reports its pre-stick origin.
const usePressability =
  require('react-native/Libraries/Pressability/usePressability')
    .default as (config: {
    cancelable: boolean;
    disabled?: boolean;
    delayLongPress?: number;
    hitSlop?: number | Insets;
    pressRectOffset?: number | Insets;
    onLongPress?: (event: GestureResponderEvent) => unknown;
    onPress?: (event: GestureResponderEvent) => unknown;
    onPressIn?: (event: GestureResponderEvent) => unknown;
    onPressOut?: (event: GestureResponderEvent) => unknown;
  }) => StickyPressabilityHandlers;

type Insets = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type StickyPressabilityHandlers = ViewProps & {
  onResponderGrant: (event: GestureResponderEvent) => void | boolean;
};

type Measure = (
  callback: (
    x: number,
    y: number,
    width: number,
    height: number,
    pageX: number,
    pageY: number,
  ) => void,
) => void;

export type StickyPressableProps = ViewProps & {
  onPress?: (event: GestureResponderEvent) => unknown;
  onLongPress?: (event: GestureResponderEvent) => unknown;
  onPressIn?: (event: GestureResponderEvent) => unknown;
  onPressOut?: (event: GestureResponderEvent) => unknown;
  disabled?: boolean;
  delayLongPress?: number;
  hitSlop?: number | Insets;
  pressRetentionOffset?: number | Insets;
};

/**
 * Pressable-compatible control for native sticky headers.
 *
 * At responder grant, convert the touch's local coordinates into the visual
 * page origin produced by the sticky transform. Pressability then keeps that
 * frozen origin while handling MOVE/termination exactly as RN's Pressable
 * does, so a small native sticky translation cannot cancel a valid tap.
 */
export function StickyPressable({
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  delayLongPress,
  hitSlop,
  pressRetentionOffset,
  children,
  onLayout,
  onResponderGrant: _onResponderGrant,
  pointerEvents,
  collapsable,
  accessible,
  accessibilityState,
  focusable,
  ...props
}: StickyPressableProps) {
  const { scale } = useLayout();
  const size = useRef({ width: 0, height: 0 });
  const config = useMemo(
    () => ({
      cancelable: true,
      disabled,
      delayLongPress,
      hitSlop,
      pressRectOffset: pressRetentionOffset,
      onLongPress,
      onPress,
      onPressIn,
      onPressOut,
    }),
    [
      disabled,
      delayLongPress,
      hitSlop,
      pressRetentionOffset,
      onLongPress,
      onPress,
      onPressIn,
      onPressOut,
    ],
  );
  const handlers = usePressability(config);

  const onResponderGrant = (event: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = event.nativeEvent;
    // box-only makes locationX/Y relative to this control even when the touch
    // lands on its icon or text child. Page coordinates include the scaled
    // application canvas.
    const left = pageX - locationX * scale;
    const top = pageY - locationY * scale;
    const target = event.currentTarget as unknown as
      | number
      | { measure?: Measure }
      | null
      | undefined;
    const measure: Measure = callback => {
      const measured = (
        x: number,
        y: number,
        width: number,
        height: number,
        measuredX: number,
        measuredY: number,
      ) => {
        // Native sticky transforms can leave Fabric's measured origin behind.
        // Freeze the touch's visual origin at grant; MOVE must never move it.
        callback(
          x,
          y,
          width || size.current.width * scale,
          height || size.current.height * scale,
          Number.isFinite(left) ? left : measuredX,
          Number.isFinite(top) ? top : measuredY,
        );
      };
      if (typeof target === 'number') {
        UIManager.measure(target, measured);
      } else if (target?.measure) {
        target.measure(measured);
      } else {
        measured(
          0,
          0,
          size.current.width * scale,
          size.current.height * scale,
          left,
          top,
        );
      }
    };
    return handlers.onResponderGrant({
      ...event,
      persist: () => event.persist(),
      currentTarget: { measure },
    } as unknown as GestureResponderEvent);
  };

  return (
    <View
      {...props}
      {...handlers}
      accessible={accessible ?? true}
      accessibilityState={
        disabled != null
          ? { ...accessibilityState, disabled }
          : accessibilityState
      }
      focusable={focusable ?? (onPress != null && !disabled)}
      collapsable={collapsable ?? false}
      pointerEvents={pointerEvents ?? 'box-only'}
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        size.current = { width, height };
        onLayout?.(event);
      }}
      onResponderGrant={onResponderGrant}
    >
      {children}
    </View>
  );
}
