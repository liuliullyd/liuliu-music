import type { Track } from '../domain/types';
import {
  getCachedTrackLyrics,
  getTrackLyrics,
  trackLyricsKey,
  type LyricLine,
} from './onlineMusic';

let generation = 0;
let queued: Track[] = [];
let running = false;
const listeners = new Map<string, Set<(lines: LyricLine[]) => void>>();

/** Presentation subscribers never start a request or occupy a background slot. */
export function subscribePlayerLyrics(
  track: Track,
  listener: (lines: LyricLine[]) => void,
) {
  const key = trackLyricsKey(track);
  const entries = listeners.get(key) ?? new Set();
  entries.add(listener);
  listeners.set(key, entries);
  const cached = getCachedTrackLyrics(track);
  if (cached) listener(cached);
  return () => {
    entries.delete(listener);
    if (!entries.size) listeners.delete(key);
  };
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queued.length) {
      const track = queued.shift()!;
      if (getCachedTrackLyrics(track)) continue;
      // Only neighbouring lyric requests share this single background slot.
      // The current song reads the existing lyric service directly.
      const lines = await getTrackLyrics(track).catch(() => undefined);
      if (lines)
        listeners.get(trackLyricsKey(track))?.forEach(listener => listener(lines));
    }
  } finally {
    running = false;
  }
}

export function preloadPlayerLyrics(tracks: Track[]) {
  const token = ++generation;
  const seen = new Set<string>();
  queued = tracks.filter(track => {
    const key = trackLyricsKey(track);
    if (seen.has(key) || getCachedTrackLyrics(track)) return false;
    seen.add(key);
    return true;
  });
  drain().catch(() => undefined);
  return () => {
    if (generation !== token) return;
    generation += 1;
    queued = [];
  };
}
