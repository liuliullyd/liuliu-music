import { defaultState } from '../src/services/storage';
import type { HomeMenuCursor } from '../src/services/homeMenuDiscovery';
import type { PlatformSetting } from '../src/domain/types';
export function menuCursor(provider: PlatformSetting['id'] = 'kuwo', hasMore = false, query = '热门歌曲'): HomeMenuCursor {
  return { choiceId: 'mode-default', profile: defaultState().profile, history: [], seenSongs: [],
    providers: [{id:provider,queries:[{query,page:2,hasMore}],candidates:[]}],
    defaultMix:{count:20,popular:20,multilingual:0,languages:{}} };
}
