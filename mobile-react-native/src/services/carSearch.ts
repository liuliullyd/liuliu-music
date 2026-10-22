import { trackQueueKey, type PlatformSetting, type Track } from '../domain/types';
import { CatalogRequestBudget } from './catalogRequestBudget';
import { searchOnline } from './onlineMusic';
import type { QueueSource } from './queuePaging';
import type { CarLibraryItem, CarLibrarySnapshot } from './carLibrary';
import { libraryPlaybackTrack, libraryUnavailableReason } from './libraryPlayback';
import { carCatalogDurationMs } from './carMediaFacts';

const SIZE = 20;
const MAX_PAGES = 8;
const TTL = 120_000;
type SearchSource = Extract<QueueSource, { kind: 'search' }>;
type SearchPage = { items: CarLibraryItem[]; tracks: Track[]; source: SearchSource; session: string };
export const isCarSearchParent = (parent: string) => parent.startsWith('car:search:');
const providerKey = (platforms: PlatformSetting[]) => platforms.filter(p => p.enabled).map(p => p.id).sort().join(',');
const copySource = (source: SearchSource): SearchSource => ({ ...source,
  buffered: source.buffered?.slice(), seenKeys: source.seenKeys?.slice(),
  providerPages: { ...source.providerPages }, exhaustedProviders: source.exhaustedProviders?.slice() });

/** Explicit online metadata search; no phone search state, storage, audio URL or new Player. */
export class CarSearch {
  private pages = new Map<number, SearchPage>();
  private active?: { budget: CatalogRequestBudget; promise: Promise<SearchPage>; page: number };
  private generation = 0;
  private query = '';
  private providers = '';
  private session = '';
  private expires = 0;
  private nextPage = 0;
  private source?: SearchSource;

  invalidate() {
    this.generation++;
    this.active?.budget.close(); this.active = undefined;
    this.pages.clear(); this.source = undefined; this.query = ''; this.nextPage = 0; this.expires = 0;
  }
  private current(platforms: PlatformSetting[]) {
    if (this.expires <= Date.now() || this.providers !== providerKey(platforms)) { this.invalidate(); return false; }
    return true;
  }
  async search(platforms: PlatformSetting[], queryValue: unknown, page: number, session = 'local', reset = false) {
    const query = String(queryValue ?? '').trim();
    if (!query || query.length > 160) throw new Error('请输入有效搜索词');
    if (!Number.isSafeInteger(page) || page < 0 || page >= 100) throw new Error('搜索页已达上限，请缩小搜索范围');
    const enabled = platforms.filter(p => p.enabled);
    if (!enabled.length) { this.invalidate(); throw new Error('没有通过检测并已绑定的搜索平台'); }
    const identity = providerKey(platforms);
    const changed = this.query !== query || this.providers !== identity || this.session !== session || this.expires <= Date.now();
    if (reset || changed) {
      this.invalidate();
      if (page !== 0) throw new Error('搜索会话已失效，请重新搜索');
      this.query = query; this.providers = identity; this.session = session; this.expires = Date.now() + TTL;
      this.source = { kind: 'search', query, provider: 'all', page: 0, hasMore: true,
        providerPages: Object.fromEntries(enabled.map(p => [p.id, 1])), exhaustedProviders: [], seenKeys: [] };
    }
    const cached = this.pages.get(page);
    if (cached) return { items: cached.items, hasMore: cached.source.hasMore, scope: 'online' as const };
    if (page !== this.nextPage || !this.source) throw new Error('搜索页已失效，请按顺序重新搜索');
    if (this.active && this.active.page !== page) throw new Error('搜索请求正在处理');
    if (!this.active) {
      const generation = this.generation;
      const budget = new CatalogRequestBudget(12_000, 6);
      const source = copySource(this.source);
      const promise = (async (): Promise<SearchPage> => {
        try {
          await Promise.resolve();
          const buffer = [...(source.buffered ?? [])];
          const seen = new Set(source.seenKeys ?? []);
          const exhausted = new Set(source.exhaustedProviders ?? []);
          const providerPages = { ...source.providerPages };
          let remoteHasMore = source.remoteHasMore ?? true;
          // An all-platform response can contain 6 * 20 rows. Keep its tail before requesting another remote page.
          for (let round = 0; buffer.length < SIZE && remoteHasMore && round < 2; round++) {
            const providers = enabled.filter(p => !exhausted.has(p.id));
            if (!providers.length) { remoteHasMore = false; break; }
            const settled = await budget.wait(Promise.allSettled(providers.map(async provider => {
              const number = providerPages[provider.id] ?? 1;
              const result = await searchOnline(query, number, SIZE, provider.id, enabled, 'music', 10_000, undefined, budget);
              if (!result.tracks.length && result.errors.length && !Number.isFinite(result.rawCount)) throw new Error(result.errors.join('；'));
              return { number, result };
            })));
            budget.assertActive();
            if (settled.every(value => value.status === 'rejected')) {
              throw (settled.find(value => value.status === 'rejected') as PromiseRejectedResult).reason;
            }
            settled.forEach((value, index) => {
              if (value.status === 'rejected') return; // Failed providers keep their cursor for the next explicit request.
              const provider = providers[index]!.id;
              const { result, number } = value.value;
              providerPages[provider] = number + 1;
              if (!(Number.isFinite(result.rawCount) ? Number(result.rawCount) > 0 : result.tracks.length > 0)) exhausted.add(provider);
              result.tracks.forEach(({ playUrl: _url, ...track }) => {
                const key = trackQueueKey(track);
                if (track.provider !== provider || seen.has(key) || libraryUnavailableReason(track, new Set(enabled.map(p => p.id)))) return;
                seen.add(key); buffer.push(track);
              });
            });
            remoteHasMore = enabled.some(p => !exhausted.has(p.id));
          }
          budget.assertActive();
          if (generation !== this.generation) throw new Error('搜索会话已失效');
          const tracks = buffer.slice(0, SIZE), remaining = buffer.slice(SIZE);
          const next: SearchSource = { ...source, page: source.page + 1, buffered: remaining,
            providerPages, exhaustedProviders: [...exhausted], seenKeys: [...seen], remoteHasMore,
            hasMore: remaining.length > 0 || remoteHasMore };
          const parent = `car:search:${generation}:${page}`;
          const items = tracks.map(track => ({ id: `car:track:${encodeURIComponent(parent)}:${encodeURIComponent(trackQueueKey(track))}`,
            title: track.title, artist: track.artist, album: track.album, durationMs: carCatalogDurationMs(track), cover: track.cover, parent, browsable: false, playable: true }));
          const stored = { items, tracks, source: next, session };
          this.pages.set(page, stored);
          if (this.pages.size > MAX_PAGES) this.pages.delete(this.pages.keys().next().value!);
          this.source = next; this.nextPage = page + 1;
          return stored;
        } finally { budget.close(); if (this.active?.budget === budget) this.active = undefined; }
      })();
      this.active = { budget, promise, page };
    }
    const stored = await this.active.promise;
    return { items: stored.items, hasMore: stored.source.hasMore, scope: 'online' as const };
  }
  selection(snapshot: CarLibrarySnapshot, platforms: PlatformSetting[], parent: string, mediaId: string) {
    if (!this.current(platforms)) return null;
    const stored = [...this.pages.values()].find(page => page.items.some(item => item.parent === parent && item.id === mediaId));
    if (!stored) return null;
    const tracks = stored.tracks.map(track => libraryPlaybackTrack(track, snapshot.state));
    const index = stored.items.findIndex(item => item.parent === parent && item.id === mediaId);
    if (index < 0 || libraryUnavailableReason(tracks[index]!, snapshot.providers)) return null;
    return { track: tracks[index]!, tracks, index, queueSource: copySource(stored.source), session: stored.session };
  }
}
