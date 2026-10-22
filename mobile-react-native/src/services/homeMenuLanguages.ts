import type { CatalogItem, Track } from '../domain/types';
import type { HomeMenuSceneRule } from './homeMenuScenes';

/** Scene-only signals; never change the shared catalogue's language enum. */
export function allowsSceneLanguageDiversity(scene: HomeMenuSceneRule) {
  return !scene.region && !scene.artistPattern && scene.vocals !== 'instrumental';
}

// These are music styles and moods, not searches for the scene's name or a
// fixed song/artist list. Existing scene constraints still validate every hit.
const recallStyles: Readonly<Record<string, readonly [string, string]>> = {
  'scene-sleep': ['舒缓人声', 'Soft Vocal Ballads'],
  'scene-deep-emo': ['忧郁抒情', 'Melancholy Ballads'],
  'scene-dynamic-dj': ['高能电子舞曲', 'High Energy EDM'],
  'scene-commute': ['轻快原声流行', 'Upbeat Acoustic Pop'],
  'scene-happy': ['欢快流行', 'Happy Pop'],
  'scene-ktv': ['经典流行金曲', 'Sing Along Pop Hits'],
  'scene-nostalgia': ['怀旧经典金曲', 'Classic Oldies'],
  'scene-chinese-style': ['禅意国风', 'Chinese Traditional Fusion'],
  'scene-workout': ['强节奏高能流行', 'High Energy Pop'],
  'scene-city': ['都会流行 R&B', 'Urban R&B Funk Soul'],
  'scene-ost': ['影视原声', 'Film Soundtracks'],
  'scene-defjam': ['嘻哈说唱', 'Hip Hop Rap'],
  'scene-slacking': ['慵懒流行', 'Chill Pop'],
  'scene-rock': ['摇滚', 'Rock'],
  'scene-rnb': ['节奏蓝调', 'R&B Soul'],
  'scene-relax': ['舒缓民谣', 'Acoustic Chill'],
  'scene-children': ['童谣儿歌', 'Nursery Rhymes'],
  'scene-electronic': ['电子舞曲', 'Electronic Dance'],
  'scene-rap': ['嘻哈说唱', 'Hip Hop Rap'],
  'scene-travel': ['轻快公路摇滚', 'Road Trip Rock'],
  'scene-shower': ['轻快流行金曲', 'Sing Along Pop'],
  'scene-classical': ['古典声乐', 'Classical Vocal Opera'],
  'scene-night': ['夜间慵懒爵士', 'Late Night Jazz'],
  'scene-healing': ['温暖治愈歌曲', 'Comfort Songs'],
  'scene-bistro': ['爵士蓝调', 'Lounge Jazz Blues'],
  'scene-romance': ['浪漫情歌', 'Romantic Love Songs'],
  'scene-zen': ['放下释然 舒缓民谣', 'Letting Go Acoustic Folk'],
  'scene-rain': ['柔和原声民谣', 'Mellow Acoustic'],
  'scene-beach': ['夏日轻快流行', 'Summer Pop Reggae'],
  'scene-country': ['乡村音乐', 'Country Music'],
  'scene-breakup': ['伤心情歌', 'Heartbreak Ballads'],
  'scene-game': ['高燃电音 快节奏战歌', 'High Energy EDM Battle Anthems'],
  'scene-campus': ['青春校园民谣', 'Campus Folk'],
  'scene-wakeup': ['积极轻快流行', 'Upbeat Pop Funk'],
};

export function sceneRecallQueries(
  choiceId: string,
  scene: HomeMenuSceneRule,
  existing: readonly string[],
) {
  const styles = recallStyles[choiceId];
  if (!styles || !allowsSceneLanguageDiversity(scene)) return [...existing];
  const [localStyle, internationalStyle] = styles;
  // Zen keeps its four independently approved content routes first, then
  // rotates through multilingual vocal recall with the same detail budget.
  const directions = [`华语 ${localStyle}`, `英文 ${internationalStyle}`,
    `日语 ${localStyle}`, `韩语 ${localStyle}`];
  return [...new Set(choiceId === 'scene-zen'
    ? [...existing, ...directions]
    : [...directions, ...existing])];
}

const values = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return ['name', 'label', 'value', 'text', 'language'].flatMap(key => values(item[key]));
  }
  return typeof value === 'string' ? [value] : [];
};
const languageKeys = ['language', 'languageName', 'language_name', 'lang',
  'songLanguage', 'song_language', 'lyricLanguage', 'lyric_language'];
const aliases: readonly (readonly [string, RegExp])[] = [
  ['yue', /粤语|粵語|广东话|廣東話|\bcantonese\b|^yue(?:[-_]|$)/i],
  ['zh', /华语|華語|国语|國語|普通话|普通話|中文|\bmandarin\b|\bchinese\b|^zh(?:[-_]|$)/i],
  ['en', /英语|英語|英文|\benglish\b|^(?:en|eng)(?:[-_]|$)/i],
  ['ja', /日语|日語|日本語|\bjapanese\b|^(?:ja|jpn)(?:[-_]|$)/i],
  ['ko', /韩语|韓語|한국어|\bkorean\b|^(?:ko|kor)(?:[-_]|$)/i],
  ['es', /西班牙语|西班牙語|\bspanish\b|\bespañol\b|^(?:es|spa)(?:[-_]|$)/i],
  ['fr', /法语|法語|\bfrench\b|\bfrançais\b|^(?:fr|fra|fre)(?:[-_]|$)/i],
  ['pt', /葡萄牙语|葡萄牙語|\bportuguese\b|\bportuguês\b|^(?:pt|por)(?:[-_]|$)/i],
  ['de', /德语|德語|\bgerman\b|\bdeutsch\b|^(?:de|deu|ger)(?:[-_]|$)/i],
  ['ru', /俄语|俄語|\brussian\b|^(?:ru|rus)(?:[-_]|$)/i],
  ['hi', /印地语|印地語|\bhindi\b|^hi(?:[-_]|$)/i],
  ['th', /泰语|泰語|\bthai\b|^th(?:[-_]|$)/i],
  ['vi', /越南语|越南語|\bvietnamese\b|^vi(?:[-_]|$)/i],
];
function languagesIn(texts: string[]) {
  return new Set(texts.flatMap(text =>
    aliases.filter(([, pattern]) => pattern.test(text.trim())).map(([id]) => id)));
}

/** Only explicit, single-language collection classification; never query text. */
function collectionSungLanguages(collection: CatalogItem) {
  return languagesIn([collection.title,
    ...languageKeys.flatMap(key=>values(collection.metadata?.[key])),
    ...values(collection.metadata?.tags)]);
}
export function sceneCollectionSungLanguage(collection: CatalogItem) {
  const languages=collectionSungLanguages(collection);
  return languages.size===1 ? [...languages][0] : undefined;
}

/** Undefined means unknown or mixed; instrumental is never a sung language. */
export function sceneSungLanguage(track: Track, collection?: CatalogItem): string | undefined {
  const raw = track.metadata ?? {};
  if (raw.isInstrumental === true || raw.hasVocals === false || raw.hasVocal === false ||
    (track.provider === 'qq' && raw.language === 9) ||
    /纯音乐|純音樂|instrumental|无人声|无歌词/i.test(
      `${track.title} ${track.genre} ${languageKeys.flatMap(key => values(raw[key])).join(' ')}`))
    return undefined;
  const explicit = languagesIn(languageKeys.flatMap(key => values(raw[key])));
  if (explicit.size > 1) return undefined;
  if (explicit.size === 1) return [...explicit][0];
  if (track.provider === 'qq' && raw.language === 0) return 'zh';
  if (track.language === '纯音乐') return undefined;
  // Only a single-language real collection can supply missing metadata.
  // Market tags (K-pop/J-pop/Western), query text and artist/title scripts
  // alone never establish the language in which a recording is sung.
  if (collection?.provider === track.provider) {
    return sceneCollectionSungLanguage(collection);
  }
  return undefined;
}
