import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogItem } from '../domain/types';
import { loadPodcastCollections } from '../services/podcastDiscovery';
import { loadAudiobookCollections } from '../services/audiobookDiscovery';
import {
  copyMediaCursor,
  createMediaCursor,
  mediaProviders,
  type MediaCursor,
  type MediaKind,
} from '../services/mediaDiscoveryPaging';
import { useApp, useCatalogViewState } from './AppContext';

interface MediaSession<T> {
  items: T[];
  cursor: MediaCursor<T>;
  providers: ReturnType<typeof mediaProviders>;
  generation: number;
  initialized: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string;
  pending: number[];
  listeners: Set<() => void>;
}
const createSession = <T>(): MediaSession<T> => ({
  items: [],
  cursor: createMediaCursor<T>(),
  providers: [],
  generation: 0,
  initialized: false,
  loading: false,
  hasMore: true,
  error: '',
  pending: [],
  listeners: new Set(),
});

/** The Roam preview and More share only metadata, never a native playback queue. */
export function useLibraryMediaPages<T extends CatalogItem>(
  kind: MediaKind,
  surface: 'collections',
  enabled: boolean,
) {
  const app = useApp();
  const platforms = useRef(app.recommendationPlatforms);
  platforms.current = app.recommendationPlatforms;
  const [sessions, remember] = useCatalogViewState(
    `library-media-${surface}-sessions`,
    new Map<MediaKind, MediaSession<T>>(),
  );
  if (!sessions.has(kind)) sessions.set(kind, createSession<T>());
  const session = sessions.get(kind)!;
  const [, redraw] = useState(0);
  const providers = useMemo(
    () => mediaProviders(app.recommendationPlatforms, kind, true),
    [app.recommendationPlatforms, kind],
  );
  const publish = useCallback(
    () => session.listeners.forEach(listener => listener()),
    [session],
  );
  useEffect(() => {
    remember(sessions);
    const listener = () => redraw(value => value + 1);
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }, [remember, session, sessions]);
  const loadMore = useCallback(
    async (limit = 10) => {
      session.pending.push(limit);
      if (session.loading) return;
      const generation = session.generation;
      session.loading = true;
      publish();
      try {
        while (session.pending.length && generation === session.generation) {
          const size = session.pending.shift()!;
          if (session.initialized && !session.hasMore && !session.error)
            continue;
          const cursor = copyMediaCursor(session.cursor);
          const requestedProviders = mediaProviders(
            platforms.current,
            kind,
            true,
          );
          try {
            const result =
              kind === 'podcast'
                ? await loadPodcastCollections(
                    '热门播客',
                    1,
                    platforms.current,
                    size,
                    cursor as MediaCursor<CatalogItem>,
                  )
                : await loadAudiobookCollections(
                    '热门有声小说',
                    1,
                    platforms.current,
                    size,
                    cursor as MediaCursor<CatalogItem>,
                  );
            if (generation !== session.generation) return;
            session.initialized = true;
            session.error = result.errors.join('；');
            if (!result.items.length && session.error) {
              session.pending = [];
              break;
            }
            session.cursor = cursor;
            const keyed = new Map(
              session.items.map(item => [`${item.provider}:${item.id}`, item]),
            );
            for (const item of result.items as T[])
              keyed.set(`${item.provider}:${item.id}`, item);
            session.items = [...keyed.values()];
            session.hasMore =
              Boolean(result.hasMore) ||
              mediaProviders(platforms.current, kind, true).some(
                provider => !requestedProviders.includes(provider),
              );
            publish();
          } catch (error) {
            if (generation !== session.generation) return;
            session.initialized = true;
            session.error =
              error instanceof Error ? error.message : '内容暂时不可用';
            session.pending = [];
            break;
          }
        }
      } finally {
        if (generation === session.generation) {
          session.loading = false;
          publish();
        }
      }
    },
    [kind, publish, session],
  );
  useEffect(() => {
    // Later healthy providers join the next ordinary request without resetting
    // an existing cursor. Removed providers invalidate in-flight generations.
    if (session.providers.some(provider => !providers.includes(provider))) {
      session.generation += 1;
      session.items = [];
      session.cursor = createMediaCursor<T>();
      session.initialized = false;
      session.loading = false;
      session.hasMore = true;
      session.error = '';
      session.pending = [];
      publish();
    }
    if (providers.some(provider => !session.providers.includes(provider))) {
      session.hasMore = true;
      publish();
    }
    session.providers = providers;
    if (enabled && providers.length && !session.initialized && !session.loading)
      void loadMore();
  }, [enabled, loadMore, providers, publish, session]);
  return {
    items: session.items,
    loading: session.loading,
    initialized: session.initialized,
    hasMore: session.hasMore,
    error: session.error,
    loadMore,
  };
}
