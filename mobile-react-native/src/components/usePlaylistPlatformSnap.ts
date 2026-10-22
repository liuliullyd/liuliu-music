import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

export const PLAYLIST_PLATFORM_WIDTH = 84;
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** One release chooses one platform; native inertia may only finish that choice. */
export function usePlaylistPlatformSnap(
  identity: string,
  order: string,
  value: string | null,
  onSelect: (index: number) => void,
) {
  const scrollRef = useRef<ScrollView>(null);
  const scope = `${identity}:${order}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const selected = useRef(value);
  selected.current = value;
  const ids = order ? order.split('|') : [];
  const index = Math.max(0, ids.indexOf(value ?? ''));
  const gesture = useRef({
    scope,
    dragging: false,
    target: null as number | null,
    invalidated: false,
  });
  if (
    gesture.current.scope !== scope ||
    (gesture.current.target !== null && ids[gesture.current.target] !== value)
  ) {
    const invalidated =
      gesture.current.dragging || gesture.current.target !== null;
    gesture.current = { scope, dragging: false, target: null, invalidated };
  }

  const syncPicker = useCallback(() => {
    if (currentScope.current !== scope || gesture.current.dragging) return;
    scrollRef.current?.scrollTo({
      x: index * PLAYLIST_PLATFORM_WIDTH,
      y: 0,
      animated: false,
    });
  }, [index, scope]);
  useLayoutEffect(() => {
    // A released target is already animating. External restoration/list changes
    // align explicitly, including non-chart detail entries.
    if (gesture.current.target !== index) syncPicker();
  }, [index, scope, syncPicker]);

  const nearest = (x: number) =>
    Number.isFinite(x) && ids.length
      ? Math.max(
          0,
          Math.min(ids.length - 1, Math.round(x / PLAYLIST_PLATFORM_WIDTH)),
        )
      : null;
  const commit = (target: number) => {
    const id = ids[target];
    if (id === undefined || id === selected.current) return;
    selected.current = id;
    onSelect(target);
  };
  const onScrollBeginDrag = () => {
    if (currentScope.current !== scope) return;
    gesture.current = {
      scope,
      dragging: true,
      target: null,
      invalidated: false,
    };
  };
  const onScrollEndDrag = ({ nativeEvent }: ScrollEvent) => {
    if (currentScope.current !== scope || gesture.current.invalidated) return;
    gesture.current.dragging = false;
    const target = nearest(nativeEvent.contentOffset.x);
    if (target === null) {
      syncPicker();
      return;
    }
    gesture.current.target = target;
    scrollRef.current?.scrollTo({
      x: target * PLAYLIST_PLATFORM_WIDTH,
      y: 0,
      animated: true,
    });
    commit(target);
  };
  const onMomentumScrollEnd = ({ nativeEvent }: ScrollEvent) => {
    if (
      currentScope.current !== scope ||
      gesture.current.dragging ||
      gesture.current.invalidated
    )
      return;
    const target =
      gesture.current.target ?? nearest(nativeEvent.contentOffset.x);
    if (target === null) return;
    // Correct native velocity rounding/overscroll without selecting a second
    // platform or leaving a partial label visible. No timer/network work.
    scrollRef.current?.scrollTo({
      x: target * PLAYLIST_PLATFORM_WIDTH,
      y: 0,
      animated: false,
    });
    commit(target);
  };
  return {
    scrollRef,
    syncPicker,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollEnd,
    contentOffset: { x: index * PLAYLIST_PLATFORM_WIDTH, y: 0 },
  };
}
