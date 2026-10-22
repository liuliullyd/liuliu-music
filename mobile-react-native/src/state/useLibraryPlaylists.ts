import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, useCatalogViewState } from './AppContext';
import {
  createLibraryPlaylistSnapshot,
  loadLibraryPlaylistBatch,
  type LibraryPlaylistSnapshot,
} from '../services/libraryPlaylists';

interface Session {
  providerKey: string;
  generation: number;
  snapshot: LibraryPlaylistSnapshot;
  initialized: boolean;
  loading: boolean;
  pending: number[];
  listeners: Set<() => void>;
}
const createSession = (): Session => ({
  providerKey: '',
  generation: 0,
  snapshot: createLibraryPlaylistSnapshot(),
  initialized: false,
  loading: false,
  pending: [],
  listeners: new Set(),
});

/** One process-only cursor shared by the Roam rail and its full directory. */
export function useLibraryPlaylists(enabled: boolean) {
  const app = useApp();
  const [session, rememberSession] = useCatalogViewState(
    'library-featured-session',
    createSession(),
  );
  const [, redraw] = useState(0);
  const firstPlatform = app.recommendationPlatforms.find(
    platform => platform.enabled && platform.id === app.startupHealth?.first,
  );
  const platforms = useMemo(() => firstPlatform ? [firstPlatform] : [], [firstPlatform]);
  const providerKey = platforms
    .filter(value => value.enabled)
    .map(value => value.id)
    .join('|');
  const publish = useCallback(
    () => session.listeners.forEach(listener => listener()),
    [session],
  );
  useEffect(() => {
    rememberSession(session);
    const listener = () => redraw(value => value + 1);
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }, [rememberSession, session]);
  const load = useCallback(
    async (limit = 10) => {
      session.pending.push(limit);
      if (session.loading) return;
      const generation = session.generation;
      session.loading = true;
      publish();
      try {
        while (session.pending.length && generation === session.generation) {
          const size = session.pending.shift()!;
          if (
            session.initialized &&
            !session.snapshot.hasMore &&
            !session.snapshot.error
          )
            continue;
          const priorCount = session.snapshot.items.length;
          const snapshot = await loadLibraryPlaylistBatch(
            session.snapshot,
            platforms,
            size,
          );
          if (generation !== session.generation) return;
          session.snapshot = snapshot;
          session.initialized = true;
          publish();
          if (snapshot.error && snapshot.items.length === priorCount) {
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
    [platforms, publish, session],
  );
  useEffect(() => {
    if (!enabled) return;
    if (session.providerKey !== providerKey) {
      session.generation += 1;
      session.providerKey = providerKey;
      session.snapshot = createLibraryPlaylistSnapshot();
      session.initialized = false;
      session.loading = false;
      session.pending = [];
    }
    if (!session.initialized && !session.loading) void load();
  }, [enabled, load, providerKey, session]);
  return { ...session.snapshot, loading: session.loading, loadMore: load };
}
