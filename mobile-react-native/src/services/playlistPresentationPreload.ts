import type { Track } from '../domain/types';
import { trackCoverCandidates } from './onlineCatalog';
import { getTrackLyrics } from './onlineMusic';
import { loadDecodedCover } from './coverLoading';
import { preloadPlayerArtworkTone } from './playerAppearance';

type WaitForQueuePrewarm = () => Promise<void>;

/**
 * Warms the display-only parts of the currently published playback list.
 *
 * This deliberately runs one track at a time and waits for the queue URL lane
 * before every item. A newly published page therefore gets URL pre-resolution
 * priority; the display warm-up is restarted from the cache-safe beginning and
 * then continues through the newly available list in logical order.
 */
export function preloadPlaylistPresentation(
  tracks: Track[],
  waitForQueuePrewarm: WaitForQueuePrewarm,
) {
  let cancelled = false;
  let releaseCover: (() => void) | undefined;

  const warmCover = async (track: Track) => {
    for (const uri of trackCoverCandidates(track)) {
      if (cancelled) return;
      const request = loadDecodedCover(uri);
      const release = request.release;
      releaseCover = release;
      try {
        const decoded = await request.promise;
        if (!cancelled) await preloadPlayerArtworkTone(track, decoded.uri);
        return;
      } catch {
        // The cover component keeps its bundled fallback; try the next
        // provider-approved candidate before moving to lyrics.
      } finally {
        release();
        if (releaseCover === release) releaseCover = undefined;
      }
    }
  };

  const run = async () => {
    for (const track of tracks) {
      if (cancelled) return;
      await waitForQueuePrewarm();
      if (cancelled) return;
      await warmCover(track);
      if (cancelled) return;
      await waitForQueuePrewarm();
      if (cancelled) return;
      await getTrackLyrics(track).catch(() => []);
    }
  };
  void run().catch(() => undefined);

  return () => {
    cancelled = true;
    releaseCover?.();
    releaseCover = undefined;
  };
}
