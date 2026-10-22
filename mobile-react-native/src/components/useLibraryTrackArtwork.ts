import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlatformSetting, Track } from '../domain/types';
import { localPlaybackReference } from '../services/libraryPlayback';
import {
  cachedLibraryArtwork,
  getLibraryTrackArtwork,
  libraryArtworkKey,
} from '../services/libraryTrackArtwork';
import {
  playerCoverCandidates,
  trackCoverCandidates,
} from '../services/onlineCatalog';

const noPlatforms: PlatformSetting[] = [];

/** Both player surfaces share one lookup; inactive/pre-mounted songs issue no requests. */
export function useLibraryTrackArtwork(
  track: Track | null,
  platforms: PlatformSetting[] = noPlatforms,
) {
  const key = track ? libraryArtworkKey(track, platforms) : '';
  const currentKey = useRef(key);
  currentKey.current = key;
  const [supplement, setSupplement] = useState({
    key: '',
    uris: [] as string[],
  });
  const existing = track
    ? localPlaybackReference(track)
      ? playerCoverCandidates(track)
      : trackCoverCandidates(track)
    : [];
  const request = useCallback(
    (exhausted = false) => {
      if (!track || !localPlaybackReference(track)) return;
      void getLibraryTrackArtwork(track, platforms, exhausted).then(uris => {
        if (currentKey.current === key) setSupplement({ key, uris });
      });
    },
    [key, platforms, track],
  );
  useEffect(() => {
    currentKey.current = key;
    if (!existing.length) request();
    return () => {
      currentKey.current = '';
    };
  }, [existing.length, key, request]);
  const cached = track ? cachedLibraryArtwork(track, platforms) ?? [] : [];
  const candidates = Array.from(
    new Set([
      ...existing,
      ...(supplement.key === key ? supplement.uris : cached),
    ]),
  );
  return {
    uri: candidates[0],
    fallbackUris: candidates.slice(1),
    onExhausted: () => request(true),
  };
}
