import { clearDecodedCoverCache } from './coverLoading';
import { clearLibraryArtworkCache } from './libraryArtwork';
import { clearLibraryTrackArtworkCache } from './libraryTrackArtwork';
import { clearLocalMetadataCache } from './localLyrics';
import { clearMiguChartCoverCache } from './onlineCatalog';
import { clearTrackLyricsCache } from './onlineMusic';
import { clearPlayerAppearanceCache } from './playerAppearance';
import { clearRuntimeResolutionCache } from './sourceRuntime';

/**
 * Clear completed process caches only. In-flight requests and the deterministic
 * playback-rejection blacklist deliberately remain intact.
 */
export function clearSafeRuntimeCaches() {
  clearRuntimeResolutionCache();
  clearDecodedCoverCache();
  clearLibraryArtworkCache();
  clearLibraryTrackArtworkCache();
  clearLocalMetadataCache();
  clearMiguChartCoverCache();
  clearTrackLyricsCache();
  clearPlayerAppearanceCache();
}
