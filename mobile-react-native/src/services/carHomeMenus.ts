import { trackQueueKey, type Track } from '../domain/types';
import { HOME_MENU_CHOICES, loadHomeMenuFirstBatch, loadHomeMenuPage, type HomeMenuCursor } from './homeMenuDiscovery';
import { advanceExhaustedMenuRound, menuProgressEntry } from './homeMenuProgress';
import { favoriteStatisticsFor } from './musicPreferenceStatistics';
import { constituentArtists } from './liveDiscovery';
import { shuffleHomeMenuSceneValues } from './homeMenuSceneOrder';
import { libraryPlaybackTrack, libraryUnavailableReason } from './libraryPlayback';
import { carCatalogDurationMs } from './carMediaFacts';
import type { CarLibraryItem, CarLibrarySnapshot } from './carLibrary';

const PREFIX = 'car:menu:';
export const carHomeMenuParent = (choice: string, page = 0) => `${PREFIX}${encodeURIComponent(choice)}:${page}`;
export const isCarHomeMenuParent = (parent: string) => parent.startsWith(PREFIX);
export function carHomeMenuFolders(parent: string): CarLibraryItem[] {
  const kind = parent === 'car:recommendations' ? 'mode' : 'scene';
  return HOME_MENU_CHOICES.filter(choice => choice.kind === kind).map(choice => ({
    id: carHomeMenuParent(choice.id), title: choice.label, parent, browsable: true, playable: false,
  }));
}
type Page = { tracks: Track[]; cursor: HomeMenuCursor; hasMore: boolean; initialRemaining: number; artists: string[] };
type Flight = { abort: AbortController; promise: Promise<void> };

/** Explicit metadata browsing uses the phone's playlist selector and cursor; it never resolves audio. */
export class CarHomeMenus {
  private pages = new Map<string, Page>();
  private active = new Map<string, Flight>();
  private closed = false;
  private configuration: string | undefined;
  private synchronize(snapshot: CarLibrarySnapshot) {
    const configuration = JSON.stringify([snapshot.configurationKey, snapshot.firstProvider,
      (snapshot.recommendationPlatforms ?? snapshot.state.platforms).filter(value => value.enabled && snapshot.providers.has(value.id)).map(value => value.id)]);
    if (this.configuration !== configuration) {
      this.configuration = configuration;
      this.active.forEach(flight => flight.abort.abort()); this.active.clear(); this.pages.clear();
    }
  }
  private reference(parent: string) {
    const match = /^car:menu:([^:]+):(\d+)$/.exec(parent);
    if (!match) return null;
    const choice = HOME_MENU_CHOICES.find(value => value.id === decodeURIComponent(match[1]!));
    const page = Number(match[2]);
    return choice && Number.isSafeInteger(page) && page >= 0 && page <= 10000 ? { choice, page } : null;
  }
  async browse(snapshot: CarLibrarySnapshot, parent: string, page: number, pageSize: number): Promise<CarLibraryItem[]> {
    if (this.closed || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return [];
    this.synchronize(snapshot);
    const reference = this.reference(parent);
    if (!reference) return [];
    if (!this.pages.has(parent)) {
      let flight = this.active.get(parent);
      if (!flight) {
        const abort = new AbortController();
        const promise = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let timedOut = false;
          let removeAbort = () => {};
          try {
            const work = async () => {
              const platforms = (snapshot.recommendationPlatforms ?? snapshot.state.platforms).filter(value => value.enabled && snapshot.providers.has(value.id));
              const platform = platforms.find(value => value.id === snapshot.firstProvider) ?? platforms[0];
              if (!platform) throw new Error('本次启动没有可用的音乐平台');
              const previous = reference.page ? this.pages.get(carHomeMenuParent(reference.choice.id, reference.page - 1)) : undefined;
              if (reference.page && (!previous || !previous.hasMore)) throw new Error('分类上页已失效，请重新打开分类');
              const profile = reference.choice.id === 'mode-default'
                ? { ...snapshot.state.profile, favoriteStatistics: favoriteStatisticsFor(snapshot.state) } : snapshot.state.profile;
              const result = previous
                ? await loadHomeMenuPage(reference.choice.id, [platform], profile, snapshot.state.history,
                  previous.initialRemaining || 20, previous.cursor, { signal: abort.signal,
                    excludedArtists: previous.initialRemaining ? previous.artists : undefined, catalogBudgetMs: 8000 })
                : await loadHomeMenuFirstBatch(reference.choice.id, [platform], profile, snapshot.state.history, {
                  signal: abort.signal, progress: advanceExhaustedMenuRound(menuProgressEntry(snapshot.state.menuRecommendationProgress, reference.choice.id, platform.id)),
                  catalogBudgetMs: 8000, firstSceneBudgetMs: 8000,
                });
              if (this.closed || abort.signal.aborted) throw new Error('分类目录读取已取消');
              const tracks = (reference.choice.kind === 'scene' && !previous ? shuffleHomeMenuSceneValues(result.tracks) : result.tracks)
                .map(({ playUrl: _url, ...track }) => track);
              const initialRemaining = previous ? Math.max(0, previous.initialRemaining - tracks.length) : Math.max(0, 20 - tracks.length);
              const artists = initialRemaining ? [...new Set([...(previous?.artists ?? []), ...tracks.flatMap(track => constituentArtists(track.artist))])] : [];
              this.pages.set(parent, { tracks, cursor: result.cursor, hasMore: result.hasMore, initialRemaining, artists });
              if (this.pages.size > 32) this.pages.delete(this.pages.keys().next().value!);
            };
            await Promise.race([work(), new Promise<never>((_resolve, reject) => {
              const cancelled = () => reject(new Error(timedOut ? '分类目录读取超时，请重试' : '分类目录读取已取消'));
              abort.signal.addEventListener('abort', cancelled, { once: true });
              removeAbort = () => abort.signal.removeEventListener('abort', cancelled);
              timer = setTimeout(() => { timedOut = true; abort.abort(); }, 8500);
            })]);
          } finally { if (timer !== undefined) clearTimeout(timer); removeAbort(); if (this.active.get(parent)?.abort === abort) this.active.delete(parent); }
        })();
        flight = { abort, promise }; this.active.set(parent, flight);
      }
      await flight.promise;
    }
    if (this.closed) return [];
    const stored = this.pages.get(parent);
    if (!stored) return [];
    const rows: CarLibraryItem[] = stored.tracks.map(track => libraryPlaybackTrack(track, snapshot.state)).map(track => ({
      id: 'car:track:' + encodeURIComponent(parent) + ':' + encodeURIComponent(trackQueueKey(track)), title: track.title,
      artist: track.artist, album: track.album, durationMs: carCatalogDurationMs(track), cover: track.cover, parent,
      browsable: false, playable: !libraryUnavailableReason(track, snapshot.providers),
    }));
    if (stored.hasMore) rows.push({ id: carHomeMenuParent(reference.choice.id, reference.page + 1), title: '下一组歌曲', parent,
      browsable: true, playable: false });
    return rows.slice(page * pageSize, (page + 1) * pageSize);
  }
  selection(snapshot: CarLibrarySnapshot, parent: string, mediaId: string) {
    if (this.closed) return null;
    this.synchronize(snapshot);
    const reference = this.reference(parent), stored = this.pages.get(parent);
    if (!reference || !stored || this.closed) return null;
    const prefix = 'car:track:' + encodeURIComponent(parent) + ':';
    if (!mediaId.startsWith(prefix)) return null;
    const key = decodeURIComponent(mediaId.slice(prefix.length));
    const tracks = stored.tracks.map(track => libraryPlaybackTrack(track, snapshot.state)).filter(track => !libraryUnavailableReason(track, snapshot.providers));
    const index = tracks.findIndex(track => trackQueueKey(track) === key);
    if (index < 0) return null;
    return { track: tracks[index]!, tracks, index, scene: reference.choice.kind === 'scene',
      queueSource: { kind: 'home-menu' as const, cursor: stored.cursor, hasMore: stored.hasMore,
        ...(stored.hasMore && stored.initialRemaining ? { initialMenuBatch: { remaining: stored.initialRemaining, artists: stored.artists } } : {}) } };
  }
  close() { this.closed = true; this.active.forEach(flight => flight.abort.abort()); this.active.clear(); this.pages.clear(); }
}
