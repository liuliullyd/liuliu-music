import type {
  CatalogItem,
  HistoryEntry,
  MusicProfile,
  PlatformSetting,
  Track,
  HomeMenuProgressEntry,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import { constituentArtists, isOrdinaryTrack } from './liveDiscovery';
import { searchOnlinePlaylists } from './onlineMusic';
import { loadCollectionTrackBatch } from './collectionPaging';
import { CatalogRequestBudget } from './catalogRequestBudget';
import {
  HOME_MENU_SCENES,
  HOME_MENU_SCENE_RULES,
  matchesHomeMenuScene,
  matchesSceneCollection,
  sceneEvidenceScore as sceneMetadataScore,
  type HomeMenuSceneRule,
} from './homeMenuScenes';
import {
  allowsSceneLanguageDiversity,
  sceneRecallQueries,
  sceneSungLanguage,
} from './homeMenuLanguages';
import {
  sampleHomeMenuSceneCandidates,
  shuffleHomeMenuSceneValues,
} from './homeMenuSceneOrder';
import {
  acceptPreferenceTrack, clonePreferenceSelection,
  createPreferenceSelection, emptyMusicStatistics, exploreLanguage, isRecentRelease,
  memoryStatisticsFor, musicFeatures, normalizeMusicStatistics, preferenceDeficit,
  preferenceQueries, type PreferenceSelection,
} from './musicPreferenceStatistics';
import { MenuAlbumRequestQueue, menuTrackReleaseYear, normalizeMenuTrackMetadata, supplementMenuTrackMetadata, withMenuCollectionLanguage } from './homeMenuTrackMetadata';
import { compatibleMenuProgress, menuQueryProgressKey } from './homeMenuProgress';
import { isMusicOnlyRecommendationTrack, isRecommendationMusicCollection, recommendationRecordingPenalty } from './recommendationContentPolicy';
export { HOME_MENU_SCENES, HOME_MENU_SCENE_RULES } from './homeMenuScenes';

export interface HomeMenuChoice {
  id: string;
  kind: 'mode' | 'scene';
  label: string;
  description?: string;
  glyph?: string;
  queries: readonly string[];
  artistPattern?: RegExp;
  language?: Track['language'];
}

export interface HomeMenuRule {
  kind: 'default' | 'explore' | 'memory' | 'scene';
  queries: readonly string[];
  fallbackQueries: readonly string[];
  languages?: readonly Track['language'][];
  requiredKeywords?: readonly string[];
  excludedKeywords?: readonly string[];
  genreKeywords?: readonly string[];
  moodKeywords?: readonly string[];
  yearRange?: readonly [number, number];
  scene?: HomeMenuSceneRule;
}

export const HOME_MENU_MODES: readonly HomeMenuChoice[] = [
  {
    id: 'mode-default',
    kind: 'mode',
    label: '默认模式',
    description: '为您推荐您可能喜欢的歌',
    glyph: 'Ⅲ',
    queries: [],
  },
  {
    id: 'mode-explore',
    kind: 'mode',
    label: '探索模式',
    description: '探索更多您可能感兴趣的歌曲风格',
    glyph: '◇',
    queries: [],
  },
  {
    id: 'mode-memory',
    kind: 'mode',
    label: '回忆模式',
    description: '根据您曾经听过的歌曲推荐',
    glyph: '↶',
    queries: [],
  },
];

export const HOME_MENU_CHOICES: readonly HomeMenuChoice[] = [
  ...HOME_MENU_MODES,
  ...HOME_MENU_SCENES,
];
export const HOME_MENU_BATCH_SIZE = 20;
export const HOME_MENU_FIRST_BATCH_SIZE = 5;
export const DEFAULT_POPULAR_QUERY = '热门歌曲';
export const DEFAULT_MULTILINGUAL_QUERIES = [
  ['英语热门歌曲', '英语'], ['日语热门歌曲', '日语'], ['韩语热门歌曲', '韩语'],
  ['法语热门歌曲', '法语'], ['西班牙语热门歌曲', '西班牙语'], ['粤语热门歌曲', '粤语'],
] as const;
type DefaultBucket = 'profile' | 'popular' | 'multilingual';
const defaultBucket = (query: string): DefaultBucket => query === DEFAULT_POPULAR_QUERY
  ? 'popular' : DEFAULT_MULTILINGUAL_QUERIES.some(([value]) => value === query) ? 'multilingual' : 'profile';
export const HOME_MENU_SCENE_CATALOG_BUDGET_MS = 8_000;


const HOME_MENU_RULE_OVERRIDES: Partial<Record<string, Partial<HomeMenuRule>>> =
  {
    'mode-explore': {
      kind: 'explore',
      queries: [
        '英语热门歌曲', '法语热门歌曲', '西班牙语热门歌曲', '葡萄牙语热门歌曲',
        '德语热门歌曲', '俄语热门歌曲', '日语热门歌曲', '韩语热门歌曲',
        '泰语热门歌曲', '印地语热门歌曲', '阿拉伯语热门歌曲', '华语热门歌曲',
      ],
      fallbackQueries: [],
    },
    'mode-memory': {
      kind: 'memory',
      queries: [],
      fallbackQueries: [],
    },
  };

export const HOME_MENU_RULES = HOME_MENU_CHOICES.reduce<
  Record<string, HomeMenuRule>
>((rules, choice) => {
  const override = HOME_MENU_RULE_OVERRIDES[choice.id] ?? {};
  const scene = HOME_MENU_SCENE_RULES[choice.id];
  const kind =
    override.kind ??
    (choice.id === 'mode-default'
      ? 'default'
      : choice.kind === 'scene'
      ? 'scene'
      : 'default');
  rules[choice.id] = {
    kind,
    queries: override.queries ?? scene?.recallQueries ?? choice.queries,
    fallbackQueries: override.fallbackQueries ?? choice.queries.slice(1),
    languages:
      override.languages ?? (choice.language ? [choice.language] : undefined),
    requiredKeywords: override.requiredKeywords,
    excludedKeywords: override.excludedKeywords,
    genreKeywords: override.genreKeywords ?? scene?.genreKeywords,
    moodKeywords: override.moodKeywords ?? scene?.moodKeywords,
    yearRange: override.yearRange,
    scene,
  };
  return rules;
}, {});

const unique = <T>(values: T[]) => [...new Set(values)];
const isDecadeChoice = (id:string) => id==='scene-80s' || id==='scene-90s';

function statisticsFor(choice: HomeMenuChoice, profile: MusicProfile, history: HistoryEntry[]) {
  if (choice.id === 'mode-default') {
    const statistics = normalizeMusicStatistics(profile.favoriteStatistics);
    return statistics?.samples && preferenceQueries(statistics).length ? statistics : emptyMusicStatistics();
  }
  const statistics = memoryStatisticsFor(profile, history);
  if (!statistics.samples || !preferenceQueries(statistics).length) throw new Error('播放记录不足，请先播放喜欢的歌曲');
  return statistics;
}

function queriesFor(
  choice: HomeMenuChoice,
  profile: MusicProfile,
  history: HistoryEntry[],
) {
  const rule = HOME_MENU_RULES[choice.id]!;
  if (rule.scene?.playlistSearchQuery) return [rule.scene.playlistSearchQuery];
  let queries = [...rule.queries, ...rule.fallbackQueries];
  if (choice.id === 'mode-default' || choice.id === 'mode-memory') {
    const directions = preferenceQueries(statisticsFor(choice, profile, history)).slice(0, 6);
    queries = choice.id === 'mode-memory'
      ? [...directions, ...directions.slice(0, 2).map(query => `${query} 新歌`)]
      : directions.length ? [...directions, DEFAULT_POPULAR_QUERY, ...DEFAULT_MULTILINGUAL_QUERIES.map(([query]) => query)]
      : [DEFAULT_POPULAR_QUERY];
  }
  return unique((rule.scene
    ? sceneRecallQueries(choice.id, rule.scene, queries)
    : queries).filter(Boolean));
}

const signalWeight = (values: Record<string, number>, key: string) =>
  Number(values[key] ?? values[key.toLocaleLowerCase()] ?? 0);

function profileScore(
  track: Track,
  choice: HomeMenuChoice,
  profile: MusicProfile,
  historyIds: Set<string>,
  index: number,
  deterministicTieBreak = true,
) {
  const artistScore = constituentArtists(track.artist).reduce(
    (total, artist) => total + signalWeight(profile.artists, artist),
    0,
  );
  let score =
    artistScore * 4 +
    signalWeight(profile.languages, track.language) * 2.5 +
    signalWeight(profile.genres, track.genre) * 2 +
    signalWeight(profile.moods, track.mood) * 1.8;
  if (choice.id === 'mode-explore' && historyIds.has(track.id)) {
    score -= 10;
  }
  return score + (deterministicTieBreak ? ((index * 37) % 23) / 100 : 0);
}

function candidateText(track: Track) {
  const metadata = track.metadata ?? {};
  return [
    track.title,
    track.artist,
    track.album,
    track.genre,
    track.mood,
    metadata.language,
    metadata.languageName,
    metadata.language_name,
    metadata.lang,
    metadata.songLanguage,
    metadata.song_language,
    metadata.category,
    metadata.categoryName,
    metadata.category_name,
    metadata.genre,
    metadata.style,
    metadata.tags,
    metadata.label,
    metadata.labelName,
    metadata.publisher,
    metadata.company,
    metadata.copyright,
    metadata.description,
    metadata.intro,
    metadata.remark,
  ]
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

const constituentArtistMatches = (track: Track, pattern: RegExp) =>
  constituentArtists(track.artist).some(artist => pattern.test(artist));

/** A named-artist scene repeats its subject, while guests retain diversity. */
const menuDiversityArtists = (track: Track, choice: HomeMenuChoice) =>
  constituentArtists(track.artist).filter(artist => !choice.artistPattern?.test(artist));

function releaseYearFor(track: Track) {
  if (track.releaseYear >= 1900 && track.releaseYear <= 2100)
    return track.releaseYear;
  const match = candidateText(track).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

function matchesChoice(
  track: Track,
  choice: HomeMenuChoice,
  _query: string,
  collection?: CatalogItem,
) {
  const rule = HOME_MENU_RULES[choice.id]!;
  if (rule.scene) return matchesHomeMenuScene(track, rule.scene, collection, _query);
  if(!isMusicOnlyRecommendationTrack(track)) return false;
  if (choice.id === 'mode-default' && track.title.includes('治愈音乐')) return false;
  if (choice.id === 'mode-explore') {
    const year = menuTrackReleaseYear(track);
    if (year === undefined || (year >= 1970 && year <= 1999) || !exploreLanguage(track)) return false;
  }
  const text = candidateText(track);
  if (
    choice.artistPattern &&
    !constituentArtistMatches(track, choice.artistPattern)
  )
    return false;
  const normalizedQuery = _query.toLocaleLowerCase();
  if (
    rule.languages?.length &&
    !rule.languages.includes(track.language) &&
    !rule.languages.some(language =>
      language === '粤语'
        ? /粤语|廣東話|广东话|cantonese|cantopop/i.test(text)
        : language === '纯音乐'
        ? /纯音乐|轻音乐|instrumental|piano|钢琴|ambient/i.test(text)
        : language === '日韩'
        ? /日语|日本語|j-pop|jpop|韩语|한국어|k-pop|kpop/i.test(text)
        : language === '欧美'
        ? !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(
            `${track.title}${track.artist}`,
          )
        : false,
    )
  )
    return false;
  if (rule.yearRange) {
    const year = releaseYearFor(track);
    if (year < rule.yearRange[0] || year > rule.yearRange[1]) return false;
  }
  if (
    rule.excludedKeywords?.some(keyword =>
      text.includes(keyword.toLocaleLowerCase()),
    )
  )
    return false;
  const semanticMatch = (keywords?: readonly string[]) =>
    !keywords?.length ||
    keywords.some(keyword => {
      const normalized = keyword.toLocaleLowerCase();
      return text.includes(normalized) || normalizedQuery.includes(normalized);
    });
  if (
    (rule.genreKeywords?.length || rule.moodKeywords?.length) &&
    !semanticMatch([
      ...(rule.genreKeywords ?? []),
      ...(rule.moodKeywords ?? []),
    ])
  )
    return false;
  if (
    rule.requiredKeywords?.length &&
    !rule.requiredKeywords.some(keyword => {
      const normalized = keyword.toLocaleLowerCase();
      return text.includes(normalized) || normalizedQuery.includes(normalized);
    })
  )
    return false;
  return true;
}

function sceneEvidenceScore(track: Track, choice: HomeMenuChoice, collection?: CatalogItem) {
  const scene = HOME_MENU_RULES[choice.id]?.scene;
  return scene ? sceneMetadataScore(track, scene, collection) : 0;
}

interface MenuCandidate {
  track: Track;
  query: string;
  collection?: CatalogItem;
}

type MenuCandidateFacts = { eligible: boolean; songKey: string; artists: string[]; penalty?: number; features?: ReturnType<typeof musicFeatures> };
type MenuSelectionFacts = Map<Track, Map<string, MenuCandidateFacts>>;

export interface HomeMenuPageOptions {
  randomizeBatch?: boolean;
  progress?: HomeMenuProgressEntry;
  /** Explicit scene clicks and their first-page tail use weighted sampling. */
  randomizeSceneBatch?: boolean;
  random?: () => number;
  /** Constituent artists already selected for this menu queue's initial twenty. */
  excludedArtists?: readonly string[];
  /** Only an explicit menu-scene first batch opts into the bounded request scope. */
  firstSceneBudgetMs?: number;
  /** Remaining portion of the same explicit first-batch catalog deadline. */
  catalogBudgetMs?: number;
  signal?: AbortSignal;
}

export interface HomeMenuCursor {
  batchRevision?: number;
  catalogRound?: number;
  randomizeBatch?: boolean;
  recentTrackKeys?: string[];
  choiceId: string;
  profile: MusicProfile;
  history: HistoryEntry[];
  modeSelection?: {
    preference: PreferenceSelection;
    recent: number;
    chinese: number;
    languages: Record<string, number>;
    now: number;
  };
  /** One cumulative 8:1:1 stream, shared by launch, explicit selection and continuation. */
  defaultMix?: { count: number; popular: number; multilingual: number; languages: Record<string, number> };
  /** Process-only state for the entire decade queue, including later pages. */
  decadeSelection?: { artists:string[] };
  providers: {
    id: PlatformSetting['id'];
    queries: { query: string; page: number; hasMore: boolean; limit?: number }[];
    recentTrackKeys?: string[];
    collectionPositions?: HomeMenuProgressEntry['collections'];
    candidates: MenuCandidate[];
    /** Diagnostic only; never persisted as a catalog position or audio claim. */
    metadataUnavailable?: boolean;
    collections?: { item: CatalogItem; offset: number; hasMore: boolean; query?: string; artistYield?: number }[];
    seenCollections?: string[];
    recallRouteIndex?: number;
    /** Directions interrupted by the first-batch deadline are recalled first after playback. */
    pendingSceneRoutes?: string[];
  }[];
  seenSongs: string[];
}

export class HomeMenuLoadError extends Error {
  constructor(message: string, readonly reason: 'empty' | 'incomplete' | 'request', readonly cursor: HomeMenuCursor) { super(message); }
}

/** Keep menu re-entry state independent from the active queue's mutable cursors. */
export function cloneHomeMenuCursor(cursor: HomeMenuCursor): HomeMenuCursor {
  return {
    ...cursor,
    ...(cursor.defaultMix ? { defaultMix: { ...cursor.defaultMix, languages: { ...cursor.defaultMix.languages } } } : {}),
    ...(cursor.decadeSelection ? {decadeSelection:{...cursor.decadeSelection,artists:[...cursor.decadeSelection.artists]}} : {}),
    ...(cursor.modeSelection ? { modeSelection: { ...cursor.modeSelection,
      preference: clonePreferenceSelection(cursor.modeSelection.preference), languages: { ...cursor.modeSelection.languages } } } : {}),
    providers: cursor.providers.map(provider => ({
      ...provider,
      queries: provider.queries.map(query => ({ ...query })),
      candidates: [...provider.candidates],
      collections: provider.collections?.map(collection => ({ ...collection })),
      seenCollections: [...(provider.seenCollections ?? [])],
      pendingSceneRoutes: [...(provider.pendingSceneRoutes ?? [])],
    })),
    seenSongs: [...cursor.seenSongs],
  };
}

const menuSongKey = (track: Track) =>
  `${track.title}|${track.artist}`.toLocaleLowerCase();

/** Round-robin route jobs, rather than filling all five slots from one platform. */
class SceneRouteScheduler {
  private reportProgress?:()=>void;
  progress(){this.reportProgress?.();}
  private jobs: { provider: string; route: number; run: () => Promise<void>; done: () => void }[] = [];
  enqueue(provider: string, route: number, run: () => Promise<void>) {
    return new Promise<void>(done => this.jobs.push({ provider, route, run, done }));
  }
  async start(providers: string[], budget: CatalogRequestBudget, enough: () => boolean,parallelFirst=false) {
    this.reportProgress=parallelFirst ? ()=>{if(!budget.signal.aborted && enough())budget.close();} : undefined;
    this.jobs.sort((a, b) => a.route - b.route || providers.indexOf(a.provider) - providers.indexOf(b.provider));
    const run = async (job: (typeof this.jobs)[number]) => {
      try { if (!budget.signal.aborted) await job.run(); }
      finally { job.done(); }
    };
    // Default/decades retain their first wave. Other choices may start five
    // workers immediately, publishing only through the shared selection gate.
    const firstWave = this.jobs.splice(0, parallelFirst ? 0 : providers.length);
    await Promise.all(firstWave.map(run));
    if (!budget.signal.aborted && enough()) budget.close();
    const next = async () => {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        await run(job);
        if (!budget.signal.aborted && enough()) budget.close();
      }
    };
    await Promise.all(Array.from({ length: 5 }, next));
  }
}

async function loadSceneCollectionCandidates(
  platform: PlatformSetting,
  choice: HomeMenuChoice,
  cursor: HomeMenuCursor['providers'][number],
  enabled: PlatformSetting[],
  limit: number,
  seen: Set<string>,
  random?: () => number,
  excludedArtists = new Set<string>(),
  requestContext?: CatalogRequestBudget,
  scheduler?: SceneRouteScheduler,
  sharedCandidates?: MenuCandidate[],
  detailBudget = { remaining: 4 },
  detailLimit = 4,
  modeSelection?: HomeMenuCursor['modeSelection'],
  onProgress?:()=>void,
  albumRequests?:MenuAlbumRequestQueue,
  albums?:Map<string,Promise<Record<string,unknown>>>,
  isBatchReady?: () => boolean,
  neededDefaultBucket?: () => DefaultBucket,
) {
  const scene = HOME_MENU_RULES[choice.id]!.scene;
  const exploring=choice.id==='mode-explore';
  const candidates = sharedCandidates ?? cursor.candidates.filter(
    item => !seen.has(menuSongKey(item.track)) && !cursor.recentTrackKeys?.includes(trackQueueKey(item.track)),
  );
  cursor.candidates = candidates;
  const collections = cursor.collections ?? [];
  const seenCollections = new Set(cursor.seenCollections ?? []);
  const hasEligibleCandidates = () => candidates.some(item =>
    isOrdinaryTrack(item.track) && matchesChoice(item.track, choice, item.query, item.collection) &&
    !menuDiversityArtists(item.track, choice).some(artist => excludedArtists.has(artist)),
  );
  let succeeded = excludedArtists.size ? hasEligibleCandidates() : candidates.length > 0;
  let failed = false;
  let detailRequests = 0;
  const detailsInFlight = new Map<(typeof collections)[number], Promise<boolean>>();
  const pendingRoutes = new Set(cursor.pendingSceneRoutes ?? []);
  const candidateTarget = random ? limit * 2 : limit;
  // Bound work for one requested page; later pages retain these exact cursors.
  const enough = () => {
    if (choice.kind === 'mode' && isBatchReady) return isBatchReady();
    const matching=candidates
        .filter(item =>
          matchesChoice(item.track, choice, item.query, item.collection),
        )
        .filter(item => !menuDiversityArtists(item.track, choice).some(artist => excludedArtists.has(artist)));
    if(new Set(matching.flatMap(item=>constituentArtists(item.track.artist))).size<candidateTarget) return false;
    if(!exploring) return true;
    const selected=modeSelection;
    const target=(selected?.preference.count ?? 0)+limit;
    const chinese=Math.max(0,Math.floor(target*0.1+1e-9)-(selected?.chinese ?? 0));
    return matching.filter(item=>exploreLanguage(item.track)==='chinese').length>=chinese &&
      matching.filter(item=>exploreLanguage(item.track)==='foreign').length>=limit-chinese;
  };
  // Unconsumed members already belong to this queue. A remote failure must
  // not make a fully buffered batch wait for another request.
  if (enough() && (choice.kind === 'mode' || !pendingRoutes.size)) return { candidates, failed: false };
  const readCollection = async (collection: (typeof collections)[number]) => {
    if (requestContext && detailsInFlight.has(collection)) return detailsInFlight.get(collection)!;
    if (detailRequests >= detailLimit || detailBudget.remaining<=0) return false;
    detailRequests += 1;
    detailBudget.remaining -= 1;
    const startedAt = Date.now();
    const work = (async () => {
      try {
        const request = loadCollectionTrackBatch(
          platform.id, 'playlists', collection.item.id, collection.offset,
          HOME_MENU_BATCH_SIZE, collection.item.metadata, enabled,
          requestContext, true,
        );
        let result = await (requestContext ? requestContext.wait(request) : request);
        if (!result.tracks.length) {
          requestContext?.assertActive();
          const retry = loadCollectionTrackBatch(platform.id,'playlists',collection.item.id,collection.offset,
            HOME_MENU_BATCH_SIZE,collection.item.metadata,enabled,requestContext,true);
          result = await (requestContext ? requestContext.wait(retry) : retry);
        }
        requestContext?.assertActive();
        const prepared = exploring
          ? await supplementMenuTrackMetadata(result.tracks.map(track => withMenuCollectionLanguage(track, collection.item)), choice.id, requestContext, undefined, albums, albumRequests)
          : result.tracks.map(track => normalizeMenuTrackMetadata(withMenuCollectionLanguage(track, collection.item)));
        requestContext?.assertActive();
        const existingArtists = choice.id === 'mode-default' ? new Set([...excludedArtists,
          ...candidates.flatMap(candidate => menuDiversityArtists(candidate.track, choice))]) : undefined;
        const freshArtists = new Set<string>();
        let artistYield = 0;
        const appendCollectionTrack=(track:Track)=>{
          requestContext?.assertActive();
          if(
              track.provider === platform.id &&
              !seen.has(menuSongKey(track)) &&
              !cursor.recentTrackKeys?.includes(trackQueueKey(track)) &&
              matchesChoice(track, choice, collection.query ?? '', collection.item)) {
            candidates.push({track,query:collection.query ?? '',collection:collection.item});
            if (existingArtists) {
              const artists = menuDiversityArtists(track, choice);
              if (!artists.some(artist => existingArtists.has(artist) || freshArtists.has(artist))) {
                artistYield += 1;
                artists.forEach(artist => freshArtists.add(artist));
              }
            }
          }
        };
        prepared.forEach(appendCollectionTrack);
        if (existingArtists) collection.artistYield = artistYield;
        // Publish a complete member page and its position before the shared
        // selector may close the request scope. Cancellation cannot skip rows.
        collection.offset += HOME_MENU_BATCH_SIZE;
        collection.hasMore = result.hasMore;
        succeeded = true;
        if (choice.kind === 'mode') onProgress?.();
        return true;
      } catch {
        // Failed details keep their offset and are retried by the same cursor.
        failed = true;
        return false;
      } finally {
        detailsInFlight.delete(collection);
        if (requestContext) console.info('[menu-scene-timing]', JSON.stringify({ choice: choice.id, provider: platform.id,
          route: cursor.queries.findIndex(route => route.query === collection.query), stage: 'catalog-detail',
          ms: Date.now() - startedAt, aborted: requestContext.signal.aborted }));
      }
    })();
    detailsInFlight.set(collection, work);
    return work;
  };
  const discoverCollections = async (queryCursor: (typeof cursor.queries)[number]) => {
    const startedAt = Date.now();
    try {
      const request = searchOnlinePlaylists(
        queryCursor.query, queryCursor.page, 6, platform.id, enabled, 'music',
        ...(requestContext ? [undefined, requestContext] as const : []),
      );
      let result = await (requestContext ? requestContext.wait(request) : request);
      if (!result.items.length) {
        requestContext?.assertActive();
        const retry=searchOnlinePlaylists(queryCursor.query,queryCursor.page,6,platform.id,enabled,'music',
          ...(requestContext ? [undefined,requestContext] as const : []));
        result=await (requestContext ? requestContext.wait(retry) : retry);
      }
      requestContext?.assertActive();
      if (!result.items.length && result.errors.length)
        throw new Error(result.errors.join('；'));
      succeeded = true;
      queryCursor.page += 1;
      const validItems = result.items.filter(item => item.provider === platform.id && isRecommendationMusicCollection(item));
      queryCursor.hasMore = validItems.length > 0 && !validItems.every(item => seenCollections.has(item.id));
      const discovered = random
        ? shuffleHomeMenuSceneValues(validItems, random)
        : validItems;
      for (const item of discovered) {
        if (item.provider !== platform.id || (choice.id==='scene-classical' && item.id==='0') || seenCollections.has(item.id) ||
          !(scene ? matchesSceneCollection(item, scene) : true)) continue;
        seenCollections.add(item.id);
        const position=cursor.collectionPositions?.[item.id];
        collections.push({ item, offset:position?.offset ?? 0, hasMore:position?.hasMore ?? true, query:queryCursor.query });
      }
      return true;
    } catch {
      failed = true;
      return false;
    } finally {
      if (requestContext) console.info('[menu-scene-timing]', JSON.stringify({ choice: choice.id, provider: platform.id,
        route: cursor.queries.indexOf(queryCursor), stage: 'catalog-search',
        ms: Date.now() - startedAt, aborted: requestContext.signal.aborted }));
    }
  };
  const orderedCollections = (items: typeof collections) => {
    const ordered = random ? shuffleHomeMenuSceneValues(items, random) : [...items];
    // A single-artist playlist cannot supply a diverse mode batch by itself.
    // Give sibling playlists a turn before draining another page of the same
    // artists. Scene ordering and its separate artist rules stay unchanged.
    return choice.kind === 'mode' ? ordered.sort((a, b) => a.offset - b.offset) : ordered;
  };
  const prioritizePending = (routes: typeof cursor.queries) => [
    ...routes.filter(route => pendingRoutes.has(route.query)),
    ...routes.filter(route => !pendingRoutes.has(route.query)),
  ];
  const consumeCollections = async () => {
    for (const collection of orderedCollections(collections)) {
      if (enough() || detailRequests >= detailLimit || detailBudget.remaining<=0) break;
      if (!collection.hasMore) continue;
      await readCollection(collection);
    }
  };
  if (choice.id === 'mode-default' && neededDefaultBucket) {
    // Spend this page's existing detail budget on the quota that is missing.
    // A narrow artist playlist gets one page per turn. A member page that
    // supplied fresh independent artists may continue from its saved offset.
    const attempted = new Set<(typeof collections)[number]>();
    const failedRoutes = new Set<string>();
    const servedRoutes = new Set<string>();
    let searches = 0;
    while (!requestContext?.signal.aborted && !enough() && detailRequests < detailLimit && detailBudget.remaining > 0) {
      const bucket = neededDefaultBucket();
      const routes = cursor.queries.filter(route => defaultBucket(route.query) === bucket && !failedRoutes.has(route.query));
      const available = routes.filter(route => route.hasMore || collections.some(item => item.query === route.query && item.hasMore && (!attempted.has(item) || (item.artistYield ?? 0) > 1)));
      if (!available.length) break;
      let progressed = false;
      const wave = [...available.filter(route => !servedRoutes.has(route.query)),
        ...available.filter(route => servedRoutes.has(route.query))].slice(0, 5);
      await Promise.all(wave.map(async route => {
        servedRoutes.add(route.query);
        const members = collections.filter(item => item.query === route.query && item.hasMore);
        let collection = orderedCollections(members.filter(item => (item.artistYield ?? 0) > 1))[0]
          ?? orderedCollections(members.filter(item => !attempted.has(item)))[0];
        if (!collection && route.hasMore && searches < detailLimit) {
          searches += 1;
          progressed = true;
          if (!await discoverCollections(route)) { failedRoutes.add(route.query); return; }
          collection = orderedCollections(collections.filter(item => item.query === route.query && item.hasMore && !attempted.has(item)))[0];
        }
        if (!collection || detailRequests >= detailLimit || detailBudget.remaining <= 0) return;
        attempted.add(collection);
        progressed = true;
        if (!await readCollection(collection)) failedRoutes.add(route.query);
      }));
      if (!progressed) break;
    }
  } else if (requestContext && scheduler) {
    const modeRoutes = [...cursor.queries];
    const routes = prioritizePending(choice.kind === 'mode' ? modeRoutes : random
      ? shuffleHomeMenuSceneValues(cursor.queries, random)
      : cursor.queries);
    // Register synchronously for all providers before the shared scheduler starts.
    const work = routes.map((route, index) => {
      pendingRoutes.add(route.query);
      return scheduler.enqueue(platform.id, index, async () => {
        const startedAt = Date.now();
        try {
          requestContext.assertActive();
          let collection = orderedCollections(collections.filter(item => item.query === route.query && item.hasMore))[0];
          let completed = !route.hasMore;
          if (!collection && route.hasMore) {
            completed = await discoverCollections(route);
            requestContext.assertActive();
            collection = orderedCollections(collections.filter(item => item.query === route.query && item.hasMore))[0];
          }
          if (collection) completed = await readCollection(collection);
          // A literal decade search has one direction; use its existing
          // four-detail budget across returned playlists to fill this batch.
          if (cursor.queries.length === 1 && !enough())
            await consumeCollections();
          requestContext.assertActive();
          if (completed) pendingRoutes.delete(route.query);
          if(choice.kind==='scene'&&!isDecadeChoice(choice.id)) {
            // Include sibling batches already ready in this turn after saving
            // completed positions, without waiting for any pending request.
            await Promise.resolve();
            scheduler.progress();
          }
        } catch { failed = true; }
        finally {
          console.info('[menu-scene-timing]', JSON.stringify({ choice: choice.id, provider: platform.id,
            route: index, stage: 'catalog-route', ms: Date.now() - startedAt, aborted: requestContext.signal.aborted }));
        }
      });
    });
    await Promise.all(work);
    if (choice.kind === 'mode' && !enough() && !requestContext.signal.aborted)
      await consumeCollections();
  } else if (scene && (scene.balancedRecall || allowsSceneLanguageDiversity(scene))) {
    // Give every applicable scene recall route a turn before the pool may stop
    // recall. Leftover candidates count towards their own route, not others.
    const start = cursor.recallRouteIndex ?? 0;
    const routes = prioritizePending(random
      ? shuffleHomeMenuSceneValues(cursor.queries, random)
      : cursor.queries.map((_, index) =>
          cursor.queries[(start + index) % cursor.queries.length]!,
        ));
    const perRoute = Math.ceil(limit / Math.max(1, routes.length));
    for (const route of routes) {
      if (detailRequests >= detailLimit || detailBudget.remaining<=0) break;
      const routeArtists = new Set(candidates
        .filter(item => item.query === route.query)
        .filter(item => !menuDiversityArtists(item.track, choice).some(artist => excludedArtists.has(artist)))
        .flatMap(item => constituentArtists(item.track.artist)));
      if (!pendingRoutes.has(route.query) && routeArtists.size >= perRoute) continue;
      let collection = orderedCollections(collections.filter(
        item => item.query === route.query && item.hasMore,
      ))[0];
      if (!collection && route.hasMore) {
        await discoverCollections(route);
        collection = orderedCollections(collections.filter(
          item => item.query === route.query && item.hasMore,
        ))[0];
      }
      if (collection && await readCollection(collection)) pendingRoutes.delete(route.query);
      else if (!collection && !route.hasMore) pendingRoutes.delete(route.query);
    }
    // Spend any remaining detail budget only after all directions took a turn.
    const ordered = routes.flatMap(route =>
      orderedCollections(collections.filter(item => item.query === route.query && item.hasMore)),
    );
    for (const collection of ordered) {
      if (enough() || detailRequests >= detailLimit || detailBudget.remaining<=0) break;
      await readCollection(collection);
    }
    cursor.recallRouteIndex = (start + 1) % Math.max(1, routes.length);
  } else {
    if (!pendingRoutes.size) await consumeCollections();
    const modeRoutes = [...cursor.queries];
    const routes = prioritizePending(choice.kind === 'mode' ? modeRoutes : random
      ? shuffleHomeMenuSceneValues(cursor.queries, random)
      : cursor.queries);
    for (const queryCursor of routes) {
      if ((!pendingRoutes.has(queryCursor.query) && enough()) || detailRequests >= detailLimit || detailBudget.remaining<=0) break;
      if (pendingRoutes.has(queryCursor.query)) {
        let collection = orderedCollections(collections.filter(item => item.query === queryCursor.query && item.hasMore))[0];
        const discovered = collection || !queryCursor.hasMore ? true : await discoverCollections(queryCursor);
        collection = collection ?? orderedCollections(collections.filter(item => item.query === queryCursor.query && item.hasMore))[0];
        if (collection ? await readCollection(collection) : discovered) pendingRoutes.delete(queryCursor.query);
        continue;
      }
      if (!queryCursor.hasMore) continue;
      const discovered = await discoverCollections(queryCursor);
      await consumeCollections();
      if (discovered && !collections.some(item => item.query === queryCursor.query && item.hasMore && item.offset === 0))
        pendingRoutes.delete(queryCursor.query);
    }
  }
  cursor.collections = collections;
  cursor.seenCollections = [...seenCollections];
  cursor.pendingSceneRoutes = [...pendingRoutes];
  return { candidates, failed: failed && !succeeded &&
    !(excludedArtists.size ? hasEligibleCandidates() : candidates.length) };
}

async function loadProviderCandidates(
  platform: PlatformSetting, choice: HomeMenuChoice,
  cursor: HomeMenuCursor['providers'][number], enabled: PlatformSetting[],
  limit: number, seen: Set<string>, random: (() => number) | undefined,
  excludedArtists: Set<string>, requestContext: CatalogRequestBudget | undefined,
  scheduler: SceneRouteScheduler | undefined, modeSelection: HomeMenuCursor['modeSelection'],
  isBatchReady: () => boolean,
  neededDefaultBucket?: () => DefaultBucket,
) {
  cursor.metadataUnavailable = false;
  const detailLimit = choice.kind === 'mode' ? Math.max(4, Math.min(24, cursor.queries.length * 2)) : 4;
  return loadSceneCollectionCandidates(platform, choice, cursor, enabled, limit, seen, random,
    excludedArtists, requestContext, scheduler, undefined, { remaining: detailLimit }, detailLimit,
    modeSelection, () => scheduler?.progress(), new MenuAlbumRequestQueue(), new Map(), isBatchReady, neededDefaultBucket);
}

function selectHomeMenuCandidates(choice: HomeMenuChoice, cursor: HomeMenuCursor, limit: number,
  excludedArtists: Set<string>, random?: () => number, facts: MenuSelectionFacts = new Map()) {
  const candidateFacts = (candidate: MenuCandidate) => {
    let trackFacts = facts.get(candidate.track);
    if (!trackFacts) { trackFacts = new Map(); facts.set(candidate.track, trackFacts); }
    const key = `${candidate.query}\0${candidate.collection?.provider ?? ''}\0${candidate.collection?.id ?? ''}`;
    let value = trackFacts.get(key);
    if (!value) {
      value = { eligible: isOrdinaryTrack(candidate.track) && matchesChoice(candidate.track, choice, candidate.query, candidate.collection),
        songKey: menuSongKey(candidate.track), artists: menuDiversityArtists(candidate.track, choice) };
      trackFacts.set(key, value);
    }
    return value;
  };
  const recordingPenalty = (candidate: MenuCandidate) => {
    const details = candidateFacts(candidate);
    details.penalty ??= recommendationRecordingPenalty(candidate.track);
    return details.penalty;
  };
  const featuresFor = (candidate: MenuCandidate) => {
    const details = candidateFacts(candidate);
    details.features ??= musicFeatures(candidate.track);
    return details.features;
  };
  const profile=cursor.profile, history=cursor.history;
  const historyIds = new Set(history.map(entry => entry.track.id));
  const pools = cursor.providers.map(result =>
    result.candidates
      .filter(
        candidate =>
          candidateFacts(candidate).eligible,
      )
      .map((candidate, index) => ({
        ...candidate,
        score:
          profileScore(candidate.track, choice, profile, historyIds, index, !random) +
          sceneEvidenceScore(candidate.track, choice, candidate.collection) * 0.25 +
          (random && choice.id === 'mode-explore' ? Math.log1p(Math.max(0,...['popularity','playCount','play_count','listenCount','hot']
            .map(key=>Number(candidate.track.metadata?.[key])||0))) : 0),
      }))
      .sort((left, right) => right.score - left.score),
  );
  if (random) {
    pools.forEach((pool, index) => {
      const uniqueCandidates = new Map<string, (typeof pool)[number]>();
      for (const candidate of pool) {
        const key = menuSongKey(candidate.track);
        if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
      }
      pools[index] = sampleHomeMenuSceneCandidates([...uniqueCandidates.values()], random);
    });
  }
  const tracks: Track[] = [];
  const songs = new Set(cursor.seenSongs);
  const artists = new Set(excludedArtists);
  const sungLanguageCounts = new Map<string, number>();
  const scene = HOME_MENU_RULES[choice.id]!.scene;
  const diversifyLanguages = Boolean(scene && !isDecadeChoice(choice.id) && allowsSceneLanguageDiversity(scene));
  let providerIndex = 0;
  const selection = cursor.modeSelection;
  const mix = cursor.defaultMix;
  const hasFavoriteProfile = Boolean(selection?.preference.statistics.samples);
  const nextDefaultBucket = (): DefaultBucket => !hasFavoriteProfile ? 'popular'
    : mix!.count % 10 === 4 ? 'popular' : mix!.count % 10 === 9 ? 'multilingual' : 'profile';
  const multilingualLanguage = (candidate: MenuCandidate) => {
    const expected = DEFAULT_MULTILINGUAL_QUERIES.find(([query]) => query === candidate.query)?.[1];
    return expected && featuresFor(candidate).languages.includes(expected) ? expected : undefined;
  };
  const decade=cursor.decadeSelection;
  const availableForDecade=(candidate:MenuCandidate)=>
    !songs.has(menuSongKey(candidate.track)) &&
    !menuDiversityArtists(candidate.track,choice).some(artist=>artists.has(artist));
  const targetTotal = (selection?.preference.count ?? 0) + limit;
  const targetRecent = Math.floor(targetTotal * 0.2 + 1e-9);
  const targetChinese = Math.floor(targetTotal * 0.1 + 1e-9);
  const availableForMode = (candidate: MenuCandidate) => {
    if (!selection) return true;
    const value = candidateFacts(candidate);
    if (songs.has(value.songKey) || value.artists.some(artist => artists.has(artist))) return false;
    if (mix) return defaultBucket(candidate.query) === nextDefaultBucket() &&
      (defaultBucket(candidate.query) !== 'multilingual' || Boolean(multilingualLanguage(candidate)));
    if (choice.id === 'mode-memory') return isRecentRelease(candidate.track, selection.now)
      ? selection.recent < targetRecent : selection.preference.count - selection.recent < targetTotal - targetRecent;
    if (choice.id === 'mode-explore') return exploreLanguage(candidate.track) === 'chinese'
      ? selection.chinese < targetChinese : selection.preference.count - selection.chinese < targetTotal - targetChinese;
    return true;
  };
  const modePriority = (candidate: MenuCandidate) => {
    if (!selection) return 0;
    if (choice.id === 'mode-memory') return isRecentRelease(candidate.track, selection.now)
      ? (selection.preference.count + 1) * 0.2 - selection.recent
      : (selection.preference.count + 1) * 0.8 - (selection.preference.count - selection.recent);
    if (choice.id === 'mode-explore') return exploreLanguage(candidate.track) === 'chinese'
      ? (selection.preference.count + 1) * 0.1 - selection.chinese
      : (selection.preference.count + 1) * 0.9 - (selection.preference.count - selection.chinese);
    return 0;
  };
  const deferred: MenuCandidate[][] = pools.map(() => []);
  while (tracks.length < limit && pools.some(pool => pool.length)) {
    let pool = pools[providerIndex % pools.length]!;
    if(decade) {
      const available=pools.filter(items=>items.some(availableForDecade));
      if(!available.length)break;
      if(!available.includes(pool))pool=available[0]!;
      const index=pool.findIndex(availableForDecade);
      pool.unshift(pool.splice(index,1)[0]!);
    }
    if (selection) {
      const available = pools.filter(candidatePool => candidatePool.some(availableForMode));
      if (!available.length) break;
      if (!available.includes(pool)) pool = available[0]!;
      const candidates = pool.map((candidate, index) => ({ candidate, index })).filter(item => availableForMode(item.candidate));
      // Preference state changes after each accepted track. Within this turn
      // compute each deficit once, instead of once for every sort comparison.
      const deficits = new Map<MenuCandidate, number>();
      const deficitFor = (candidate: MenuCandidate) => {
        if (!deficits.has(candidate)) deficits.set(candidate, preferenceDeficit(candidate.track, selection.preference));
        return deficits.get(candidate)!;
      };
      candidates.sort((left, right) => {
        if (mix && nextDefaultBucket() !== 'profile') {
          const recording = recordingPenalty(left.candidate) - recordingPenalty(right.candidate);
          if (recording) return recording;
        }
        if (mix && nextDefaultBucket() === 'multilingual') {
          const count = (candidate: MenuCandidate) => mix.languages[multilingualLanguage(candidate)!] ?? 0;
          const diversity = count(left.candidate) - count(right.candidate);
          if (diversity) return diversity;
        }
        const bucket = modePriority(right.candidate) - modePriority(left.candidate);
        if (Math.abs(bucket) > 1e-9) return bucket;
        if (choice.id === 'mode-explore') {
          const recording= recordingPenalty(left.candidate)-recordingPenalty(right.candidate);
          if(recording) return recording;
          const languageCount = (candidate: MenuCandidate) => Math.min(...featuresFor(candidate).languages.map(language => selection.languages[language] ?? 0));
          const diversity = languageCount(left.candidate) - languageCount(right.candidate);
          if (diversity) return diversity;
          const popularity = (candidate: MenuCandidate) => {
            const metadata = candidate.track.metadata ?? {};
            return Math.max(0, ...['popularity', 'playCount', 'play_count', 'listenCount', 'hot'].map(key => Number(metadata[key]) || 0));
          };
          const popular = random ? 0 : popularity(right.candidate) - popularity(left.candidate);
          if (popular) return popular;
        } else if (!mix || nextDefaultBucket() === 'profile') {
          const deficit = deficitFor(right.candidate) - deficitFor(left.candidate);
          if (Math.abs(deficit) > 1e-9) return deficit;
          const recording= recordingPenalty(left.candidate)-recordingPenalty(right.candidate);
          if(recording) return recording;
        }
        return random ? left.index-right.index : right.candidate.score-left.candidate.score;
      });
      pool.unshift(pool.splice(candidates[0]!.index, 1)[0]!);
    }
    if (diversifyLanguages) {
      const eligible = (candidate: MenuCandidate) =>
        !songs.has(menuSongKey(candidate.track)) &&
        !menuDiversityArtists(candidate.track, choice).some(artist => artists.has(artist));
      const bestIndex = pool.findIndex(eligible);
      const best = pool[bestIndex];
      const bestLanguage = best && sceneSungLanguage(best.track, best.collection);
      if (best && bestLanguage) {
        let selectedIndex = bestIndex;
        let selectedCount = sungLanguageCounts.get(bestLanguage) ?? 0;
        // This only reorders close scores in this provider's turn; no quota,
        // minimum language count, unrelated filler, or artist exception.
        for (let index = bestIndex + 1; index < pool.length; index += 1) {
          const candidate = pool[index]!;
          if (random) {
            if (Math.abs(candidate.score - best.score) > 0.5) continue;
          } else if (candidate.score < best.score - 0.5) break;
          if (!eligible(candidate)) continue;
          const language = sceneSungLanguage(candidate.track, candidate.collection);
          if (!language) continue;
          const count = sungLanguageCounts.get(language) ?? 0;
          if (count < selectedCount) {
            selectedIndex = index;
            selectedCount = count;
          }
        }
        if (selectedIndex !== bestIndex)
          pool.unshift(pool.splice(selectedIndex, 1)[0]!);
      }
    }
    providerIndex += 1;
    const candidate = pool.shift();
    if (!candidate) continue;
    const track = candidate.track;
    const { songKey, artists: artistKeys } = candidateFacts(candidate);
    if (songs.has(songKey)) continue;
    if (artistKeys.some(artist => artists.has(artist))) {
      deferred[pools.indexOf(pool)]!.push(candidate);
      continue;
    }
    songs.add(songKey);
    artistKeys.forEach(artist => artists.add(artist));
    if (diversifyLanguages) {
      const language = sceneSungLanguage(track, candidate.collection);
      if (language) sungLanguageCounts.set(language, (sungLanguageCounts.get(language) ?? 0) + 1);
    }
    tracks.push({
      ...track,
      reason: `${choice.label} · ${track.provider}`,
      metadata: {
        ...track.metadata,
        ...(candidate.collection ? { _recommendationPlaylist: { provider: candidate.collection.provider, id: candidate.collection.id } } : {}),
        ...(mix ? { _recommendationBucket: defaultBucket(candidate.query) } : {}),
      },
    });
    if(decade) decade.artists=[...artists];
    if (selection) {
      if (!mix || defaultBucket(candidate.query) === 'profile') acceptPreferenceTrack(selection.preference, track);
      if (mix) {
        mix.count += 1;
        if (defaultBucket(candidate.query) === 'popular') mix.popular += 1;
        if (defaultBucket(candidate.query) === 'multilingual') {
          mix.multilingual += 1;
          const language = multilingualLanguage(candidate)!;
          mix.languages[language] = (mix.languages[language] ?? 0) + 1;
        }
      }
      if (isRecentRelease(track, selection.now)) selection.recent += 1;
      if (exploreLanguage(track) === 'chinese') selection.chinese += 1;
      for (const language of featuresFor(candidate).languages) selection.languages[language] = (selection.languages[language] ?? 0) + 1;
    }
  }
  cursor.providers.forEach((provider, index) => {
    provider.candidates = [...deferred[index]!, ...pools[index]!].filter(
      candidate => !songs.has(menuSongKey(candidate.track)) && (!decade ||
        !menuDiversityArtists(candidate.track,choice).some(artist=>artists.has(artist))),
    );
  });
  cursor.seenSongs = [...songs];
  const hasMore = cursor.providers.some(
    provider =>
      provider.candidates.length > 0 ||
      provider.collections?.some(collection => collection.hasMore) ||
      provider.queries.some(query => query.hasMore),
  );
  // Deferred same-artist songs remain valid for ordinary later pages, but
  // cannot keep this initial twenty-song artist-constrained phase alive.
  const hasMoreForMenuBatch = cursor.providers.some(provider =>
    provider.candidates.some(candidate =>
      !menuDiversityArtists(candidate.track, choice).some(artist => artists.has(artist))) ||
    provider.collections?.some(collection => collection.hasMore) ||
    provider.queries.some(query => query.hasMore),
  );
  return {tracks:decade ? shuffleHomeMenuSceneValues(tracks,random) : tracks,hasMore,hasMoreForMenuBatch};
}

export async function loadHomeMenuPage(
  choiceId: string,
  platforms: PlatformSetting[],
  profile: MusicProfile,
  history: HistoryEntry[],
  limit = HOME_MENU_BATCH_SIZE,
  previous?: HomeMenuCursor,
  options?: HomeMenuPageOptions,
) {
  const choice = HOME_MENU_CHOICES.find(item => item.id === choiceId);
  if (!choice) throw new Error('未找到对应的歌曲分类');
  const startedAt = Date.now();
  const random = options?.randomizeBatch || previous?.randomizeBatch || (choice.kind === 'scene' && options?.randomizeSceneBatch)
    ? options?.random ?? Math.random
    : undefined;
  const excludedArtists = new Set([...(options?.excludedArtists ?? []),...(previous?.decadeSelection?.artists ?? [])]);
  const enabled = platforms.filter(platform => platform.enabled);
  if (!enabled.length) throw new Error('本次启动没有可用的音乐平台');
  const queries = previous ? [] : queriesFor(choice, profile, history);
  const progress = compatibleMenuProgress(choiceId,options?.progress);
  const cursor: HomeMenuCursor = previous
    ? {
        ...cloneHomeMenuCursor(previous),
        profile,
        history,
      }
    : {
        choiceId,
        profile,
        history,
        randomizeBatch:options?.randomizeBatch,
        batchRevision:Math.max(Date.now(),(progress?.revision ?? 0)+1),
        ...(progress?.round ? {catalogRound:progress.round} : {}),
        recentTrackKeys:progress?.recentTrackKeys ?? [],
        providers: enabled.map(p => ({
          id: p.id,
          queries: queries.map(query => ({ query, page:1, hasMore:true, ...progress?.queries[menuQueryProgressKey(choiceId,query)] })),
          recentTrackKeys:progress?.recentTrackKeys ?? [],
          collectionPositions:progress?.collections,
          candidates: [],
        })),
        seenSongs: [],
      };
  if (choice.kind === 'mode' && !cursor.modeSelection) cursor.modeSelection = {
    preference: createPreferenceSelection(choice.id === 'mode-explore' ? emptyMusicStatistics() : statisticsFor(choice, profile, history)),
    recent: 0, chinese: 0, languages: {}, now: Date.now(),
  };
  if (choiceId === 'mode-default') cursor.defaultMix ??= { count: 0, popular: 0, multilingual: 0, languages: {} };
  if(isDecadeChoice(choiceId))cursor.decadeSelection ??= {artists:[]};
  if (!previous && cursor.modeSelection) console.info('[menu-profile]', JSON.stringify({choice:choiceId,
    samples:cursor.modeSelection.preference.statistics.samples,
    distributions:cursor.modeSelection.preference.statistics.distributions}));
  cursor.providers = cursor.providers.filter(provider =>
    enabled.some(platform => platform.id === provider.id),
  );
  if (cursor.choiceId !== choiceId) throw new Error('歌曲分类续页不匹配');
  const requestTiming=(timing: import('./catalogRequestBudget').CatalogRequestTiming)=>
    console.info('[menu-catalog-request]',JSON.stringify({choice:choiceId,...timing}));
  const budget = choice.kind === 'scene' && options?.firstSceneBudgetMs !== undefined
    ? new CatalogRequestBudget(Math.max(1, options.firstSceneBudgetMs - (Date.now() - startedAt)), 5, options.signal,requestTiming)
    : options?.signal ? new CatalogRequestBudget(options.catalogBudgetMs ?? 12_000,5,options.signal,requestTiming) : undefined;
  const scheduler = budget ? new SceneRouteScheduler() : undefined;
  const seen = new Set(cursor.seenSongs);
  const catalogPositions=() => JSON.stringify(cursor.providers.map(provider=>({queries:provider.queries,
    collections:provider.collections?.map(collection=>({id:collection.item.id,offset:collection.offset,hasMore:collection.hasMore}))})));
  const beforePositions=catalogPositions();
  const satisfiesProfile = (preview: HomeMenuCursor) => {
    const preference = preview.modeSelection?.preference;
    return !preference || (['genres', 'styles', 'languages', 'moods'] as const).every(dimension =>
      Object.entries(preference.statistics.distributions[dimension]).every(([key, weight]) => key === '__unknown__' ||
        (preference.counts[dimension][key] ?? 0) + 1e-9 >= Math.round(preference.count * weight)));
  };
  const facts: MenuSelectionFacts = new Map();
  let cachedSelection: { pools: { candidates: MenuCandidate[]; count: number }[]; cursor: HomeMenuCursor; result: ReturnType<typeof selectHomeMenuCandidates> } | undefined;
  const previewSelection = () => {
    if (!cachedSelection || cursor.providers.some((provider, index) =>
      cachedSelection!.pools[index]?.candidates !== provider.candidates || cachedSelection!.pools[index]?.count !== provider.candidates.length)) {
      const preview = cloneHomeMenuCursor(cursor);
      const result = selectHomeMenuCandidates(choice, preview, limit, excludedArtists, random, facts);
      cachedSelection = { pools: cursor.providers.map(provider => ({ candidates: provider.candidates, count: provider.candidates.length })), cursor: preview, result };
    }
    return cachedSelection;
  };
  const requests =
    cursor.providers.map(provider =>
      loadProviderCandidates(
        enabled.find(p => p.id === provider.id)!,
        choice,
        provider,
        enabled,
        limit,
        seen,
        random,
        excludedArtists,
        budget,
        scheduler,
        cursor.modeSelection,
        () => {
          const preview = previewSelection();
          return preview.result.tracks.length === limit && (choiceId !== 'mode-default' || satisfiesProfile(preview.cursor));
        },
        choiceId === 'mode-default' ? () => {
          const selection = previewSelection();
          const preview = selection.cursor;
          if (selection.result.tracks.length === limit && !satisfiesProfile(preview)) return 'profile';
          return !preview.modeSelection?.preference.statistics.samples ? 'popular'
            : preview.defaultMix!.count % 10 === 4 ? 'popular' : preview.defaultMix!.count % 10 === 9 ? 'multilingual' : 'profile';
        } : undefined,
      ),
    );
  let earlySelection: {cursor:HomeMenuCursor;result:ReturnType<typeof selectHomeMenuCandidates>} | undefined;
  let settled: Awaited<ReturnType<typeof loadProviderCandidates>>[];
  try {
    if (budget && scheduler) await scheduler.start(cursor.providers.map(provider => provider.id), budget, () => {
      const { cursor: preview, result } = previewSelection();
      if(result.tracks.length!==limit)return false;
      if (choice.kind === 'mode') {
        if(choice.id!=='mode-default' && choice.id!=='mode-memory' && choice.id!=='mode-explore') return false;
        if(choice.id!=='mode-explore' && !satisfiesProfile(preview)) return false;
      }
      earlySelection={cursor:preview,result};
      return true;
    },choiceId==='mode-memory'||choiceId==='mode-explore'||(choice.kind==='scene'&&!isDecadeChoice(choiceId)));
    settled = await Promise.all(requests);
  } finally {
    const aborted = budget?.expired;
    budget?.close();
    if (budget) console.info('[menu-scene-timing]', JSON.stringify({ choice: choiceId, stage: 'catalog',
      ms: Date.now() - startedAt, deadlineReached: aborted }));
  }
  if (!earlySelection && settled.every(result => result.failed))
    throw new HomeMenuLoadError(`${choice.label}目录请求失败，请重试`,'request',cursor);
  earlySelection ??= previewSelection();
  if(earlySelection) {
    cursor.seenSongs=earlySelection.cursor.seenSongs;
    cursor.modeSelection=earlySelection.cursor.modeSelection;
    cursor.defaultMix=earlySelection.cursor.defaultMix;
    cursor.decadeSelection=earlySelection.cursor.decadeSelection;
    cursor.providers.forEach((provider,index)=>{provider.candidates=earlySelection!.cursor.providers[index]!.candidates;});
  }
  const {tracks,hasMore,hasMoreForMenuBatch}=earlySelection?.result ?? selectHomeMenuCandidates(choice,cursor,limit,excludedArtists,random);
  if(cursor.decadeSelection && tracks.length)console.info('[menu-decade-batch]',JSON.stringify({
    choice:choiceId,revision:cursor.batchRevision,count:tracks.length,total:cursor.seenSongs.length,
    artistSlots:cursor.decadeSelection.artists.length,keys:tracks.map(trackQueueKey),
  }));
  // An advancing short/empty continuation remains resumable. Only a first
  // batch or a stalled quota search uses the explicit retry boundary.
  if ((!previous || (choice.kind === 'mode' && hasMore && beforePositions===catalogPositions())) && !tracks.length)
    throw new HomeMenuLoadError(budget?.expired
      ? `${choice.label}目录请求超时，请重试`
      : cursor.providers.some(provider=>provider.metadataUnavailable) ? `${choice.label}歌曲年份或语种资料不足，请重试`
      : hasMore ? `${choice.label}本批筛选或配额所需歌曲暂缺，请重试`
      : `${choice.label}已查询的目录暂无匹配歌曲`, hasMore || budget?.expired ? 'incomplete' : 'empty',cursor);
  return { tracks, cursor, hasMore,
    ...(options?.excludedArtists !== undefined
      ? { hasMoreForMenuBatch } : {}),
  };
}

/** Launch and the drawer share the same first-five deadline, retry and cursor. */
export async function loadHomeMenuFirstBatch(
  choiceId: string,
  platforms: PlatformSetting[],
  profile: MusicProfile,
  history: HistoryEntry[],
  options?: HomeMenuPageOptions,
) {
  const choice = HOME_MENU_CHOICES.find(item => item.id === choiceId);
  if (!choice) throw new Error('未找到对应的歌曲分类');
  const scene = choice.kind === 'scene';
  const deadline = Date.now() + (scene ? HOME_MENU_SCENE_CATALOG_BUDGET_MS : 12_000);
  const active = () => {
    if (options?.signal?.aborted) throw new Error('分类请求已取消');
  };
  const position = (cursor: HomeMenuCursor) => JSON.stringify({ seen: cursor.seenSongs,
    providers: cursor.providers.map(provider => ({ queries: provider.queries,
      collections: provider.collections?.map(item => ({ id: item.item.id, offset: item.offset, hasMore: item.hasMore })) })) });
  const pageOptions = (remaining: number): HomeMenuPageOptions => ({ ...options, randomizeBatch: true,
    ...(scene ? { firstSceneBudgetMs: remaining } : { catalogBudgetMs: remaining }) });
  let firstError: HomeMenuLoadError | undefined;
  let result: Awaited<ReturnType<typeof loadHomeMenuPage>>;
  active();
  try {
    result = await loadHomeMenuPage(choiceId, platforms, profile, history, HOME_MENU_FIRST_BATCH_SIZE,
      undefined, pageOptions(Math.max(1, deadline - Date.now())));
  } catch (error) {
    active();
    if (!(error instanceof HomeMenuLoadError) || error.reason !== 'incomplete' || Date.now() >= deadline) throw error;
    firstError = error;
    result = { tracks: [], cursor: error.cursor, hasMore: true };
  }
  active();
  const tracks = [...result.tracks];
  const keys = new Set(tracks.map(trackQueueKey));
  while (tracks.length < HOME_MENU_FIRST_BATCH_SIZE && result.hasMore && Date.now() < deadline) {
    const previousPosition = position(result.cursor);
    try {
      const more = await loadHomeMenuPage(choiceId, platforms, profile, history,
        HOME_MENU_FIRST_BATCH_SIZE - tracks.length, result.cursor, {
          ...pageOptions(Math.max(1, deadline - Date.now())),
          excludedArtists: [...new Set(tracks.flatMap(item => constituentArtists(item.artist)))],
        });
      active();
      for (const track of more.tracks) if (!keys.has(trackQueueKey(track))) {
        keys.add(trackQueueKey(track)); tracks.push(track);
      }
      result = { ...more, tracks };
      if (position(more.cursor) === previousPosition) break;
    } catch (error) {
      active();
      if (error instanceof HomeMenuLoadError && error.reason === 'incomplete' && Date.now() < deadline &&
        position(error.cursor) !== previousPosition) {
        firstError = error; result = { tracks, cursor: error.cursor, hasMore: true }; continue;
      }
      if (!(error instanceof HomeMenuLoadError) || !tracks.length) throw error;
      console.info('[menu-first-batch]', JSON.stringify({ choice: choiceId, count: tracks.length, reason: error.reason }));
      break;
    }
  }
  active();
  if (!tracks.length) throw result.hasMore ? firstError ?? new Error(`${choice.label}暂时没有新的可播放歌曲`)
    : new HomeMenuLoadError(`${choice.label}已查询的目录暂无匹配歌曲`, 'empty', result.cursor);
  return { ...result, tracks };
}

export async function loadHomeMenuTracks(
  choiceId: string,
  platforms: PlatformSetting[],
  profile: MusicProfile,
  history: HistoryEntry[],
  limit = HOME_MENU_BATCH_SIZE,
) {
  return (await loadHomeMenuPage(choiceId, platforms, profile, history, limit))
    .tracks;
}
