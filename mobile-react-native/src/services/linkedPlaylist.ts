import type { CatalogItem, PersistedState } from '../domain/types';
import { collectionFavoriteKey } from './collectionIdentity';

export type LinkedPlaylistReference = Pick<CatalogItem, 'provider' | 'id'>;

const providers = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui']);
function metadataOnly(item: CatalogItem): CatalogItem | undefined {
  if (!item || item.kind !== 'playlists' || !providers.has(item.provider) ||
    typeof item.id !== 'string' || !item.id.trim() ||
    typeof item.title !== 'string' || !item.title.trim()) return undefined;
  return { id: item.id, provider: item.provider, kind: 'playlists', title: item.title.trim(),
    description: item.description, cover: item.cover, trackCount: item.trackCount };
}

/** Imported links own their metadata independently of collection favorites. */
export function linkedPlaylists(state: PersistedState): CatalogItem[] {
  return state.importedPlaylists ?? [];
}

export function savedPlaylistReference(state: PersistedState, reference: LinkedPlaylistReference) {
  return linkedPlaylists(state).find(item => item.provider === reference.provider && item.id === reference.id);
}

export function saveLinkedPlaylist(state: PersistedState, item: CatalogItem, overwrite = false): PersistedState {
  const reference = metadataOnly(item);
  if (!reference) return state;
  const existing = savedPlaylistReference(state, reference);
  if (existing) return overwrite ? { ...state,
    importedPlaylists: linkedPlaylists(state).map(value => value === existing ? reference : value) } : state;
  return { ...state, importedPlaylists: [reference, ...linkedPlaylists(state)] };
}

export function renameLinkedPlaylist(state: PersistedState, reference: LinkedPlaylistReference, title: string): PersistedState {
  const normalized = title.trim();
  const existing = savedPlaylistReference(state, reference);
  if (!normalized || !existing || existing.title === normalized) return state;
  return { ...state, importedPlaylists: linkedPlaylists(state).map(item => item === existing ? { ...item, title: normalized } : item) };
}

export function deleteLinkedPlaylist(state: PersistedState, reference: LinkedPlaylistReference): PersistedState {
  const existing = savedPlaylistReference(state, reference);
  return existing ? { ...state, importedPlaylists: linkedPlaylists(state).filter(item => item !== existing) } : state;
}

/** Migrate only explicit legacy import markers, never ordinary favorites or songs. */
export function migrateLinkedPlaylists(state: PersistedState): PersistedState {
  const imports = new Map<string, CatalogItem>();
  const add = (item: CatalogItem) => {
    const reference = metadataOnly(item);
    if (reference && !imports.has(collectionFavoriteKey(reference))) imports.set(collectionFavoriteKey(reference), reference);
  };
  for (const item of Array.isArray(state.importedPlaylists) ? state.importedPlaylists : []) add(item);
  const legacy = state.savedCollections.filter(item => item.kind === 'playlists' && item.metadata?.linkedPlaylist === true);
  for (const item of legacy) add(item);
  for (const playlist of state.playlists) {
    if (playlist.importOrigin) add({ ...playlist.importOrigin, kind: 'playlists',
      title: playlist.title, description: playlist.description ?? '', cover: playlist.cover,
      trackCount: playlist.trackIds.length });
  }
  const migratedKeys = new Set(legacy.map(collectionFavoriteKey));
  return { ...state, importedPlaylists: [...imports.values()],
    savedCollections: legacy.length ? state.savedCollections.filter(item => !legacy.includes(item)) : state.savedCollections,
    favoriteCollections: legacy.length ? state.favoriteCollections.filter(key => !migratedKeys.has(key)) : state.favoriteCollections,
    playlists: state.playlists.some(item => item.importOrigin) ? state.playlists.filter(item => !item.importOrigin) : state.playlists };
}
