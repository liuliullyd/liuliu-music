import type {
  HistoryEntry,
  MusicPreferenceDimension,
  MusicPreferenceStatistics,
  MusicProfile,
  Track,
} from '../domain/types';
import { constituentArtists } from './recommendation';
const dimensions: MusicPreferenceDimension[] = [
  'genres',
  'styles',
  'languages',
  'moods',
  'artists',
];
const proportionalDimensions = dimensions.filter(
  dimension => dimension !== 'artists',
);
const unknown = '__unknown__';
const emptyDimensions = () =>
  Object.fromEntries(
    dimensions.map(dimension => [dimension, {}]),
  ) as MusicPreferenceStatistics['distributions'];
export const emptyMusicStatistics = (): MusicPreferenceStatistics => ({
  version: 1,
  samples: 0,
  distributions: emptyDimensions(),
});
const aliases: Record<string, string> = {
  rock: '摇滚',
  pop: '流行',
  folk: '民谣',
  jazz: '爵士',
  classical: '古典',
  electronic: '电子',
  metal: '金属',
  'hip-hop': '嘻哈',
  hiphop: '嘻哈',
  'r&b': 'R&B',
  blues: '蓝调',
};
const languages: Array<[RegExp, string]> = [
  [/^(?:粤语|廣東話|广东话|cantonese|yue)$/i, '粤语'],
  [
    /^(?:国语|普通话|华语|中文|汉语|汉语普通话|chinese|mandarin|zh|zh-cn|cmn)$/i,
    '国语',
  ],
  [/^(?:客家话|客家语|hakka)$/i, '客家话'],
  [/^(?:闽南语|台语|hokkien)$/i, '闽南语'],
  [/^(?:吴语|沪语|上海话|shanghainese|wu)$/i, '吴语'],
  [/^(?:潮汕话|潮州话|teochew)$/i, '潮汕话'],
  [/^(?:四川话|四川方言|sichuanese)$/i, '四川话'],
  [/^(?:英语|英文|english|en)$/i, '英语'],
  [/^(?:法语|french|fr)$/i, '法语'],
  [/^(?:日语|日本語|japanese|ja)$/i, '日语'],
  [/^(?:韩语|韩国语|한국어|korean|ko)$/i, '韩语'],
  [/^(?:西班牙语|西语|spanish|es)$/i, '西班牙语'],
  [/^(?:葡萄牙语|葡语|portuguese|pt)$/i, '葡萄牙语'],
  [/^(?:德语|german|de)$/i, '德语'],
  [/^(?:俄语|russian|ru)$/i, '俄语'],
  [/^(?:意大利语|italian|it)$/i, '意大利语'],
  [/^(?:泰语|thai|th)$/i, '泰语'],
  [/^(?:越南语|vietnamese|vi)$/i, '越南语'],
  [/^(?:印地语|hindi|hi)$/i, '印地语'],
  [/^(?:阿拉伯语|arabic|ar)$/i, '阿拉伯语'],
  [/^(?:土耳其语|turkish|tr)$/i, '土耳其语'],
  [/^(?:马来语|malay|ms)$/i, '马来语'],
  [/^(?:印尼语|indonesian|id)$/i, '印尼语'],
  [/^(?:纯音乐|instrumental|无词)$/i, '纯音乐'],
];
const validLabel = (value: string) =>
  value.length <= 64 &&
  !/^(?:unknown|未知|其他|其它|发现|未分类|null|undefined|\d+|__proto__|constructor|prototype)$/i.test(
    value,
  );
const explicitLanguage = (value: string) => {
  const canonical = languages.find(([pattern]) => pattern.test(value))?.[1];
  if (canonical) return canonical;
  if (
    /^(?:欧美|日韩|世界|混合|多语种|多语言|其他语种|acg|other|others|various|multiple|unspecified|unknown|mixed|world|n\/a)$/i.test(
      value,
    )
  )
    return '';
  return /^[\p{L} -]+语$/u.test(value) || /^[a-z][a-z '-]{2,}$/i.test(value)
    ? value.toLowerCase()
    : '';
};
const labels = (...values: unknown[]): string[] => [
  ...new Set(
    values.flatMap(value => {
      if (Array.isArray(value)) return labels(...value);
      if (value && typeof value === 'object')
        return labels((value as Record<string, unknown>).name);
      return typeof value === 'string'
        ? value
            .split(/\s*[,，;；、|/]\s*/)
            .map(label => label.trim())
            .filter(label => label && validLabel(label))
        : [];
    }),
  ),
];
/** Source metadata only: onlineCatalog's presentation defaults are not evidence. */
export function musicFeatures(
  track: Track,
): Record<MusicPreferenceDimension, string[]> {
  const metadata = track.metadata ?? {};
  const trans =
    metadata.trans_param && typeof metadata.trans_param === 'object'
      ? (metadata.trans_param as Record<string, unknown>)
      : {};
  const genre = labels(
    metadata.genre,
    metadata.Genre,
    trans.genre,
    metadata.genres,
    track.genre !== '流行' ? track.genre : undefined,
  );
  const language = labels(
    metadata.language,
    metadata.languageName,
    metadata.language_name,
    metadata.lang,
    metadata.songLanguage,
    metadata.song_language,
    trans.language,
  );
  return {
    genres: [
      ...new Set(
        genre.map(value => aliases[value.toLowerCase()] ?? value.toLowerCase()),
      ),
    ],
    styles: [
      ...new Set(
        labels(
          metadata.style,
          metadata.Style,
          metadata.styles,
          trans.style,
        ).map(value => value.toLowerCase()),
      ),
    ],
    languages: [...new Set(language.map(explicitLanguage).filter(Boolean))],
    moods: [
      ...new Set(
        labels(
          metadata.mood,
          metadata.moods,
          metadata.emotion,
          track.mood !== '发现' ? track.mood : undefined,
        ).map(value => value.toLowerCase()),
      ),
    ],
    artists: [
      ...new Set(
        constituentArtists(
          typeof track.artist === 'string' ? track.artist : '',
        ).filter(
          value =>
            value &&
            validLabel(value) &&
            !/未知歌手|unknown artist/i.test(value),
        ),
      ),
    ],
  };
}
function featureWeights(track: Track, dimension: MusicPreferenceDimension) {
  const values = musicFeatures(track)[dimension];
  return values.length
    ? Object.fromEntries(values.map(value => [value, 1 / values.length]))
    : { [unknown]: 1 };
}
export function accumulateMusicStatistics(
  previous: MusicPreferenceStatistics,
  track: Track,
): MusicPreferenceStatistics {
  const samples = Math.min(100, previous.samples + 1);
  const weight = 1 / samples;
  const distributions = emptyDimensions();
  for (const dimension of dimensions) {
    const current = featureWeights(track, dimension);
    const old = previous.distributions[dimension];
    for (const key of new Set([...Object.keys(old), ...Object.keys(current)]))
      distributions[dimension][key] =
        (old[key] ?? 0) * (1 - weight) + (current[key] ?? 0) * weight;
  }
  return { version: 1, samples, distributions };
}
/** Exact current-set percentages, also used once to seed legacy unique history. */
export function statisticsFromTracks(
  tracks: Track[],
): MusicPreferenceStatistics {
  const music = tracks.filter(track => true);
  if (!music.length) return emptyMusicStatistics();
  const distributions = emptyDimensions();
  for (const track of music)
    for (const dimension of dimensions)
      for (const [key, weight] of Object.entries(
        featureWeights(track, dimension),
      ))
        distributions[dimension][key] =
          (distributions[dimension][key] ?? 0) + weight;
  for (const dimension of dimensions)
    for (const key of Object.keys(distributions[dimension]))
      distributions[dimension][key] /= music.length;
  return { version: 1, samples: Math.min(100, music.length), distributions };
}
export function normalizeMusicStatistics(
  value: unknown,
): MusicPreferenceStatistics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as MusicPreferenceStatistics;
  if (
    candidate.version !== 1 ||
    !Number.isInteger(candidate.samples) ||
    candidate.samples < 0 ||
    candidate.samples > 100
  )
    return undefined;
  const distributions = emptyDimensions();
  for (const dimension of dimensions) {
    const raw = candidate.distributions?.[dimension];
    const entries =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.entries(raw).filter(
            ([key, weight]) =>
              (key === unknown || validLabel(key)) &&
              typeof weight === 'number' &&
              Number.isFinite(weight) &&
              weight > 0,
          )
        : [];
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    distributions[dimension] =
      total > 0 && Number.isFinite(total)
        ? Object.fromEntries(
            entries.map(([key, weight]) => [
              key,
              Math.abs(total - 1) < 1e-12 ? weight : weight / total,
            ]),
          )
        : candidate.samples
        ? { [unknown]: 1 }
        : {};
  }
  return { version: 1, samples: candidate.samples, distributions };
}
export function memoryStatisticsFor(
  profile: MusicProfile,
  history: HistoryEntry[],
) {
  return (
    normalizeMusicStatistics(profile.memoryStatistics) ??
    statisticsFromTracks(
      [...history]
        .filter(entry => Number.isFinite(entry.playedAt))
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, 100)
        .map(entry => entry.track),
    )
  );
}
export function favoriteStatisticsFor(state: {
  savedTracks: Track[];
  favorites: string[];
}) {
  const favorites = new Set(state.favorites ?? []);
  const unique = new Map(
    (state.savedTracks ?? [])
      .filter(track => favorites.has(track.id))
      .map(track => [track.id, track]),
  );
  return statisticsFromTracks([...unique.values()]);
}
export function preferenceQueries(statistics: MusicPreferenceStatistics) {
  const routes = dimensions.map(dimension =>
    Object.entries(statistics.distributions[dimension])
      .filter(([key, weight]) => key !== unknown && weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => (dimension === 'languages' ? `${key} 歌曲` : key)),
  );
  return [
    ...new Set(
      Array.from({ length: 3 }, (_, index) =>
        routes.flatMap(route => (route[index] ? [route[index]!] : [])),
      ).flat(),
    ),
  ];
}
export interface PreferenceSelection {
  statistics: MusicPreferenceStatistics;
  count: number;
  counts: MusicPreferenceStatistics['distributions'];
}
export const createPreferenceSelection = (
  statistics: MusicPreferenceStatistics,
): PreferenceSelection => ({ statistics, count: 0, counts: emptyDimensions() });
export function clonePreferenceSelection(
  state: PreferenceSelection,
): PreferenceSelection {
  return {
    statistics: {
      ...state.statistics,
      distributions: Object.fromEntries(
        dimensions.map(dimension => [
          dimension,
          { ...state.statistics.distributions[dimension] },
        ]),
      ) as MusicPreferenceStatistics['distributions'],
    },
    count: state.count,
    counts: Object.fromEntries(
      dimensions.map(dimension => [dimension, { ...state.counts[dimension] }]),
    ) as MusicPreferenceStatistics['distributions'],
  };
}
export function preferenceDeficit(track: Track, state: PreferenceSelection) {
  const features = musicFeatures(track);
  return proportionalDimensions.reduce((score, dimension) => {
    if (
      !Object.entries(state.statistics.distributions[dimension]).some(
        ([key, weight]) => key !== unknown && weight > 0,
      )
    )
      return score;
    const values = features[dimension];
    return (
      score +
      values.reduce(
        (sum, key) =>
          sum +
          ((state.count + 1) *
            (state.statistics.distributions[dimension][key] ?? 0) -
            (state.counts[dimension][key] ?? 0)),
        0,
      ) /
        Math.max(1, values.length)
    );
  }, 0);
}
export function acceptPreferenceTrack(
  state: PreferenceSelection,
  track: Track,
) {
  state.count += 1;
  for (const dimension of dimensions)
    for (const [key, weight] of Object.entries(
      featureWeights(track, dimension),
    ))
      state.counts[dimension][key] =
        (state.counts[dimension][key] ?? 0) + weight;
}
/** No fallback to Track.releaseYear: onlineCatalog supplies a default current year. */
export function confirmedReleaseDate(track: Track): number | undefined {
  const metadata = track.metadata ?? {};
  const album =
    metadata.album && typeof metadata.album === 'object'
      ? (metadata.album as Record<string, unknown>)
      : metadata.al && typeof metadata.al === 'object'
      ? (metadata.al as Record<string, unknown>)
      : {};
  for (const source of [metadata, album])
    for (const field of [
      'releaseDate',
      'ReleaseDate',
      'PublishDate',
      'publishDate',
      'publish_date',
      'PublishTime',
      'release_date',
      'publishTime',
      'publish_time',
      'pub_time',
      'publicTime',
      'public_time',
      'issueDate',
      'issue_date',
    ]) {
      const value = source[field];
      let timestamp: number;
      const numeric =
        typeof value === 'number' ||
        (typeof value === 'string' && /^(?:\d{10}|\d{13})$/.test(value))
          ? Number(value)
          : NaN;
      if (numeric >= 1000000000)
        timestamp = numeric < 10000000000 ? numeric * 1000 : numeric;
      else if (typeof value === 'string') {
        const parts = value.match(
          /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/,
        );
        if (!parts) continue;
        const date = new Date(
          Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])),
        );
        if (
          date.getUTCFullYear() !== Number(parts[1]) ||
          date.getUTCMonth() + 1 !== Number(parts[2]) ||
          date.getUTCDate() !== Number(parts[3])
        )
          continue;
        timestamp = Date.parse(value.replace(/\//g, '-'));
      } else continue;
      if (Number.isFinite(timestamp)) return timestamp;
    }
  return undefined;
}
export function isRecentRelease(track: Track, now = Date.now()) {
  const date = confirmedReleaseDate(track);
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return date !== undefined && date >= cutoff.getTime() && date <= now;
}
export function confirmedReleaseYear(track: Track): number | undefined {
  const date = confirmedReleaseDate(track);
  if (date !== undefined) return new Date(date).getUTCFullYear();
  const metadata = track.metadata ?? {};
  for (const value of [
    metadata.releaseYear,
    metadata.release_year,
    metadata.year,
  ]) {
    const year = Number(value);
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) return year;
  }
  // Earlier years cannot have come from onlineCatalog's current-year fallback.
  return track.releaseYear >= 1900 &&
    track.releaseYear < new Date().getFullYear()
    ? track.releaseYear
    : undefined;
}
export const isChineseLanguage = (language: string) =>
  /^(?:国语|粤语|闽南语|客家话|台语|吴语|潮汕话|四川话)$/.test(language);
export function exploreLanguage(
  track: Track,
): 'chinese' | 'foreign' | undefined {
  const values = musicFeatures(track).languages.filter(
    language => language !== '纯音乐',
  );
  if (!values.length) return undefined;
  return values.some(isChineseLanguage) ? 'chinese' : 'foreign';
}
