import { NativeEventEmitter, NativeModules } from 'react-native';
import { trackQueueKey, type Track } from '../domain/types';
import type { LyricLine } from './onlineMusic';
import { addCarLibraryTaskListener } from './carLibraryTasks';

export type MediaNotificationAction = {
  requestId: string;
  mediaId: string;
  action: 'previous' | 'next';
};

export async function dispatchMediaNotificationAction(props: {
  queue: Track[]; mediaId: string | null | undefined; hasMore: boolean; reversed: boolean; ready: boolean;
  previous: () => Promise<void>; next: () => Promise<void>;
}, event: MediaNotificationAction) {
  if (!props.ready || event.mediaId !== props.mediaId) return false;
  const available = navigationAvailability(props.queue, props.mediaId, props.hasMore, props.reversed);
  if (!available[event.action]) return false;
  try { await props[event.action](); return true; } catch { return false; }
}

/** Read-only availability from the logical list; it never prepares a native queue. */
export function navigationAvailability(
  queue: Track[], mediaId: string | null | undefined, hasMore: boolean, reversed: boolean,
) {
  const index = mediaId ? queue.findIndex(track => trackQueueKey(track) === mediaId) : -1;
  return {
    previous: index >= 0 && (index > 0 || (reversed && hasMore)),
    next: index >= 0 && (index < queue.length - 1 || (!reversed && hasMore)),
  };
}

const bridge = () => NativeModules.LiuliuPlayer;
export const mediaNotification = {
  available: () => typeof bridge()?.setMediaNotificationNavigation === 'function',
  lyricsAvailable: () => typeof bridge()?.beginMediaNotificationLyrics === 'function' &&
    typeof bridge()?.setMediaNotificationLyrics === 'function',
  async setNavigation(mediaId: string | null, previous: boolean, next: boolean) {
    await bridge()?.setMediaNotificationNavigation?.(mediaId, previous, next);
  },
  subscribeActions(listener: (event: MediaNotificationAction) => unknown) {
    const native = bridge();
    if (!native) return () => undefined;
    const receive = async (event: MediaNotificationAction) => {
      try {
      if (typeof event?.requestId !== 'string' || typeof event?.mediaId !== 'string' ||
        (event?.action !== 'previous' && event?.action !== 'next')) return;
      await listener(event);
      } finally { if (typeof event?.requestId === 'string') native.completeMediaNotificationAction?.(event.requestId); }
    };
    const subscription = new NativeEventEmitter(native).addListener('mediaNotificationAction', receive);
    const task = addCarLibraryTaskListener('mediaNotificationAction', receive);
    return () => { subscription.remove(); task.remove(); };
  },
  async beginLyrics(mediaId: string | null, generation: string) {
    await bridge()?.beginMediaNotificationLyrics?.(mediaId, generation);
  },
  async publishLyrics(mediaId: string, generation: string, lines: LyricLine[]) {
    await bridge()?.setMediaNotificationLyrics?.(mediaId, generation, lines.map(({ time, text }) => ({ time, text })));
  },
};
