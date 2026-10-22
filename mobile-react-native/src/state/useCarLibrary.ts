import { useEffect, useRef } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { useApp } from './AppContext';
import { carLibraryPage, carLibraryRevision, carLibrarySelection, type CarLibrarySnapshot } from '../services/carLibrary';
import { CarLinkedPlaylists, isCarLinkedParent } from '../services/carLinkedPlaylists';
import { useCarConnection } from './useCarConnection';
import { nativePlayer } from '../services/nativePlayer';
import { trackQueueKey } from '../domain/types';
import { CarSearch, isCarSearchParent } from '../services/carSearch';
import { CarHomeMenus, isCarHomeMenuParent } from '../services/carHomeMenus';
import { addCarLibraryTaskListener } from '../services/carLibraryTasks';
import { CarPlayRequest } from '../services/carPlayRequest';
import { CarPlatformPlaylists, isCarPlatformParent } from '../services/carPlatformPlaylists';

type App = ReturnType<typeof useApp>;
export function useCarLibrary(app: App) {
  const searchRef = useRef<CarSearch | null>(null);
  if (!searchRef.current) searchRef.current = new CarSearch();
  const search = searchRef.current;
  useCarConnection(app, search);
  const latest = useRef(app); latest.current = app;
  const revision = useRef<string | undefined>(undefined);
  const enabled = Platform.OS === 'android' && app.ready && !app.startup.visible;
  const providers = app.recommendationPlatforms.filter(item => item.enabled).map(item => item.id).sort().join(',');
  const configurationKey = app.catalogConfigurationKey;
  const firstProvider = app.startupHealth?.first;
  const currentTrack = app.current;
  useEffect(() => { search.invalidate(); }, [search, enabled, providers, configurationKey]);
  useEffect(() => {
    const native = NativeModules.LiuliuMediaLibrary;
    if (!native?.setLibraryReady) return;
    if (!enabled) { native.setLibraryReady(false); return; }
    let live = true;
    const handled = new Set<string>();
    let activePlay: CarPlayRequest | undefined;
    const catalog = new CarPlatformPlaylists();
    const linked = new CarLinkedPlaylists(parent => catalog.reference(snapshot(), parent));
    const menus = new CarHomeMenus();
    const snapshot = (): CarLibrarySnapshot => {
      const current = latest.current;
      return { state: current.state, queue: current.queue, current: current.current,
        providers: new Set(current.recommendationPlatforms.filter(item => item.enabled).map(item => item.id)),
        recommendationPlatforms: current.recommendationPlatforms, firstProvider: current.startupHealth?.first,
        configurationKey: current.catalogConfigurationKey };
    };
    const emitter = new NativeEventEmitter(native);
    const listen = (name: 'carLibraryRequest' | 'carLibraryPlay', handler: (request: any) => Promise<void>) => {
      const event = emitter.addListener(name, handler);
      const task = addCarLibraryTaskListener(name, handler);
      return { remove() { event.remove(); task.remove(); } };
    };
    const browse = listen('carLibraryRequest', async request => {
      if (!live || !latest.current.ready || latest.current.startup.visible || typeof request?.requestId !== 'string') return;
      try {
        const items = isCarPlatformParent(request.parent) ? await catalog.browse(snapshot(), request.parent, request.page, request.pageSize) : isCarHomeMenuParent(request.parent) ? await menus.browse(snapshot(), request.parent, request.page, request.pageSize) : isCarLinkedParent(request.parent)
          ? await linked.browse(snapshot(), request.parent, request.page, request.pageSize)
          : carLibraryPage(snapshot(), request.parent, request.page, request.pageSize);
        if (live) native.completeLibraryRequest(request.requestId, items);
      } catch (error) {
        if (live) native.failLibraryRequest(request.requestId,
          error instanceof Error ? error.message : '车机曲库读取失败，请重试');
      }
    });
    const play = listen('carLibraryPlay', async request => {
      if (!live || typeof request?.requestId !== 'string' || handled.has(request.requestId)) return;
      handled.add(request.requestId); if (handled.size > 64) handled.delete(handled.values().next().value!);
      let ok = false;
      let message = '点歌请求已失效';
      activePlay?.cancel();
      let preparing = false;
      const attempt = new CarPlayRequest(async () => {
        if (preparing && activePlay === attempt) await latest.current.setPlaybackPlaying(false);
      }, async () => live && (!native.isLibrarySelectionActive || await native.isLibrarySelectionActive(request.requestId)));
      activePlay = attempt;
      try {
        await attempt.run(async () => {
        if (native.isLibrarySelectionActive && !(await native.isLibrarySelectionActive(request.requestId))) return;
        const current = latest.current;
        if (!current.ready || current.startup.visible) return;
        const online = isCarSearchParent(request.parent)
          ? search.selection(snapshot(), current.recommendationPlatforms, request.parent, request.mediaId) : null;
        if (online && NativeModules.LiuliuCarConnection?.isSearchSessionActive &&
          !(await NativeModules.LiuliuCarConnection.isSearchSessionActive(online.session))) {
          search.invalidate(); throw new Error('搜索连接已失效，请重新搜索');
        }
        const remote = isCarLinkedParent(request.parent) ? linked.selection(snapshot(), request.parent, request.mediaId) : null;
        const menu = isCarHomeMenuParent(request.parent) ? menus.selection(snapshot(), request.parent, request.mediaId) : null;
        const selection = isCarSearchParent(request.parent) ? online : isCarHomeMenuParent(request.parent) ? menu : remote ?? carLibrarySelection(snapshot(), request.parent, request.mediaId);
        if (!selection) throw new Error('该歌曲当前不可用，请在手机检查歌单和平台状态');
        if (native.isLibrarySelectionActive && !(await native.isLibrarySelectionActive(request.requestId))) return;
        attempt.assertActive();
        if (!latest.current.ready || latest.current.startup.visible) return;
        if (online && !search.selection(snapshot(), latest.current.recommendationPlatforms, request.parent, request.mediaId))
          throw new Error('搜索结果已失效，请重新搜索');
        if (menu) current.rememberHomeMenuBatch?.(menu.queueSource.cursor, menu.tracks);
        preparing = true;
        await current.playTrack(selection.track, selection.tracks, selection.index,
          { openPlayer: false, ...(menu ? { queueSource: menu.queueSource, ...(menu.scene ? { allowFailureFallback: true } : {}) } : online ? { queueSource: online.queueSource } : remote ? { historyOrigin: { item: remote.item }, queueSource: remote.queueSource }
            : 'historyOrigin' in selection && selection.historyOrigin ? { historyOrigin: selection.historyOrigin } : {}) });
        const actual = await nativePlayer.getState();
        attempt.assertActive();
        if (actual.mediaId !== trackQueueKey(selection.track) || actual.error) throw new Error(actual.error || '所选歌曲未提交到播放器');
        ok = true; message = '';
        });
      } catch (error) { message = error instanceof Error ? error.message : '车机点歌失败'; latest.current.notify(message); }
      finally { if (activePlay === attempt) activePlay = undefined; native.completeLibrarySelection(request.requestId, ok, message); }
    });
    native.setLibraryReady(true);
    return () => { activePlay?.cancel(); live = false; linked.close(); menus.close(); catalog.close(); native.setLibraryReady(false); browse.remove(); play.remove(); };
  }, [enabled, search, configurationKey, firstProvider, providers]);
  useEffect(() => {
    if (!enabled) { revision.current = undefined; return; }
    const current = latest.current;
    const next = carLibraryRevision({ state: current.state, queue: current.queue, current: current.current,
      providers: new Set(current.recommendationPlatforms.filter(item => item.enabled).map(item => item.id)),
      firstProvider: current.startupHealth?.first, configurationKey: current.catalogConfigurationKey });
    if (revision.current !== undefined && revision.current !== next) NativeModules.LiuliuMediaLibrary?.notifyLibraryChanged?.();
    revision.current = next;
  }, [enabled, providers, configurationKey, firstProvider, app.state.platforms, app.state.playlists, app.state.importedPlaylists, app.state.favorites,
    app.state.savedCollections, app.state.favoriteCollections, app.state.profile,
    app.state.savedTracks, app.state.localTracks, app.state.downloads, app.state.history, app.queue, currentTrack]);
}
