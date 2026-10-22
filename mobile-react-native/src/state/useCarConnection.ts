import { useEffect, useRef } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { trackQueueKey, playbackModeFromSettings } from '../domain/types';
import type { useApp } from './AppContext';
import { nativePlayer } from '../services/nativePlayer';
import { carLibraryTracks } from '../services/carLibrary';
import { libraryUnavailableReason } from '../services/libraryPlayback';
import { CarSearch } from '../services/carSearch';
import { carCatalogDurationMs, carMediaFacts } from '../services/carMediaFacts';
import { useTheme } from '../theme';
import { addCarLibraryTaskListener } from '../services/carLibraryTasks';
import { CarPlayRequest } from '../services/carPlayRequest';

/** Every remote control executes the existing phone controller. */
export function useCarConnection(app: ReturnType<typeof useApp>, sharedSearch?: CarSearch) {
  const latest = useRef(app); latest.current = app;
  const ownSearch = useRef<CarSearch | null>(null);
  if (!ownSearch.current) ownSearch.current = new CarSearch();
  const search = sharedSearch ?? ownSearch.current;
  const theme = useTheme();
  const native = Platform.OS === 'android' ? NativeModules.LiuliuCarConnection : undefined;
  const ready = app.ready && !app.startup.visible;
  useEffect(() => {
    if (!native) return;
    native.foreground?.(AppState.currentState === 'active');
    const foreground = AppState.addEventListener('change', value => native.foreground?.(value === 'active'));
    let commands = Promise.resolve();
    let transportGeneration = 0;
    let live = true;
    let activeTransport: CarPlayRequest | undefined;
    const handle = async (event: { request: string }, generation: number) => {
      let id = '';
      try {
        const request = JSON.parse(event.request); id = request.id;
        const { action, args } = request;
        const transport = ['play', 'pause', 'stop', 'resume', 'seek', 'next', 'previous'].includes(action);
        const active = () => live && (!transport || generation === transportGeneration);
        if (!live) return;
        if (native.isRequestActive && !(await native.isRequestActive(id))) return;
        const current = latest.current;
        if (!active()) throw new Error('播放操作已被后续暂停或停止取消');
        if ((!current.ready || current.startup.visible) && action !== 'pause' && action !== 'stop') throw new Error('请先完成手机端启动');
        if (args.mediaId && args.mediaId !== current.player.mediaId) throw new Error('歌曲已改变');
        if (['play', 'seek', 'next', 'previous'].includes(action) && !current.current) throw new Error('没有当前歌曲');
        let result: unknown = { accepted: true };
        let details: { hasMore?: boolean; scope?: string } = {};
        const prepare = async (work: () => Promise<void>) => {
          const attempt = new CarPlayRequest(async () => {
            if (activeTransport === attempt) await current.setPlaybackPlaying(false);
          }, async () => active() && (!native.isRequestActive || await native.isRequestActive(id)));
          activeTransport = attempt;
          try { await attempt.run(work); }
          finally { if (activeTransport === attempt) activeTransport = undefined; }
        };
        switch (action) {
          case 'play': await prepare(() => current.setPlaybackPlaying(true)); break;
          case 'pause': await current.setPlaybackPlaying(false); break;
          case 'stop': await current.setPlaybackPlaying(false); await nativePlayer.stop(); break;
          case 'resume': {
            const snapshot = { state: current.state, queue: current.queue, current: current.current,
              providers: new Set(current.recommendationPlatforms.filter(p => p.enabled).map(p => p.id)) };
            const queue = carLibraryTracks(snapshot, 'car:queue');
            const selected = current.current
              ? queue.find(track => trackQueueKey(track) === trackQueueKey(current.current!))
              : queue.find(track => !libraryUnavailableReason(track, snapshot.providers)) ??
                carLibraryTracks(snapshot, 'car:history').find(track => !libraryUnavailableReason(track, snapshot.providers));
            if (!selected) throw new Error('没有可恢复的音乐，请先在手机选择歌曲');
            const unavailable = libraryUnavailableReason(selected, snapshot.providers);
            if (unavailable) throw new Error(unavailable);
            const key = trackQueueKey(selected);
            if (current.player.mediaId === key && !current.player.error) await prepare(() => current.setPlaybackPlaying(true));
            else {
              const tracks = current.queue.length ? current.queue : [selected];
              const index = tracks.findIndex(track => trackQueueKey(track) === key);
              await prepare(() => current.playTrack(selected, tracks, index, { openPlayer: false }));
            }
            if (!active()) throw new Error('播放恢复已取消');
            if (native.isRequestActive && !(await native.isRequestActive(id))) throw new Error('播放恢复请求已失效');
            const actual = await nativePlayer.getState();
            if (!active() || !latest.current.ready || latest.current.startup.visible) throw new Error('播放恢复已取消');
            if (actual.mediaId !== key || actual.error) throw new Error(actual.error || '恢复歌曲未提交到播放器');
            result = { mediaId: key };
            break;
          }
          case 'next': await prepare(() => current.next()); break;
          case 'previous': await prepare(() => current.previous()); break;
          case 'seek': if (!Number.isFinite(args.seconds) || args.seconds < 0) throw new Error('无效进度'); await current.seek(args.seconds); break;
          case 'favorite':
            if (!current.current) throw new Error('没有当前歌曲');
            if (typeof args.value === 'boolean') current.toggleFavorite(current.current, args.value);
            else current.toggleFavorite(current.current);
            break;
          case 'mode':
            if (!['sequence', 'shuffle', 'repeat-one'].includes(args.mode)) throw new Error('未知播放模式');
            await current.setPlaybackMode(args.mode); break;
          case 'search': {
            if (args.scope !== 'local-library') {
              const page = await search.search(current.recommendationPlatforms, args.query, args.page ?? 0,
                String(args.session ?? 'local'), args.reset === true);
              if (!live || (native.isRequestActive && !(await native.isRequestActive(id)))) { search.invalidate(); return; }
              result = page.items; details = { hasMore: page.hasMore, scope: page.scope }; break;
            }
            const query = String(args.query ?? '').trim().toLocaleLowerCase();
            if (!query || query.length > 160) throw new Error('请输入搜索词');
            const snapshot = { state: current.state, queue: current.queue, current: current.current,
              providers: new Set(current.recommendationPlatforms.filter(p => p.enabled).map(p => p.id)) };
            const seen = new Set<string>();
            const rows = ['car:queue', 'car:favorites', 'car:history', ...current.state.playlists.map(p => `car:playlist:${encodeURIComponent(p.id)}`)]
              .flatMap(parent => carLibraryTracks(snapshot, parent).flatMap(track => {
                const key = trackQueueKey(track);
                if (seen.has(key) || !`${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query)) return [];
                seen.add(key);
                return [{ id: `car:track:${encodeURIComponent(parent)}:${encodeURIComponent(key)}`, title: track.title, artist: track.artist,
                  album: track.album, durationMs: carCatalogDurationMs(track), cover: track.cover, parent,
                  browsable: false, playable: !libraryUnavailableReason(track, snapshot.providers) }];
              }));
            const page = Number(args.page) || 0;
            if (!Number.isSafeInteger(page) || page < 0) throw new Error('无效页码');
            result = rows.slice(page * 20, (page + 1) * 20);
            details = { hasMore: (page + 1) * 20 < rows.length, scope: 'local-library' }; break;
          }
          default: throw new Error('不支持的车载操作');
        }
        if (!active()) throw new Error('播放操作已取消');
        native.complete(id, JSON.stringify({ ok: true, result, ...details }));
      } catch (error) { if (id) native.complete(id, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '操作失败' })); }
    };
    const receive = (event: { request: string }) => {
      // A pause/stop must cancel preparation immediately, even while resume is awaiting audio.
      let action = '';
      try { action = JSON.parse(event.request).action; } catch { /* handle reports malformed requests */ }
      if (action === 'pause' || action === 'stop') { activeTransport?.cancel(); return handle(event, ++transportGeneration); }
      const generation = transportGeneration;
      commands = commands.then(() => handle(event, generation)); return commands;
    };
    const subscription = new NativeEventEmitter(native).addListener('carConnectionRequest', receive);
    const task = addCarLibraryTaskListener('carConnectionRequest', receive);
    return () => { activeTransport?.cancel(); live = false; transportGeneration++; search.invalidate(); subscription.remove(); task.remove(); foreground.remove(); };
  }, [native, search]);
  const favorite = app.current ? app.isFavorite?.(app.current) ?? false : false;
  const mode = playbackModeFromSettings(app.state.settings);
  const actualMediaId = app.player?.mediaId ?? '';
  const track = app.current && trackQueueKey(app.current) === actualMediaId ? app.current : undefined;
  // A newly selected row can precede the native commit. Never attach its rights to the old native song.
  const mediaId = track ? actualMediaId : '';
  useEffect(() => {
    if (!native) return;
    native.publish(JSON.stringify({ ready, mediaId,
      title: track?.title ?? '', artist: track?.artist ?? '', album: track?.album ?? '',
      cover: track?.cover ?? '', favorite, mode, bg: theme.bg, text: theme.text, accent: theme.accent,
      ...carMediaFacts(track) }));
  }, [native, ready, mediaId, track, favorite, mode, theme]);
}
