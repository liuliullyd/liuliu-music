import type { CatalogItem, PlatformSetting } from '../domain/types';
import { searchOnlinePlaylists } from './onlineMusic';

export interface HomeSceneDefinition {
  id: string;
  title: string;
  copy: string;
  query: string;
}

export interface HomeScenePlaylist {
  sceneId: string;
  title: string;
  copy: string;
  /** Null while the scene card is waiting for a remote playlist entity. */
  item: CatalogItem | null;
}

/**
 * Scene loading starts once the current Home recommendation generation has
 * completed its first request batch. The recommendation rail may grow after
 * that point without changing this generation key.
 */
export function isHomeSceneLoadReady(
  enabledProviderCount: number,
  recommendationReadyKey: string | null,
  startupKey: string,
): boolean {
  return enabledProviderCount > 0 && recommendationReadyKey === startupKey;
}

export function createHomeScenePlaceholders(): HomeScenePlaylist[] {
  return HOME_SCENE_DEFINITIONS.map(scene => ({
    sceneId: scene.id,
    title: scene.title,
    copy: scene.copy,
    item: null,
  }));
}

/**
 * Each scene has its own platform search term. The result is still a real
 * playlist entity from the selected provider, so the Home card can open the
 * shared collection detail instead of treating missing artwork as content.
 */
export const HOME_SCENE_DEFINITIONS: HomeSceneDefinition[] = [
  { id: 'morning', title: '清晨', copy: '元气出发', query: '清晨' },
  { id: 'commute', title: '通勤', copy: '路上的旋律', query: '通勤' },
  { id: 'work', title: '工作', copy: '专注高效', query: '工作' },
  { id: 'night', title: '夜晚', copy: '放松治愈', query: '夜晚' },
  { id: 'rain', title: '下雨天', copy: '听见情绪', query: '下雨天' },
  { id: 'travel', title: '旅行', copy: '去看世界', query: '旅行' },
];

const platformIds = (platforms: PlatformSetting[]) =>
  new Set(platforms.filter(value => value.enabled).map(value => value.id));

/**
 * Load one semantically constrained playlist for each Home scene. Requests are
 * kept serial by scene so a cold Home entry does not fan out six independent
 * generations; each platform search remains owned by searchOnlinePlaylists.
 */
export async function loadHomeScenePlaylists(
  platforms: PlatformSetting[],
  onSceneLoaded?: (scene: HomeScenePlaylist) => void,
  random: () => number = Math.random,
): Promise<HomeScenePlaylist[]> {
  const allowedProviders = platformIds(platforms);
  const used = new Set<string>();
  const result: HomeScenePlaylist[] = [];
  for (const scene of HOME_SCENE_DEFINITIONS) {
    const response = await searchOnlinePlaylists(
      scene.query,
      1,
      Math.max(6, allowedProviders.size),
      'all',
      platforms,
      'music',
    );
    const candidates = response.items.filter(
      value =>
        value.kind === 'playlists' && allowedProviders.has(value.provider),
    );
    const freshCandidates = candidates.filter(
      value => !used.has(`${value.provider}:${value.id}`),
    );
    const pool = freshCandidates.length ? freshCandidates : candidates;
    const randomValue = Number(random());
    const normalized = Number.isFinite(randomValue)
      ? Math.min(0.999999, Math.max(0, randomValue))
      : 0;
    const item = pool[Math.floor(normalized * pool.length)];
    if (!item) continue;
    used.add(`${item.provider}:${item.id}`);
    const scenePlaylist: HomeScenePlaylist = {
      sceneId: scene.id,
      title: scene.title,
      copy: scene.copy,
      item: {
        ...item,
        metadata: {
          ...item.metadata,
          homeScene: scene.id,
          source: 'home-scene-playlists',
        },
      },
    };
    result.push(scenePlaylist);
    onSceneLoaded?.(scenePlaylist);
  }
  return result;
}
