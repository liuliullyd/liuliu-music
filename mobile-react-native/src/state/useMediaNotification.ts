import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { trackQueueKey, type NativePlayerState, type Track } from '../domain/types';
import { dispatchMediaNotificationAction, mediaNotification, navigationAvailability } from '../services/mediaNotification';
import { getTrackLyrics, trackLyricsKey } from '../services/onlineMusic';
import { CarPlayRequest } from '../services/carPlayRequest';

type Controls = {
  queue: Track[]; player: NativePlayerState; hasMore: boolean; reversed: boolean;
  ready: boolean; previous: () => Promise<void>; next: () => Promise<void>;
  cancelPreparation?: () => Promise<void>;
};

export function useMediaNotificationControls(props: Controls) {
  const latest = useRef(props);
  latest.current = props;
  const handled = useRef(new Set<string>());
  const enabled = Platform.OS === 'android' && props.ready && mediaNotification.available();
  const mediaId = props.player.mediaId || null;
  const available = navigationAvailability(props.queue, mediaId, props.hasMore, props.reversed);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let active: CarPlayRequest | undefined;
    const remove = mediaNotification.subscribeActions(async event => {
      const current = latest.current;
      if (!live || !current.ready || event.mediaId !== current.player.mediaId || handled.current.has(event.requestId)) return;
      handled.current.add(event.requestId);
      if (handled.current.size > 64) handled.current.delete(handled.current.values().next().value!);
      active?.cancel();
      const attempt = new CarPlayRequest(async () => {
        if (active === attempt) await current.cancelPreparation?.();
      }, async () => live && latest.current.ready);
      active = attempt;
      try { await attempt.run(() => dispatchMediaNotificationAction({ ...current, mediaId: current.player.mediaId }, event)); }
      catch { /* Shared preparation is cancelled; native request task still completes. */ }
      finally { if (active === attempt) active = undefined; }
    });
    return () => { active?.cancel(); live = false; remove(); mediaNotification.setNavigation(null, false, false).catch(() => undefined); };
  }, [enabled]);
  useEffect(() => {
    if (enabled) mediaNotification.setNavigation(mediaId, available.previous, available.next).catch(() => undefined);
  }, [enabled, mediaId, available.previous, available.next]);
}

let nextGeneration = 0;
type Request = { key: string; lyricKey: string; generation: string; begin: Promise<boolean>; started: boolean };

/** Fetch only the actually playing song. Native presentation reads its real position. */
export function useMediaNotificationLyrics(current: Track | null, player: NativePlayerState, startupVisible: boolean) {
  const request = useRef<Request | null>(null);
  const key = current ? trackQueueKey(current) : '';
  const lyricKey = current ? trackLyricsKey(current) : '';
  useEffect(() => {
    if (Platform.OS !== 'android' || startupVisible || !mediaNotification.lyricsAvailable()) return;
    let active = request.current;
    if (!current || !key) {
      if (active) {
        request.current = null;
        mediaNotification.beginLyrics(null, String(++nextGeneration)).catch(() => undefined);
      }
      return;
    }
    if (!active || active.key !== key || active.lyricKey !== lyricKey) {
      const generation = String(++nextGeneration);
      active = { key, lyricKey, generation, started: false,
        begin: mediaNotification.beginLyrics(key, generation).then(() => true, () => false) };
      request.current = active;
    }
    if (!player.playing || player.mediaId !== key || active.started) return;
    active.started = true;
    const selected = active;
    getTrackLyrics(current).then(async lines => {
      if (request.current !== selected || !(await selected.begin) || request.current !== selected) return;
      await mediaNotification.publishLyrics(selected.key, selected.generation, lines);
    }).catch(() => undefined);
  }, [current, key, lyricKey, player.playing, player.mediaId, startupVisible]);
  useEffect(() => () => {
    request.current = null;
    if (Platform.OS === 'android' && mediaNotification.lyricsAvailable())
      mediaNotification.beginLyrics(null, String(++nextGeneration)).catch(() => undefined);
  }, []);
}
