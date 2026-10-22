import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollViewProps } from 'react-native';

export const LIBRARY_RECORD_PAGE_SIZE = 20;

/** Local display paging only: persistence, counts and playback keep the full list. */
export function useLibraryRecordPages(identity: string, total: number) {
  const [page, setPage] = useState({ identity, count: LIBRARY_RECORD_PAGE_SIZE });
  const count = page.identity === identity ? page.count : LIBRARY_RECORD_PAGE_SIZE;
  useEffect(() => {
    setPage({ identity, count: LIBRARY_RECORD_PAGE_SIZE });
  }, [identity]);
  const lastBoundary = useRef({ identity, height: 0 });
  if (lastBoundary.current.identity !== identity)
    lastBoundary.current = { identity, height: 0 };
  const onScroll = useCallback<NonNullable<ScrollViewProps['onScroll']>>(
    event => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      if (!contentOffset || !layoutMeasurement || !contentSize ||
          contentOffset.y <= 0 || layoutMeasurement.height <= 0 ||
          contentSize.height <= 0 ||
          contentOffset.y + layoutMeasurement.height < contentSize.height - 24)
        return;
      if (lastBoundary.current.height === contentSize.height || count >= total) return;
      lastBoundary.current = { identity, height: contentSize.height };
      setPage({ identity, count: Math.min(total, count + LIBRARY_RECORD_PAGE_SIZE) });
    },
    [count, identity, total],
  );
  return { visibleCount: Math.min(count, total), onScroll };
}
