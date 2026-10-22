import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';
import type { Track } from '../domain/types';
import { trackQueueKey } from '../domain/types';

export function useCollectionResumePosition(
  identity: string,
  target: string | null | undefined,
  tracks: Track[],
  pages: {
    loading: boolean;
    hasMore: boolean;
    error: string;
    offset: number;
    loadMore: () => Promise<void>;
  },
) {
  const { loading, hasMore, error, offset, loadMore } = pages;
  const scrollRef = useRef<ScrollView | null>(null);
  const session = useRef({
    identity: '',
    target: '',
    done: false,
    cancelled: false,
    requestedOffset: -1,
  });
  if (
    session.current.identity !== identity ||
    session.current.target !== (target ?? '')
  )
    session.current = {
      identity,
      target: target ?? '',
      done: false,
      cancelled: false,
      requestedOffset: -1,
    };
  const listY = useRef<number | null>(null);
  const controlsHeight = useRef(72);
  const rows = useRef(new Map<string, number>());
  const automaticScroll = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeeking = useCallback(
    () =>
      Boolean(
        session.current.target &&
          !session.current.done &&
          !session.current.cancelled,
      ),
    [],
  );
  const tryLocate = useCallback(() => {
    const value = session.current;
    const y = rows.current.get(value.target);
    if (
      !value.target ||
      value.done ||
      value.cancelled ||
      y === undefined ||
      listY.current === null ||
      !scrollRef.current
    )
      return;
    automaticScroll.current = true;
    scrollRef.current.scrollTo({
      y: Math.max(0, listY.current + y - controlsHeight.current - 12),
      animated: false,
    });
    value.done = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      automaticScroll.current = false;
    }, 350);
  }, []);
  useEffect(() => {
    listY.current = null;
    rows.current.clear();
  }, [identity, target]);
  useEffect(() => {
    const value = session.current;
    if (!value.target || value.cancelled || value.done) return;
    if (tracks.some(track => trackQueueKey(track) === value.target)) {
      tryLocate();
      return;
    }
    if (loading || error) return;
    if (!hasMore) {
      value.done = true;
      return;
    }
    if (value.requestedOffset === offset) return;
    value.requestedOffset = offset;
    loadMore().catch(() => undefined);
  }, [
    identity,
    target,
    tracks,
    loading,
    hasMore,
    error,
    offset,
    loadMore,
    tryLocate,
  ]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    scrollRef,
    automaticScroll,
    isSeeking,
    onListLayout: useCallback(
      (event: LayoutChangeEvent) => {
        listY.current = event.nativeEvent.layout.y;
        tryLocate();
      },
      [tryLocate],
    ),
    onControlsLayout: useCallback(
      (event: LayoutChangeEvent) => {
        controlsHeight.current = event.nativeEvent.layout.height;
        tryLocate();
      },
      [tryLocate],
    ),
    onRowLayout: useCallback(
      (key: string, event: LayoutChangeEvent) => {
        rows.current.set(key, event.nativeEvent.layout.y);
        tryLocate();
      },
      [tryLocate],
    ),
    cancel: useCallback(() => {
      session.current.cancelled = true;
      automaticScroll.current = false;
    }, []),
  };
}
