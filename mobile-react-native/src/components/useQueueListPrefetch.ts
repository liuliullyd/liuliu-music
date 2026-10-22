import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent } from 'react-native';

/** The furthest visible group requests its following group; the controller deduplicates goals. */
export function useQueueListPrefetch(
  prefetchAt: (index: number, options?: { gesture?: boolean }) => Promise<void>,
  page: { loading: boolean; hasMore: boolean; error: string },
  reversed = false,
  itemCount = 0,
  rowHeight = 1,
) {
  const gesture = useRef({ active: false, requested: false });
  const viewport = useRef<{ top: number; height: number } | null>(null);
  const current = useRef({ prefetchAt, page, reversed, itemCount, rowHeight });
  current.current = { prefetchAt, page, reversed, itemCount, rowHeight };
  const last = useRef<{
    group: number;
    count: number;
    reversed: boolean;
  } | null>(null);
  const requestVisible = useCallback(() => {
      const { prefetchAt: request, page: latestPage, reversed: isReversed, itemCount: count, rowHeight: height } = current.current;
      const visible = viewport.current;
      if (
        !visible ||
        (isReversed && (!gesture.current.active || gesture.current.requested)) ||
        !latestPage.hasMore ||
        latestPage.error ||
        count < 1
      )
        return;
      const row = Math.max(1, height);
      const top = visible.top;
      // Forward browsing follows the last visible row. Reverse continuation
      // still follows the first row and requires the existing real gesture.
      const visibleIndex = !isReversed && visible.height > 0
        ? Math.ceil((top + visible.height) / row) - 1
        : Math.floor(top / row);
      const index = Math.max(
        0,
        Math.min(
          count - 1,
          visibleIndex,
        ),
      );
      const position = isReversed ? count - 1 - index : index;
      const group = Math.floor(position / 20);
      const previous = last.current;
      if (
        previous?.group === group &&
        previous.count === count &&
        previous.reversed === isReversed
      )
        return;
      last.current = { group, count, reversed: isReversed };
      const renewed = gesture.current.active && !gesture.current.requested;
      gesture.current.requested = true;
      void (renewed ? request(index, { gesture: true }) : request(index))
        .catch(() => { last.current = null; });
  }, []);
  const previousRequest = useRef(prefetchAt);
  useEffect(() => {
    // A controller may become ready after layout (actual-playing, new queue).
    // Recheck its goal without needing a second scroll from the user.
    if (previousRequest.current !== prefetchAt) last.current = null;
    previousRequest.current = prefetchAt;
    if (!reversed) requestVisible();
  }, [itemCount, page.loading, page.hasMore, page.error, prefetchAt, reversed, requestVisible]);
  return {
    onScrollBeginDrag: () => {
      gesture.current = { active: true, requested: false };
      last.current = null;
    },
    onLayout: (event: LayoutChangeEvent) => {
      viewport.current = { top: viewport.current?.top ?? 0, height: event.nativeEvent.layout.height };
      if (!reversed) requestVisible();
    },
    onContentSizeChange: (_width: number, _height: number) => { if (!reversed) requestVisible(); },
    onScroll: (event: NativeScrollEvent) => {
      viewport.current = { top: Math.max(0, event.contentOffset.y), height: event.layoutMeasurement.height };
      requestVisible();
    },
  };
}
