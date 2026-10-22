import type { CatalogItem, CoverKey, PersistedState, Track } from '../domain/types';
import { collectKnownTracks } from './libraryPlaybackActions';
import { linkedPlaylists } from './linkedPlaylist';
import { trackCoverCandidates } from './onlineCatalog';

/** Home rail presentation only; all-page management consumes the original entities. */
export interface PersonalPlaylistDisplayItem extends Pick<CatalogItem, 'id' | 'title' | 'description' | 'cover' | 'coverCandidates'> {
  provider?: CatalogItem['provider'];
  coverKey?: CoverKey;

  personalPlaylistId?: string;
  collection?: CatalogItem;
}

/** Same imported-then-manual order as the existing My Playlists manager. */
export function homePersonalPlaylists(state: PersistedState, current: Track | null): PersonalPlaylistDisplayItem[] {
  const tracks = new Map(collectKnownTracks(state, current).map(track => [track.id, track]));
  return [
    ...linkedPlaylists(state).map(collection => ({ ...collection, collection })),
    ...state.playlists.map(playlist => {
      const track = tracks.get(playlist.trackIds[0] ?? '');
      return {
        id: playlist.id,
        personalPlaylistId: playlist.id,
        title: playlist.title,
        description: playlist.description || `${playlist.trackIds.length} 首`,
        cover: playlist.cover ?? track?.cover,
        coverKey: track?.coverKey ?? playlist.coverKey,
        coverCandidates: playlist.cover ? [playlist.cover] : track ? trackCoverCandidates(track) : [],
      };
    }),
  ];
}
