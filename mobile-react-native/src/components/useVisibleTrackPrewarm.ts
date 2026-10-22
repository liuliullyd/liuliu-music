import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent } from 'react-native';
import { trackQueueKey, type Track } from '../domain/types';
import type { UrlPrewarmOutcome } from '../services/urlPrewarmScheduler';

type DetailPrewarmResult = { key: string; outcome: UrlPrewarmOutcome };

/** Report measured visible rows below sticky controls to the shared scheduler. */
export function useVisibleTrackPrewarm({
  identity, enabled, tracks, bottomInset = 0, nestedList = false, prewarm, release,
}: {
  identity: string;
  enabled: boolean;
  tracks: Track[];
  bottomInset?: number;
  nestedList?: boolean;
  prewarm?: (visible: Track[], owner: object, onResult: (result: DetailPrewarmResult) => void) => Promise<void> | void;
  release?: (owner: object) => void;
}) {
  const create = () => ({
    identity, owner: {}, viewport: 0, offset: 0, listTop: null as number | null,
    topInset: 0, containerTop: nestedList ? null : 0, rows: new Map<string, { y: number; height: number }>(),
    visible: '' as string | null,
  });
  const metrics = useRef(create());
  const failures = useRef({ identity, keys: new Set<string>() });
  if (failures.current.identity !== identity)
    failures.current = { identity, keys: new Set() };
  const generation = useRef(0);
  const [, updateFailures] = useState(0);
  if (metrics.current.identity !== identity) {
    // The same ScrollView and same keyed rows need not emit layout again when
    // quality/source changes. Keep their real geometry, replace only ownership.
    metrics.current = { ...metrics.current, identity, owner: {}, visible: null, rows: new Map(metrics.current.rows) };
  }
  const owner = metrics.current.owner;
  const callbacks = useRef({ prewarm, release });
  callbacks.current = { prewarm, release };
  const [revision, update] = useState(0);
  const active = useRef(enabled);
  active.current = enabled;
  const changed = () => update(value => value + 1);
  const current = () => metrics.current.identity === identity ? metrics.current : null;

  useEffect(() => {
    active.current = enabled;
    const token = ++generation.current;
    if (!enabled) {
      metrics.current.visible = null;
      if (failures.current.keys.size) {
        failures.current.keys.clear();
        updateFailures(value => value + 1);
      }
      callbacks.current.release?.(owner);
      return;
    }
    return () => {
      active.current = false;
      if (generation.current === token) generation.current += 1;
      callbacks.current.release?.(owner);
    };
  }, [enabled, identity, owner]);

  useEffect(() => {
    const value = metrics.current;
    if (!enabled || value.listTop === null || value.containerTop === null || value.viewport <= 0) return;
    const top = value.offset + value.topInset;
    const bottom = value.offset + Math.max(0, value.viewport - bottomInset);
    if (bottom <= top) return;
    const visible: Track[] = [];
    const failed = failures.current.keys;
    // Wait for a contiguous measured prefix so reversed layout callbacks
    // cannot start a lower row ahead of the visible rows above it.
    for (const track of tracks) {
      if (failed.has(trackQueueKey(track))) continue;
      const row = value.rows.get(trackQueueKey(track));
      if (!row) return;
      const rowTop = value.containerTop + value.listTop + row.y;
      const rowBottom = rowTop + row.height;
      if (rowTop >= bottom) break;
      if (rowBottom > top) visible.push(track);
      if (rowBottom >= bottom) break;
    }
    const key = visible.map(trackQueueKey).join('|');
    if (value.visible === key) return;
    value.visible = key;
    const eligible = visible.filter(track => !failed.has(trackQueueKey(track)));
    const token = generation.current;
    const onResult = (result: DetailPrewarmResult) => {
      if (generation.current !== token ||
        metrics.current.identity !== identity || metrics.current.owner !== owner ||
        !active.current) return;
      if (result.outcome !== 'failed' || failures.current.keys.has(result.key)) return;
      failures.current.keys.add(result.key);
      updateFailures(currentRevision => currentRevision + 1);
    };
    Promise.resolve(callbacks.current.prewarm?.(eligible, owner, onResult)).catch(() => undefined);
  }, [bottomInset, enabled, identity, owner, revision, tracks]);

  return {
    rejectTrack: (key: string) => {
      if (!active.current || metrics.current.identity !== identity || metrics.current.owner !== owner || failures.current.keys.has(key)) return;
      failures.current.keys.add(key);
      metrics.current.visible = null;
      updateFailures(value => value + 1);
    },
    onLayout: (event: LayoutChangeEvent) => {
      const value = current();
      if (!value || !(event.nativeEvent.layout.height > 0)) return;
      value.viewport = event.nativeEvent.layout.height;
      changed();
    },
    onListLayout: (event: LayoutChangeEvent) => {
      const value = current();
      if (!value) return;
      value.listTop = event.nativeEvent.layout.y;
      changed();
    },
    onListContainerLayout: (event: LayoutChangeEvent) => {
      const value = current();
      if (!value) return;
      value.containerTop = event.nativeEvent.layout.y;
      changed();
    },
    onControlsLayout: (event: LayoutChangeEvent) => {
      const value = current();
      if (!value || !(event.nativeEvent.layout.height > 0)) return;
      value.topInset = event.nativeEvent.layout.height;
      changed();
    },
    onRowLayout: (key: string, event: LayoutChangeEvent) => {
      const value = current();
      if (!value || !(event.nativeEvent.layout.height > 0)) return;
      const { y, height } = event.nativeEvent.layout;
      value.rows.set(key, { y, height });
      changed();
    },
    onScroll: (event: NativeScrollEvent) => {
      const value = current();
      if (!value) return;
      value.offset = Math.max(0, event.contentOffset.y);
      if (event.layoutMeasurement.height > 0) value.viewport = event.layoutMeasurement.height;
      changed();
    },
    failedKeys: failures.current.identity === identity
      ? failures.current.keys as ReadonlySet<string>
      : new Set<string>() as ReadonlySet<string>,
  };
}
