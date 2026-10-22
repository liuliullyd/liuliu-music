import type { CatalogItem, PlatformSetting } from '../domain/types';
import type { CarLibraryItem, CarLibrarySnapshot } from './carLibrary';
import { CatalogRequestBudget } from './catalogRequestBudget';
import { getPlaylistCatalogPage } from './onlineCatalog';
const names: Record<PlatformSetting['id'], string> = {
  netease: '网易云音乐',
  qq: 'QQ音乐',
  kugou: '酷狗音乐',
  kuwo: '酷我音乐',
  migu: '咪咕音乐',
  qishui: '汽水音乐',
};
export const carCatalogParent = (item: CatalogItem, offset = 0) =>
  `car:catalog:${item.provider}:${encodeURIComponent(item.id)}:${offset}`;
export const isCarPlatformParent = (parent: string) =>
  parent.startsWith('car:platform:');
export function carPlatformFolders(
  snapshot: CarLibrarySnapshot,
): CarLibraryItem[] {
  return snapshot.state.platforms
    .filter(platform => platform.enabled && names[platform.id])
    .map(platform => ({
      id: `car:platform:${platform.id}:1`,
      title: names[platform.id],
      parent: 'car:platforms',
      browsable: true,
      playable: false,
    }));
}
/** Issued public catalog references live only in this mounted car browser. */
export class CarPlatformPlaylists {
  private pages = new Map<
    string,
    {
      items: CatalogItem[];
      nextPage: number | null;
    }
  >();
  private active = new Map<
    string,
    {
      budget: CatalogRequestBudget;
      promise: Promise<void>;
    }
  >();
  private closed = false;
  private provider(snapshot: CarLibrarySnapshot, id: string) {
    return snapshot.state.platforms.find(
      platform => platform.id === id && platform.enabled && names[platform.id],
    )?.id;
  }
  reference(
    snapshot: CarLibrarySnapshot,
    parent: string,
  ): CatalogItem | undefined {
    if (this.closed) return undefined;
    const match = /^car:catalog:([^:]+):([^:]+):(\d+)$/.exec(parent);
    if (!match || !this.provider(snapshot, match[1]!)) return undefined;
    let id: string;
    try {
      id = decodeURIComponent(match[2]!);
    } catch {
      return undefined;
    }
    for (const page of this.pages.values()) {
      const item = page.items.find(
        value => value.provider === match[1] && value.id === id,
      );
      if (item) return item;
    }
    return undefined;
  }
  async browse(
    snapshot: CarLibrarySnapshot,
    parent: string,
    page: number,
    pageSize: number,
  ): Promise<CarLibraryItem[]> {
    if (
      this.closed ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      return [];
    const match = /^car:platform:([^:]+):(\d+)$/.exec(parent);
    const provider = match && this.provider(snapshot, match[1]!);
    const upstream = match ? Number(match[2]) : 0;
    if (
      !provider ||
      !Number.isSafeInteger(upstream) ||
      upstream < 1 ||
      upstream > 10000
    )
      return [];
    if (!this.pages.has(parent)) {
      let flight = this.active.get(parent);
      if (!flight) {
        const budget = new CatalogRequestBudget(8000, 1);
        const promise = (async () => {
          try {
            const result = await budget.wait(
              getPlaylistCatalogPage(provider, upstream, {
                paginateKugouAllPlaylists: true,
                requestContext: budget,
              }),
            );
            budget.assertActive();
            if (this.closed) return;
            const seen = new Set<string>();
            const items = result.items.filter(item => {
              if (
                item.provider !== provider ||
                item.kind !== 'playlists' ||
                !item.id?.trim() ||
                !item.title?.trim() ||
                seen.has(item.id)
              )
                return false;
              seen.add(item.id);
              return true;
            });
            const next = result.nextPage;
            this.pages.set(parent, {
              items,
              nextPage:
                next !== null &&
                Number.isSafeInteger(next) &&
                next > upstream &&
                next <= 10000
                  ? next
                  : null,
            });
            if (this.pages.size > 32)
              this.pages.delete(this.pages.keys().next().value!);
          } finally {
            budget.close();
            this.active.delete(parent);
          }
        })();
        flight = { budget, promise };
        this.active.set(parent, flight);
      }
      await flight.promise;
    }
    if (this.closed) return [];
    const stored = this.pages.get(parent);
    if (!stored) return [];
    const rows: CarLibraryItem[] = stored.items.map(item => ({
      id: carCatalogParent(item),
      title: item.title,
      cover: item.cover,
      parent,
      browsable: true,
      playable: false,
    }));
    if (stored.nextPage !== null)
      rows.push({
        id: `car:platform:${provider}:${stored.nextPage}`,
        title: '下一页歌单',
        parent,
        browsable: true,
        playable: false,
      });
    return rows.slice(page * pageSize, (page + 1) * pageSize);
  }
  close() {
    this.closed = true;
    this.active.forEach(flight => flight.budget.close());
    this.active.clear();
    this.pages.clear();
  }
}
