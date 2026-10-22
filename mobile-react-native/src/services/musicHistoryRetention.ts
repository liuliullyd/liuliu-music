import { isRecommendationMusicTrack } from './recommendationContentPolicy';
import {
  trackQueueKey,
  type HistoryEntry,
  type PersistedState,
  type Track,
} from '../domain/types';
import { trackMediaKind } from './mediaLibrary';
export const RECENT_HISTORY_LIMIT = 100;
/** Shared persisted-history normalization; spoken-media buckets keep their existing policy. */
export function normalizePlaybackHistory(
  value: unknown,
  kind?: ReturnType<typeof trackMediaKind>,
  limit = RECENT_HISTORY_LIMIT,
): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value.filter((entry): entry is HistoryEntry =>
    Boolean(
      entry &&
        typeof entry === 'object' &&
        entry.track &&
        typeof entry.track.id === 'string' &&
        isRecommendationMusicTrack(entry.track) &&
        Number.isFinite(Number(entry.playedAt)),
    ),
  );
  const unique = new Map<string, HistoryEntry>();
  for (const entry of entries
    .filter(item => !kind || trackMediaKind(item.track) === kind)
    .sort((a, b) => Number(b.playedAt) - Number(a.playedAt))) {
    const key = `${trackMediaKind(entry.track)}:${trackQueueKey(entry.track)}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      ...entry,
      playedAt: Number(entry.playedAt),
      listenedSeconds: Math.max(0, Number(entry.listenedSeconds) || 0),
      completed: Boolean(entry.completed),
      skipped: Boolean(entry.skipped),
      ...(Number.isFinite(entry.positionSeconds)
        ? { positionSeconds: Math.max(0, entry.positionSeconds!) }
        : {}),
      ...(Number.isFinite(entry.playbackDurationSeconds)
        ? {
            playbackDurationSeconds: Math.max(
              0,
              entry.playbackDurationSeconds!,
            ),
          }
        : {}),
    });
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}
export function rememberMusicHistory(
  history: HistoryEntry[],
  track: Track,
): HistoryEntry[] {
  return normalizePlaybackHistory(
    [
      {
        track,
        playedAt: Date.now(),
        listenedSeconds: 0,
        completed: false,
        skipped: false,
      },
      ...history,
    ],
    'music',
  );
}
const sameHistory = (left: HistoryEntry[], right: HistoryEntry[]) =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry.track === other.track &&
      entry.playedAt === other.playedAt &&
      entry.listenedSeconds === other.listenedSeconds &&
      entry.completed === other.completed &&
      entry.skipped === other.skipped &&
      entry.positionSeconds === other.positionSeconds &&
      entry.playbackDurationSeconds === other.playbackDurationSeconds
    );
  });
/** Remove music records with no durable owner. Queue/audio state is deliberately outside this input. */
export function retainRecentMusicState(state: PersistedState): PersistedState {
  const recent = normalizePlaybackHistory(state.history, 'music');
  // A pre-migration mixed history must still reach storage's existing media split intact.
  const otherMedia = state.history.filter(entry => false);
  const nextHistory = [...recent, ...otherMedia];
  const history = sameHistory(state.history, nextHistory)
    ? state.history
    : nextHistory;
  const ids = new Set([
    ...state.favorites,
    ...state.playlists.flatMap(playlist => playlist.trackIds),
  ]);
  const keys = new Set([
    ...recent.map(entry => trackQueueKey(entry.track)),
    ...state.localTracks.map(trackQueueKey),
    ...state.downloads.map(entry => trackQueueKey(entry.track)),
  ]);
  const savedTracks = state.savedTracks.filter(
    track => ids.has(track.id) || keys.has(trackQueueKey(track)),
  );
  if (
    history === state.history &&
    savedTracks.length === state.savedTracks.length
  )
    return state;
  return { ...state, history, savedTracks };
}
