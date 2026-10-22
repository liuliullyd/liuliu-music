import type { Track } from '../domain/types';
import { trackQueueKey } from '../domain/types';
/** Stable identity shared by the music list and its single player. */
export const mediaPlaybackKey = (track: Track) =>
  'music:' + trackQueueKey(track);
