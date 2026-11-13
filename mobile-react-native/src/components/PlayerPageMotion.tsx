import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  findNodeHandle,
  requireNativeComponent,
  UIManager,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

export type PageGesture = {
  phase: 'grant' | 'move' | 'release' | 'terminate';
  gestureId: number;
  position: number;
  dx: number;
  dy: number;
};
type Completion = { id: number; position: number; finished: boolean };
export type PageMotionHandle = {
  setPosition: (position: number) => void;
  stop: (onStopped?: (position: number) => void) => void;
  animateTo: (
    position: number,
    spring: boolean,
    onFinished?: (result: { finished: boolean }) => void,
  ) => void;
};
type Props = ViewProps & {
  pageExtent: number;
  onGesture: (gesture: PageGesture) => void;
};
const NativeMotion = requireNativeComponent<
  ViewProps & {
    pageExtent: number;
    onPageGesture: (event: NativeSyntheticEvent<PageGesture>) => void;
    onMotionComplete: (event: NativeSyntheticEvent<Completion>) => void;
  }
>('LiuliuPlayerPageMotion');

/** The native view owns pixels. React owns mounted pages and accepted playback. */
export const PlayerPageMotion = forwardRef<PageMotionHandle, Props>(
  function NativePageMotion({ onGesture, ...props }, forwardedRef) {
    const nativeRef = useRef<React.ComponentRef<typeof NativeMotion>>(null);
    const gestureId = useRef(0);
    const commandId = useRef(0);
    const callbacks = useRef(new Map<number, (result: Completion) => void>());
    const dispatch = useCallback(
      (
        action: string,
        position: number,
        callback?: (result: Completion) => void,
      ) => {
        const tag = findNodeHandle(nativeRef.current);
        if (tag === null) return;
        const id = ++commandId.current;
        if (callback) callbacks.current.set(id, callback);
        UIManager.dispatchViewManagerCommand(tag, 'motion', [
          action,
          id,
          gestureId.current,
          position,
        ]);
      },
      [],
    );
    useImperativeHandle(
      forwardedRef,
      () => ({
        setPosition: position => dispatch('set', position),
        stop: onStopped =>
          dispatch('stop', 0, result => {
            if (result.finished) onStopped?.(result.position);
          }),
        animateTo: (position, spring, onFinished) =>
          dispatch(spring ? 'spring' : 'animate', position, onFinished),
      }),
      [dispatch],
    );
    useEffect(() => {
      const pending = callbacks.current;
      return () => pending.clear();
    }, []);
    return (
      <NativeMotion
        {...props}
        ref={nativeRef}
        onPageGesture={event => {
          if (event.nativeEvent.gestureId < gestureId.current) return;
          gestureId.current = event.nativeEvent.gestureId;
          onGesture(event.nativeEvent);
        }}
        onMotionComplete={event => {
          const result = event.nativeEvent;
          const callback = callbacks.current.get(result.id);
          callbacks.current.delete(result.id);
          callback?.(result);
        }}
      />
    );
  },
);
