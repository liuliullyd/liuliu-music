import { useCallback, useEffect, useRef } from 'react';
import type { Track } from '../domain/types';
import { mediaPlaybackKey } from '../services/mediaPlaybackProgress';

/** Follow metadata identity, including native/logical index shifts, without touching audio. */
export function usePlaybackListFollow(
  queue: Track[],
  current: Track | null,
  enabled: boolean,
  onLocate: (index: number) => boolean,
  orderVersion = 0,
) {
  const key = current ? mediaPlaybackKey(current) : '';
  const index = key
    ? queue.findIndex(track => mediaPlaybackKey(track) === key)
    : -1;
  const previousOrder = useRef(orderVersion);
  const manualOrderKey = useRef('');
  if (previousOrder.current !== orderVersion) {
    previousOrder.current = orderVersion;
    manualOrderKey.current = key;
  }
  const latest = useRef({ key, index, enabled, onLocate });
  latest.current = { key, index, enabled, onLocate };
  const ready = useRef(false);
  const located = useRef('');
  const automaticScroll = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locate = useCallback(() => {
    const value = latest.current;
    const target = `${value.key}:${value.index}`;
    if (
      !value.enabled ||
      manualOrderKey.current === value.key ||
      !ready.current ||
      value.index < 0 ||
      located.current === target
    )
      return;
    automaticScroll.current = true;
    if (!value.onLocate(value.index)) {
      automaticScroll.current = false;
      return;
    }
    located.current = target;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      automaticScroll.current = false;
    }, 350);
  }, []);
  useEffect(() => {
    if (!enabled) {
      ready.current = false;
      located.current = '';
      manualOrderKey.current = '';
      automaticScroll.current = false;
    } else locate();
  }, [enabled, key, index, locate, onLocate]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    automaticScroll,
    onLayout: useCallback(() => {
      ready.current = true;
      locate();
    }, [locate]),
    onContentSizeChange: locate,
    onScrollBeginDrag: useCallback(() => {
      automaticScroll.current = false;
    }, []),
    locate,
  };
}
