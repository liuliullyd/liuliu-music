import { trackQueueKey, type PersistedState, type Track, type PlatformSetting } from '../domain/types';
import { libraryPlaybackTrack, libraryUnavailableReason, localPlaybackReference } from './libraryPlayback';
import { trackMediaKind } from './mediaLibrary';
import { carFavoriteFolders, carLinkedFolders } from './carLinkedPlaylists';
import { carCatalogDurationMs } from './carMediaFacts';
import { carHomeMenuFolders } from './carHomeMenus';
import { carPlatformFolders } from './carPlatformPlaylists';

export type CarLibraryItem = { id: string; title: string; artist?: string; album?: string; durationMs?: number; cover?: string; browsable: boolean; playable: boolean; parent: string };
export type CarLibrarySnapshot = { state: PersistedState; queue: Track[]; current: Track | null; providers: ReadonlySet<string>;
  recommendationPlatforms?: PlatformSetting[]; firstProvider?: string | null; configurationKey?: string };
export const CAR_ROOT = 'car:root';
const group = (id: string, title: string): CarLibraryItem => ({ id, title, browsable: true, playable: false, parent: CAR_ROOT });
const roots = [group('car:playlists', '我的歌单'), group('car:favorites', '收藏'), group('car:history', '最近播放'), group('car:queue', '当前队列'),
  group('car:recommendations', '推荐歌曲'), group('car:scenes', '场景分类'), group('car:platforms', '平台歌单')];
/** Only presentation/availability changes invalidate the browser, never playback progress or signed URLs. */
export function carLibraryRevision(snapshot: CarLibrarySnapshot): string {
  const state = snapshot.state;
  const row = (track: Track) => [trackQueueKey(track), track.title, track.artist, track.album, track.duration, track.cover,
    trackMediaKind(track), !!localPlaybackReference(track), libraryUnavailableReason(track, snapshot.providers)];
  return JSON.stringify([
    state.playlists.map(item => [item.id, item.title, item.cover, item.trackIds]),
    carLinkedFolders(snapshot), carFavoriteFolders(snapshot), state.favoriteCollections, state.favorites, state.profile,
    state.savedTracks.map(row), state.localTracks.map(row),
    state.downloads.map(item => [item.status, /^download:\d+$/.test(item.id), row(item.track)]),
    state.history.map(item => row(item.track)), snapshot.queue.map(row),
    snapshot.current ? row(snapshot.current) : null, [...snapshot.providers].sort(), carPlatformFolders(snapshot), snapshot.firstProvider, snapshot.configurationKey,
  ]);
}
export function carLibraryTracks(snapshot: CarLibrarySnapshot, parent: string): Track[] {
  const state = snapshot.state;
  const known = new Map([...state.savedTracks, ...state.localTracks, ...state.downloads.map(item => item.track),
    ...state.history.map(item => item.track), ...snapshot.queue, ...(snapshot.current ? [snapshot.current] : [])].map(track => [track.id, track]));
  let tracks: Track[] = [];
  if (parent === 'car:queue') tracks = snapshot.queue;
  else if (parent === 'car:local') tracks = [...state.localTracks,
    ...state.downloads.filter(item => item.status === 'downloaded').map(item => item.track)]
    .filter(track => !!localPlaybackReference(libraryPlaybackTrack(track, state)));
  else if (parent === 'car:favorites') tracks = state.favorites.flatMap(id => known.get(id) ?? []);
  else if (parent === 'car:history') tracks = state.history.map(item => item.track);
  else if (parent.startsWith('car:playlist:')) {
    const id = decodeURIComponent(parent.slice('car:playlist:'.length));
    tracks = state.playlists.find(item => item.id === id)?.trackIds.flatMap(key => known.get(key) ?? []) ?? [];
  }
  const seen = new Set<string>();
  return tracks.filter(track => {
    const key = trackQueueKey(track);
    if (trackMediaKind(track) !== 'music' || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(track => libraryPlaybackTrack(track, state));
}
/** Pure metadata projection: browsing cannot resolve a URL, hydrate a queue or play audio. */
export function carLibraryPage(snapshot: CarLibrarySnapshot, parent: string, page: number, pageSize: number): CarLibraryItem[] {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return [];
  let start = 0, end = Number.MAX_SAFE_INTEGER, source = parent;
  if (parent.startsWith('car:range:')) {
    const match = /^car:range:(\d+):(\d+):(.+)$/.exec(parent);
    if (!match) return [];
    start = Number(match[1]); end = Number(match[2]); source = decodeURIComponent(match[3]!);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || source.startsWith('car:range:')) return [];
  }
  let items: CarLibraryItem[];
  if (source === CAR_ROOT) items = roots;
  else if (source === 'car:platforms') items = carPlatformFolders(snapshot);
  else if (source === 'car:playlists') items = [...snapshot.state.playlists.map(item => ({
    id: 'car:playlist:' + encodeURIComponent(item.id), title: item.title, cover: item.cover, browsable: true, playable: false, parent,
  })), ...carLinkedFolders(snapshot)];
  else if (source === 'car:recommendations' || source === 'car:scenes') items = carHomeMenuFolders(source);
  else items = [...carLibraryTracks(snapshot, source).map(track => ({ id: 'car:track:' + encodeURIComponent(source) + ':' + encodeURIComponent(trackQueueKey(track)),
    title: track.title, artist: track.artist, album: track.album, durationMs: carCatalogDurationMs(track), cover: track.cover, browsable: false,
    playable: !libraryUnavailableReason(track, snapshot.providers), parent: source })),
    ...(source === 'car:favorites' ? carFavoriteFolders(snapshot) : [])];
  end = Math.min(items.length, end);
  const count = Math.max(0, end - start);
  if (count > 100) {
    let step = 100;
    while (Math.ceil(count / step) > 100) step *= 100;
    items = Array.from({ length: Math.ceil(count / step) }, (_, index) => {
      const from = start + index * step, to = Math.min(end, from + step);
      return { id: `car:range:${from}:${to}:${encodeURIComponent(source)}`, title: `第 ${from + 1}–${to} 项`, browsable: true, playable: false, parent };
    });
  } else items = items.slice(start, end);
  return items.slice(page * pageSize, (page + 1) * pageSize);
}
export function carLibrarySelection(snapshot: CarLibrarySnapshot, parent: string, mediaId: string) {
  if (!mediaId.startsWith('car:track:')) return null;
  const separator = mediaId.lastIndexOf(':');
  if (decodeURIComponent(mediaId.slice('car:track:'.length, separator)) !== parent) return null;
  const tracks = carLibraryTracks(snapshot, parent).filter(track => !libraryUnavailableReason(track, snapshot.providers));
  const key = decodeURIComponent(mediaId.slice(separator + 1));
  const index = tracks.findIndex(track => trackQueueKey(track) === key);
  return index >= 0 ? { track: tracks[index]!, tracks, index,
    ...(parent.startsWith('car:playlist:') ? { historyOrigin: { playlistId: decodeURIComponent(parent.slice('car:playlist:'.length)) } } : {}) } : null;
}
