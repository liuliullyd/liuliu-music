import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppSettings, NativePlayerState, Track } from '../domain/types';
import { trackQueueKey } from '../domain/types';
import { getTrackLyrics } from '../services/onlineMusic';
import { desktopLyrics } from '../services/desktopLyrics';

/** Presentation only. The existing controller owns every playback action. */
export function useDesktopLyrics(settings: AppSettings | undefined, current: Track | null,
  player: NativePlayerState, favorite: boolean, actions: {
    toggle: () => unknown; jump: (direction: -1 | 1) => unknown;
    seek: (seconds: number) => unknown; favorite: () => unknown;
    denied: () => void;
    close: () => void;
  }) {
  const actionRef = useRef(actions);
  actionRef.current = actions;
  const enabled = settings?.desktopLyricsEnabled === true;
  const settingsAvailable = settings !== undefined;
  useEffect(() => {
    let live = true;
    const apply = async () => {
      const closed = await desktopLyrics.wasClosed();
      if (!live) return;
      if (closed && enabled) {
        actionRef.current.close();
        await desktopLyrics.configure(false, settings?.desktopLyricsStyle ?? 'center', settings?.accent ?? '#A56B35');
        return;
      }
      if (enabled) {
        const granted = await desktopLyrics.canDraw();
        if (!live) return;
        if (!granted) { actionRef.current.denied(); return; }
      }
      await desktopLyrics.configure(enabled, settings?.desktopLyricsStyle ?? 'center', settings?.accent ?? '#A56B35');
      if (live && settingsAvailable && !enabled) await desktopLyrics.acknowledgeClose();
    };
    void apply().catch(() => { if (live) actionRef.current.denied(); });
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') void apply().catch(() => undefined); });
    return () => { live = false; subscription.remove(); };
  }, [enabled, settingsAvailable, settings?.desktopLyricsStyle, settings?.accent]);
  useEffect(() => () => { void desktopLyrics.configure(false, 'center', '#A56B35'); }, []);
  useEffect(() => desktopLyrics.subscribe(event => {
    const action = actionRef.current;
    try {
      const result = event.action === 'close' ? action.close() : event.action === 'toggle' ? action.toggle() : event.action === 'next' ? action.jump(1)
        : event.action === 'previous' ? action.jump(-1) : event.action === 'favorite' ? action.favorite()
        : event.action === 'seek' && Number.isFinite(event.value) ? action.seek(event.value!) : undefined;
      void Promise.resolve(result).catch(() => undefined);
    } catch { /* Existing controller reports playback failures. */ }
  }), []);
  const key = current ? trackQueueKey(current) : '';
  useEffect(() => {
    if (!enabled || !current || !key || player.mediaId !== key) return;
    let live = true;
    const song = { id: key, title: current.title, artist: current.artist, cover: current.cover, favorite };
    void desktopLyrics.setSong({ ...song, lines: [] });
    void getTrackLyrics(current).then(lines => { if (live) void desktopLyrics.setSong({ ...song, lines }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [enabled, key, current, player.mediaId, favorite]);
}

export function DesktopLyricsBridge(props: {
  settings?: AppSettings; current: Track | null; player: NativePlayerState; favorite: boolean;
  actions: Parameters<typeof useDesktopLyrics>[4];
}) {
  useDesktopLyrics(props.settings, props.current, props.player, props.favorite, props.actions);
  return null;
}
