import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent } from 'react-native';
import { prefetchListBottom } from './ListPaging';

/** Maintain a viewport-sized lead without waiting for another scroll event. */
export function useListPrefetch(
  loadMore: () => Promise<void>,
  { loading, hasMore, error }: { loading: boolean; hasMore: boolean; error: string },
) {
  const metrics = useRef({ height: 0, contentHeight: 0, y: 0 });
  const request = useCallback(() => {
    const { height, contentHeight, y } = metrics.current;
    if (loading || !hasMore || error || !height || !contentHeight) return;
    if (prefetchListBottom({
      contentOffset: { x: 0, y },
      layoutMeasurement: { width: 0, height },
      contentSize: { width: 0, height: contentHeight },
    } as NativeScrollEvent)) void Promise.resolve(loadMore()).catch(() => undefined);
  }, [error, hasMore, loadMore, loading]);
  // Content may grow during an active request. Recheck after its guard releases,
  // using the new content height so a stale near-bottom latch cannot drain the
  // entire remote catalog while the viewport remains stationary.
  useEffect(request, [request]);
  return {
    onScroll: useCallback((event: NativeScrollEvent) => {
      metrics.current = {
        height: event.layoutMeasurement.height,
        contentHeight: event.contentSize.height,
        y: Math.max(0, event.contentOffset.y),
      };
      request();
    }, [request]),
    onLayout: useCallback((event: LayoutChangeEvent) => {
      metrics.current.height = event.nativeEvent.layout.height;
      request();
    }, [request]),
    onContentSizeChange: useCallback((_width: number, height: number) => {
      metrics.current.contentHeight = height;
      request();
    }, [request]),
  };
}
