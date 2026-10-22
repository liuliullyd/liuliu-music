import type { CatalogItem, Track } from '../domain/types';
import {
  isMusicTrack,
  isOrdinaryTrack,
  constituentArtists,
} from './liveDiscovery';
import { isRecommendationMusicCollection } from './recommendationContentPolicy';

export interface HomeMenuSceneRule {
  definition: string;
  sources: readonly string[];
  recallQueries: readonly string[];
  genreKeywords: readonly string[];
  moodKeywords: readonly string[];
  /** Each group needs evidence from a real music collection or song metadata. */
  evidenceGroups: readonly (readonly string[])[];
  excludedKeywords: readonly string[];
  vocals: 'required' | 'instrumental' | 'any';
  region?: 'cantonese' | 'korean' | 'japanese' | 'western';
  requiredGenres?: readonly string[];
  energy?: 'low' | 'high';
  originalYearBefore?: number;
  artistPattern?: RegExp;
  /** These two scenes accept only members of their literal playlist search. */
  playlistSearchQuery?: '80' | '90';
  searchQuery?: string;
  listeningContext?: 'urban' | 'gaming';
  balancedRecall?: boolean;
  /** Only these background-audio scenes accept explicitly classified sound recordings. */
  backgroundSounds?: 'brainwave' | 'nature-and-brainwave';
  excludeDanceVersions?: boolean;
  /** Child-directed music is exclusive to the 儿歌 scene. */
  allowsChildren: boolean;
}

const apple = (slug: string, id: string) =>
  `https://music.apple.com/us/playlist/${slug}/${id}`;
const sources = {
  emo: 'https://pc.service.kugou.com/yueku/v8/special/single/9269206-2-684.html',
  sleep: apple('classical-sleep', 'pl.998d1aa71ae64e1f9199d0a112067149'),
  edm: apple('edm-hits', 'pl.d66feecbd40d423d81e8e643e368291a'),
  commute:
    'https://music.apple.com/gb/playlist/morning-commute-acoustic/pl.19aac977db5d470bb66eb9dcdf3f6fa6',
  happy: apple('happy-hits', 'pl.4fe671d3bd994738ace5ae974daebc10'),
  ktv: 'https://music-tw.line.me/playlist/498',
  jay: apple('jay-chou-essentials', 'pl.d467987f72384448b2bebe52c0b212d6'),
  oldies: apple('oldies-80s-70s-60s', 'pl.e7e65e3da1b0418bb5ec72767b44824b'),
  cantonese:
    'https://music.apple.com/cn/playlist/a-list-粤语流行/pl.31991c6bcf0447ac9f16c07678a5a0a0',
  guofeng:
    'https://music.apple.com/cn/playlist/国乐新浪潮/pl.c2db784b2d534b46bcc06ceaf097027e',
  workout: apple('latest-hiits', 'pl.b547405d127e46c0b3c3bf511b30314b'),
  focus: apple('pure-focus', 'pl.dbd712beded846dca273d5d3259d28aa'),
  city: 'https://web-japan.org/trends/cn/culture/pop202203_city-pop_cn.html',
  ost: apple('film-score-essentials', 'pl.3b89144df9054dc3a8502c8a74cc1686'),
  lofi: apple('lofi-chill', 'pl.67ef7c71c2284bdd8881497ffcc3102c'),
  faye: apple('faye-wong-essentials', 'pl.fb4e0e5f294c40c2a213bbfbf17751a3'),
  rock: apple('rock-classics', 'pl.ae12fec18a8b471788ee5956ac67b95a'),
  rnb: 'https://www.loc.gov/collections/songs-of-america/articles-and-essays/musical-styles/popular-songs-of-the-day/rhythm-and-blues/',
  relax: apple('acoustic-chill', 'pl.b5e8dbe8a706496496e1292466839207'),
  children: 'https://www.allmusic.com/style/nursery-rhymes-ma0000012087/songs',
  kpop: 'https://guides.loc.gov/k-pop',
  western: apple('todays-hits', 'pl.f4d106fed2bd41149aaacabb233eb5eb'),
  jpop: 'https://music.apple.com/jp/curator/apple-music-j-pop/987714244?l=en-US',
  electronic: apple(
    '2010s-electronic-essentials',
    'pl.29bfd93416ee4af6a2900d202f0b8523',
  ),
  rap: 'https://www.loc.gov/collections/songs-of-america/articles-and-essays/musical-styles/popular-songs-of-the-day/hip-hop-rap/',
  travel: apple(
    'classic-rock-road-trip',
    'pl.2e1d6631740b4e9ebdd3d3478744519b',
  ),
  shower: apple('shower-hits', 'pl.4596da83aef5429ea3ff08bf5bdf0eb3'),
  classical:
    'https://www.oxfordlearnersdictionaries.com/definition/english/classical-music',
  night: apple('late-night-jazz', 'pl.ee13f1f8d7864ed6ac747ae8a28f603c'),
  healing: apple('comfort-songs', 'pl.d50155b03525478a8ac67384ce037947'),
  light:
    'https://www.oxfordlearnersdictionaries.com/definition/english/easy-listening',
  bistro:
    'https://music.apple.com/fr/playlist/ambiance-cocktail-bar-lounge-jazz-été-en-terrasse/pl.118a0fc85c704c64bcc11d22718b0646',
  romance: apple('ultimate-love-songs', 'pl.85c107c69bb84d1fbb0153311d7060b3'),
  zen: 'https://music.apple.com/gb/playlist/pure-meditation/pl.e896478fdf824a93ab2f99165c3a1422',
  rain: apple(
    'acoustic-songs-for-rainy-days',
    'pl.13280adf38484c21a318b19d0cc8f748',
  ),
  beach: apple(
    '100-all-time-summer-songs',
    'pl.122bc516cd8045558e127ccd5f5d84cc',
  ),
  country:
    'https://www.oxfordlearnersdictionaries.com/definition/english/country-music',
  breakup: apple('heartbreak-pop', 'pl.91f43a875d694022ba4b338fce6a8c48'),
  game: apple('hard-rock-gaming', 'pl.035e6923f55c4666a0728d7126a791ac'),
  campus:
    'https://music.apple.com/tw/playlist/金韻民歌/pl.e756981ef8c0450099ce7d3eefac00fd',
  wakeup: apple('wake-me-up', 'pl.6095828b56cb460f8dac2ec3181c3b91'),
};

const calm = [
  '舒缓',
  '轻柔',
  '安静',
  'calm',
  'relax',
  'chill',
  '柔和',
  '温柔',
  'mellow',
];
const energetic = [
  '热血',
  '高能',
  '燃',
  '动感',
  '强节奏',
  'energetic',
  'high energy',
  'upbeat',
  '激昂',
];
const instrumental = [
  '纯音乐',
  'instrumental',
  '器乐',
  '钢琴曲',
  '演奏版',
  '无人声',
  '无歌词',
  'off vocal',
  'piano version',
];
const aggressive = [
  '重金属',
  'metal',
  'hardcore',
  '狂躁',
  '高能',
  '炸裂',
  '蹦迪',
];
const sad = ['失恋', '心碎', '悲伤', '伤感', 'heartbreak', 'breakup', 'sad'];
const rock = ['摇滚', 'rock', '朋克', 'punk', 'metal', '金属'];
const electronic = [
  '电子',
  '电音',
  'edm',
  'electronic',
  'house',
  'techno',
  'trance',
];
const rap = ['说唱', '嘻哈', 'rap', 'hip-hop', 'hip hop', 'hiphop', 'trap'];
const urbanStyles = [
  '都会流行', '都会氛围', '都市流行', 'urban pop',
  'r&b', 'rnb', 'rhythm and blues', 'funk', 'soul', 'neo-soul',
  'city pop', 'city-pop', 'citypop',
];
const gamingRhythm = [
  ...energetic, '高燃', '快节奏', '强鼓点', '战歌', '战斗',
  'fast paced', 'fast-paced', 'uptempo', 'driving', 'intense',
  'hard-hitting', 'battle anthem', 'battle music',
];
const fastElectronic = [
  ...electronic, 'dance', '舞曲', 'hardstyle', 'big room', 'big-room',
  'drum and bass', 'drum & bass', 'dnb', 'dubstep', 'electro',
];
const battleStyles = ['战歌', '战斗音乐', 'epic', 'orchestral', '交响战歌'];
const brainwaveSounds = ['阿尔法', '阿爾法', '脑波', '腦波', 'alpha waves',
  'alpha frequencies', 'brainwave', 'binaural', '双耳节拍', '雙耳節拍',
  'α波'];
const natureSounds = ['白噪音', '白噪聲', '自然声', '自然聲', '雨声', '雨聲',
  '海浪声', '海浪聲', '溪流声', '溪流聲', '风声', '風聲',
  'white noise', 'nature sounds', 'rain sounds', 'ocean sounds',
  'ocean waves', 'stream sounds', 'wind sounds'];
const zenThemes = ['禅意', '禪意', '佛乐', '佛樂', '梵唱', '梵呗', '梵唄',
  '佛曲', '佛号', '佛號', '唱诵', '唱誦', '心经', '心經', '大悲咒',
  'buddhist chant', 'mantra', 'zen', '放下', '释然', '釋然', '顺其自然',
  '順其自然', 'letting go', 'acceptance', 'inner peace'];
const gamingLowEnergy = [
  ...calm, ...sad, '抒情', '慢歌', '慢速', '低能量',
  'ballad', 'downtempo', 'low energy', 'ambient', '氛围音乐',
];

const rule = (
  definition: string,
  source: keyof typeof sources,
  recallQueries: readonly string[],
  genreKeywords: readonly string[],
  moodKeywords: readonly string[],
  options: Partial<HomeMenuSceneRule> = {},
): HomeMenuSceneRule => ({
  definition,
  sources: [sources[source]],
  recallQueries,
  genreKeywords,
  moodKeywords,
  evidenceGroups: [[...genreKeywords, ...moodKeywords]],
  excludedKeywords: [],
  vocals: 'required',
  allowsChildren: false,
  ...options,
});

/** Research definitions become catalogue constraints; a search query is never evidence. */
export const HOME_MENU_SCENE_RULES: Readonly<
  Record<string, HomeMenuSceneRule>
> = {
  // These three literal filters come from the user's confirmed product rules.
  'scene-phonk': rule(
    '从本次首成功平台搜索Phonk歌单并获取其真实成员，允许纯音乐和人声，沿用普通歌曲资格及去重规则。',
    'edm', ['Phonk'], ['phonk'], ['动感'],
    { searchQuery: 'Phonk', evidenceGroups: [['phonk']], sources: [], vocals: 'any' },
  ),
  'scene-80s': rule(
    '当前平台仅以80搜索歌单，语种不限、歌手不重复，随机播放。',
    'oldies', ['80'], ['流行', 'rock', 'soul'], ['怀旧'],
    { playlistSearchQuery: '80', evidenceGroups: [] },
  ),
  'scene-90s': rule(
    '当前平台仅以90搜索歌单，语种不限、歌手不重复，随机播放。',
    'oldies', ['90'], ['流行', 'rock', 'r&b'], ['怀旧'],
    { playlistSearchQuery: '90', evidenceGroups: [] },
  ),
  'scene-deep-emo': rule(
    '孤独、内省、忧郁的抒情人声歌曲。',
    'emo',
    ['伤感情歌', '忧郁抒情'],
    ['抒情', '独立流行', 'ballad'],
    ['伤感', '忧郁', '孤独', 'sad', 'melancholy', 'emo'],
    {
      vocals: 'required',
      energy: 'low',
      evidenceGroups: [['伤感', '忧郁', '孤独', 'sad', 'melancholy', 'emo']],
      excludedKeywords: ['派对', 'party', '健身', ...aggressive],
    },
  ),
  'scene-sleep': rule(
    '舒缓、安静、低刺激的助眠人声歌曲；排除器乐、纯音乐、自然声与白噪音。',
    'sleep',
    ['舒缓人声', '安静抒情', 'Soft Vocal Ballads'],
    ['acoustic', 'ballad', '抒情', '民谣'],
    calm,
    {
      vocals: 'required',
      energy: 'low',
      balancedRecall: true,
      evidenceGroups: [
        ['助眠', '睡眠', 'sleep', '舒缓', '安静', 'peaceful', 'soft', '抒情', 'ballad'],
      ],
      excludedKeywords: [...aggressive, ...rap],
    },
  ),
  'scene-dynamic-dj': rule(
    '舞池语境中的高能电子舞曲、house、trance。',
    'edm',
    ['EDM', 'House', 'Trance'],
    electronic,
    energetic,
    {
      energy: 'high',
      evidenceGroups: [
        ['edm', 'dance', '舞曲', 'house', 'trance', 'dj', '电音'],
      ],
      excludedKeywords: ['助眠', '冥想', 'sleep', 'meditation'],
    },
  ),
  'scene-commute': rule(
    '稳定、轻松、适合路上持续听的 acoustic pop、轻民谣和轻摇滚。',
    'commute',
    ['轻松民谣', 'acoustic pop', '轻摇滚'],
    ['acoustic', '民谣', '轻摇滚', '轻流行'],
    ['轻松', 'chill', 'mellow'],
    {
      evidenceGroups: [
        ['acoustic', '轻松', '轻摇滚', '轻流行', '民谣', 'chill', 'mellow'],
      ],
      excludedKeywords: ['助眠', '睡眠', 'sleep', ...aggressive],
    },
  ),
  'scene-happy': rule(
    '明亮、欢快、正向情绪的流行、funk 和舞曲。',
    'happy',
    ['欢快流行', 'Funk', '开心舞曲'],
    ['funk', 'dance pop', '欢快流行', '舞曲'],
    ['开心', '快乐', '欢快', 'happy', 'feel good', '明亮'],
    {
      evidenceGroups: [
        ['开心', '快乐', '欢快', 'happy', 'feel good', 'upbeat', 'funk'],
      ],
      excludedKeywords: sad,
    },
  ),
  'scene-ktv': rule(
    '熟悉、易跟唱的流行金曲、情歌与合唱原唱人声版本。',
    'ktv',
    ['华语金曲', '经典情歌', '流行合唱'],
    ['华语流行', '粤语流行', '情歌', '流行'],
    ['传唱', '金曲', '合唱', '经典'],
    {
      vocals: 'required',
      evidenceGroups: [
        [
          'ktv',
          'k歌',
          '金曲',
          '必唱',
          '合唱',
          '传唱',
          '经典情歌',
          'sing along',
          'sing-along',
        ],
      ],
      excludedKeywords: [
        ...instrumental,
        '伴奏',
        '卡拉ok版',
        'karaoke version',
      ],
    },
  ),
  'scene-jay': rule(
    '周杰伦演唱或合作演唱的普通完整歌曲。',
    'jay',
    ['周杰伦'],
    ['华语流行', 'r&b'],
    ['青春', '怀旧'],
    { artistPattern: /^(?:周杰伦|周杰倫|jay\s*chou)$/i, vocals: 'required' },
  ),
  'scene-nostalgia': rule(
    '旧时代发行、经时间检验的 oldies 和年代流行金曲。',
    'oldies',
    ['80年代金曲', '90年代金曲', 'Oldies'],
    ['oldies', '复古流行'],
    ['怀旧', '老歌', '80年代', '90年代', '经典老歌', '复古'],
    {
      originalYearBefore: 2010,
      evidenceGroups: [
        [
          'oldies',
          '老歌',
          '怀旧',
          '80年代',
          '90年代',
          '70年代',
          '80后',
          '90后',
          'retro',
        ],
      ],
    },
  ),
  'scene-cantonese': rule(
    '粤语演唱的 Cantopop；国语作品不能因艺人来自香港而通过。',
    'cantonese',
    ['Cantopop', '粤语流行'],
    ['cantopop'],
    ['粤语', 'cantonese'],
    {
      region: 'cantonese',
      vocals: 'required',
      evidenceGroups: [
        ['粤语', '粵語', '广东话', '廣東話', 'cantonese', 'cantopop'],
      ],
    },
  ),
  'scene-chinese-style': rule(
    '融合传统器乐、古典意象、戏曲或民乐元素的中国风与古风音乐。',
    'guofeng',
    ['中国风流行', '古风', '民乐融合'],
    ['国风', '中国风', '古风', '民乐', '古琴', '古筝', '琵琶', '戏腔'],
    ['古韵', '东方'],
    {
      evidenceGroups: [
        [
          '国风',
          '中国风',
          '古风',
          '民乐',
          '古琴',
          '古筝',
          '琵琶',
          '戏腔',
          '国乐',
        ],
      ],
    },
  ),
  'scene-workout': rule(
    '强节拍、高能量的流行、摇滚、电子与说唱歌曲。',
    'workout',
    ['高能电子', '燃向摇滚', '动感流行'],
    [...rock, ...electronic, ...rap, '流行'],
    energetic,
    {
      energy: 'high',
      evidenceGroups: [[...energetic, '健身', '跑步', 'workout', 'training']],
      excludedKeywords: ['助眠', '冥想', '白噪音', 'sleep', 'meditation'],
    },
  ),
  'scene-focus': rule(
    '无歌词、低干扰的纯音乐／轻音乐、稳定的古典器乐及带阿尔法／双耳节拍标注的背景音乐。',
    'focus',
    ['纯音乐轻音乐', '古典器乐', '阿尔法脑波', 'Lo-fi', '氛围器乐'],
    ['lo-fi', 'lofi', 'ambient', '钢琴', '器乐', '纯音乐', '古典', 'classical',
      '巴洛克', 'baroque', ...brainwaveSounds],
    ['专注', '安静', 'study', 'focus'],
    {
      vocals: 'instrumental',
      energy: 'low',
      backgroundSounds: 'brainwave',
      balancedRecall: true,
      sources: [sources.focus,
        'https://classical.music.apple.com/fr/playlist/pl.cf8514b686374fadbe6807a6339dfd89?l=en',
        apple('alpha-frequencies', 'pl.0c3f0e517245420ba394bb8cd382db08')],
      evidenceGroups: [
        [
          'lo-fi',
          'lofi',
          'ambient',
          '专注',
          '学习',
          'study',
          'focus',
          '轻钢琴',
          '纯音乐', '轻音乐', '古典', 'classical', '巴洛克', 'baroque',
          ...brainwaveSounds,
        ],
      ],
      excludedKeywords: [...aggressive, '派对', 'party'],
    },
  ),
  'scene-city': rule(
    '用户确认的都会氛围，包含都会流行、R&B、funk/soul 和 City Pop，不限定日语。',
    'city',
    ['都会流行', 'R&B', 'Funk Soul', 'City Pop'],
    urbanStyles,
    ['都会氛围', '都市夜行'],
    {
      listeningContext: 'urban',
      balancedRecall: true,
      sources: [
        sources.city,
        apple('best-of-urban-jazz', 'pl.2d0771f67d2f4103b35e52de7a6c5b80'),
        sources.rnb,
      ],
      evidenceGroups: [urbanStyles],
    },
  ),
  'scene-ost': rule(
    '电影、电视剧或动画的原声、主题曲和配乐。',
    'ost',
    ['影视原声', '电影主题曲', '动画原声'],
    ['影视原声', '电影原声', '电视原声', 'soundtrack', 'ost', 'score'],
    ['主题曲', '配乐'],
    {
      evidenceGroups: [
        [
          '影视原声',
          '电影',
          '电视剧',
          '动画原声',
          'soundtrack',
          'ost',
          '主题曲',
          '原声带',
        ],
      ],
      excludedKeywords: ['游戏原声', 'game soundtrack', 'video game'],
    },
  ),
  'scene-defjam': rule(
    '按用户定义的DefJam场景推荐Hip-Hop、嘻哈和说唱风格的人声歌曲，不限定厂牌。',
    'rap',
    ['Hip-Hop', '嘻哈说唱', 'Hip Hop Rap'],
    rap,
    ['街头', '态度'],
    {
      evidenceGroups: [rap],
    },
  ),
  'scene-slacking': rule(
    '轻松、松弛、可当工作间隙背景的 lo-fi/chill/acoustic。',
    'lofi',
    ['Lo-fi vocal', '轻松人声', 'Chill acoustic'],
    ['lo-fi', 'lofi', 'chill', 'acoustic', '轻音乐'],
    ['松弛', '轻松', '舒缓'],
    {
      energy: 'low',
      evidenceGroups: [
        ['lo-fi', 'lofi', 'chill', '松弛', '轻松', '舒缓', 'acoustic'],
      ],
      excludedKeywords: aggressive,
    },
  ),
  'scene-faye': rule(
    '王菲演唱或合作演唱的普通完整歌曲。',
    'faye',
    ['王菲'],
    ['另类流行', '华语流行'],
    ['空灵', '忧郁'],
    { artistPattern: /^(?:王菲|faye\s*wong)$/i, vocals: 'required' },
  ),
  'scene-rock': rule(
    '摇滚、朋克、金属及相关吉他、强节拍音乐。',
    'rock',
    ['Rock', '朋克', '摇滚金曲'],
    rock,
    ['力量', '热烈'],
    { evidenceGroups: [rock], requiredGenres: rock },
  ),
  'scene-rnb': rule(
    '节奏布鲁斯、当代 R&B 和 neo-soul。',
    'rnb',
    ['R&B', 'Neo Soul', '节奏布鲁斯'],
    ['r&b', 'rnb', 'rhythm and blues', '节奏布鲁斯', 'neo-soul', 'neo soul'],
    ['律动', '灵魂'],
    {
      evidenceGroups: [
        [
          'r&b',
          'rnb',
          'rhythm and blues',
          '节奏布鲁斯',
          'neo-soul',
          'neo soul',
        ],
      ],
      requiredGenres: [
        'r&b',
        'rnb',
        'rhythm and blues',
        '节奏布鲁斯',
        'neo-soul',
        'neo soul',
      ],
    },
  ),
  'scene-relax': rule(
    '舒缓、低刺激的 acoustic、chill、ambient 与 lounge。',
    'relax',
    ['Chill acoustic', '舒缓民谣', 'Ambient'],
    ['acoustic', 'chill', 'ambient', 'lounge', '民谣'],
    calm,
    {
      energy: 'low',
      evidenceGroups: [[...calm, 'ambient', 'acoustic', 'lounge']],
      excludedKeywords: aggressive,
    },
  ),
  'scene-children': rule(
    '为儿童创作的简单、重复、易跟唱的儿歌和童谣。',
    'children',
    ['童谣', '儿童歌曲', 'Nursery Rhymes'],
    ['儿歌', '童谣', '儿童音乐', 'nursery rhymes'],
    ['童真', '亲子'],
    {
      vocals: 'required',
      allowsChildren: true,
      evidenceGroups: [
        ['儿歌', '童谣', '儿童音乐', '儿童歌曲', 'nursery', "children's music"],
      ],
    },
  ),
  'scene-kpop': rule(
    '韩国流行音乐市场与产业的作品，不能与日本流行共用分类。',
    'kpop',
    ['K-Pop', '韩国流行'],
    ['k-pop', 'kpop', '韩国流行'],
    ['韩流', '韩国'],
    {
      region: 'korean',
      vocals: 'required',
      evidenceGroups: [['k-pop', 'kpop', '韩国流行', '韩流', '韩语', 'korean']],
    },
  ),
  'scene-western': rule(
    '欧美流行音乐市场的歌曲，流派可覆盖 pop、rock、R&B 等。',
    'western',
    ['欧美流行', 'Western Pop'],
    ['western pop', '欧美流行'],
    ['欧美', 'western'],
    {
      region: 'western',
      evidenceGroups: [['欧美', 'western', 'english pop', '欧美流行']],
    },
  ),
  'scene-jpop': rule(
    '日本流行音乐市场的作品，包括日本 pop、rock 和偶像流行。',
    'jpop',
    ['J-Pop', '日本流行'],
    ['j-pop', 'jpop', '日本流行'],
    ['日本', '日语'],
    {
      region: 'japanese',
      vocals: 'required',
      evidenceGroups: [['j-pop', 'jpop', '日本流行', '日语', 'japanese']],
    },
  ),
  'scene-electronic': rule(
    '电子制作的音乐及 house、techno、trance 等子流派。',
    'electronic',
    ['Electronic', 'Techno', 'House'],
    electronic,
    ['电子律动', '未来'],
    { evidenceGroups: [electronic], requiredGenres: electronic },
  ),
  'scene-rap': rule(
    '节奏化、押韵的人声说唱与 hip-hop/trap。',
    'rap',
    ['Hip Hop', 'Trap', '中文说唱'],
    rap,
    ['街头', '态度'],
    { vocals: 'required', evidenceGroups: [rap], requiredGenres: rap },
  ),
  'scene-travel': rule(
    '开阔、轻快、适合长途持续聆听的公路摇滚、独立流行与 folk。',
    'travel',
    ['公路摇滚', '轻快民谣', 'Indie pop'],
    ['公路摇滚', 'indie pop', 'folk', '民谣'],
    ['轻快', '自由', '开阔', 'road trip'],
    {
      evidenceGroups: [
        [
          '公路',
          'road trip',
          'roadtrip',
          '轻快民谣',
          '自由',
          '开阔',
          'indie pop',
        ],
      ],
      excludedKeywords: ['助眠', 'sleep', ...sad],
    },
  ),
  'scene-shower': rule(
    '可放声跟唱、熟悉且明亮的流行、R&B 和摇滚人声歌。',
    'shower',
    ['流行合唱', '欢快金曲', '经典流行'],
    ['流行', 'r&b', '摇滚'],
    ['合唱', '欢快', '熟悉', 'sing along'],
    {
      vocals: 'required',
      evidenceGroups: [
        [
          '合唱',
          '欢快',
          '金曲',
          '经典流行',
          'sing along',
          'sing-along',
          'upbeat',
        ],
      ],
      excludedKeywords: [...instrumental, '白噪音', '自然声', '伴奏'],
    },
  ),
  'scene-classical': rule(
    '古典声乐、歌剧咏叹调、艺术歌曲与合唱；排除交响、协奏、奏鸣曲等无词器乐。',
    'classical',
    ['古典声乐', '歌剧咏叹调', 'Classical Vocal', 'Opera Arias'],
    ['classical', '古典', '声乐', '歌剧', 'opera', 'aria', '合唱'],
    ['艺术歌曲', '声乐'],
    {
      evidenceGroups: [
        ['classical', '古典', '声乐', '歌剧', 'opera', 'aria', '合唱'],
      ],
      requiredGenres: [
        'classical',
        '古典',
        '声乐',
        'opera',
        'aria',
        '合唱',
        '歌剧',
      ],
      excludedKeywords: ['古风流行', '国风流行'],
    },
  ),
  'scene-night': rule(
    '亲密、慵懒、留白的晚间 jazz、downtempo 与 R&B。',
    'night',
    ['Smooth Jazz', 'Downtempo', '慵懒 R&B'],
    ['jazz', '爵士', 'downtempo', 'lounge', 'r&b'],
    ['慵懒', 'mellow', '低缓'],
    {
      energy: 'low',
      evidenceGroups: [
        [
          'smooth jazz',
          '爵士',
          'downtempo',
          'lounge',
          '慵懒',
          'mellow',
          '夜间r&b',
        ],
      ],
      excludedKeywords: aggressive,
    },
  ),
  'scene-healing': rule(
    '温暖、安慰、积极且低压力的温柔民谣和轻流行。',
    'healing',
    ['温柔民谣', '温暖流行', 'Comfort songs'],
    ['民谣', '轻流行', 'acoustic'],
    ['温暖', '安慰', '治愈', 'comfort', '温柔'],
    {
      evidenceGroups: [['温暖', '安慰', '治愈', 'comfort', '温柔', 'healing']],
      excludedKeywords: ['极度悲伤', '心碎', 'heartbreak', ...aggressive],
    },
  ),
  'scene-light-music': rule(
    '轻柔易听的器乐与背景音乐，以旋律和低干扰为主。',
    'light',
    ['Easy listening', '器乐轻音乐', '轻钢琴'],
    ['纯音乐', 'instrumental', '轻音乐', '器乐', '钢琴'],
    calm,
    {
      vocals: 'instrumental',
      energy: 'low',
      evidenceGroups: [
        ['纯音乐', 'instrumental', '轻音乐', '器乐', '钢琴', 'easy listening'],
      ],
      excludedKeywords: ['人声流行', 'vocal pop', ...aggressive],
    },
  ),
  'scene-bistro': rule(
    '微醺酒馆氛围中的 jazz、blues、lounge 与轻民谣。',
    'bistro',
    ['Jazz Lounge', 'Blues', '酒馆民谣'],
    ['jazz', '爵士', 'blues', '蓝调', 'lounge', '酒馆民谣'],
    ['微醺', '松弛'],
    {
      evidenceGroups: [['jazz', '爵士', 'blues', '蓝调', 'lounge', '酒馆民谣']],
      excludedKeywords: ['edm', '儿歌', '儿童歌曲'],
    },
  ),
  'scene-romance': rule(
    '歌颂恋爱、表白和亲密关系的爱情人声歌曲，排除 DJ 版和明确的舞曲／电音改编。',
    'romance',
    ['甜蜜情歌', 'Love Songs', 'Romantic Ballads'],
    ['情歌', 'love song', 'romantic ballad'],
    ['甜蜜', '恋爱', '浪漫', '表白'],
    {
      vocals: 'required',
      excludeDanceVersions: true,
      evidenceGroups: [
        ['甜蜜', '恋爱', '浪漫', '表白', 'love song', 'romantic'],
      ],
      excludedKeywords: [...sad, '分手'],
    },
  ),
  'scene-zen': rule(
    '平静的音乐性梵唱／佛乐、表达放下释然的舒缓民谣／流行和空灵国风人声。',
    'zen',
    ['禅意佛乐梵唱', '放下释然 舒缓民谣', '空灵禅意国风人声', 'Meditative Vocal'],
    ['new age', '禅意', '民谣', 'folk', '流行', '国风', '梵唱'],
    ['平静', '冥想', 'meditation', 'zen', '放下', '释然', '空灵'],
    {
      vocals: 'required',
      energy: 'low',
      balancedRecall: true,
      sources: [sources.zen,
        'https://store.windmusic.com.tw/zh/series/Chanting_Music',
        'https://store.windmusic.com.tw/zh/CD/CB-78'],
      evidenceGroups: [
        ['ambient', 'new age', '冥想', 'meditation', '古琴', ...zenThemes],
      ],
      excludedKeywords: [...aggressive, ...rap, '讲经', '講經', '讲座', '講座',
        '佛学讲解', '佛學講解', '经文朗读', '經文朗讀', 'sermon', 'dharma talk'],
    },
  ),
  'scene-rain': rule(
    '适合阴雨氛围的柔和acoustic、jazz与内省人声歌曲。',
    'rain',
    ['舒缓民谣', '慵懒人声爵士', '柔和抒情'],
    ['acoustic', '民谣', 'jazz', '爵士', '钢琴'],
    ['舒缓', '慵懒', '内省', '柔和'],
    {
      energy: 'low',
      evidenceGroups: [
        [
          '舒缓民谣',
          '慵懒',
          '柔和',
          '内省',
          'acoustic',
          'mellow',
          '雨天',
          'rainy',
        ],
      ],
      excludedKeywords: aggressive,
    },
  ),
  'scene-beach': rule(
    '轻快、松弛、明亮的 reggae、tropical pop/house 和夏日流行。',
    'beach',
    ['Reggae', 'Tropical House', '夏日流行'],
    ['reggae', '雷鬼', 'tropical', '热带浩室', '夏日流行'],
    ['夏日', '度假', '松弛'],
    {
      evidenceGroups: [
        ['reggae', '雷鬼', 'tropical', '热带浩室', '夏日', '夏天', 'summer'],
      ],
      excludedKeywords: ['冬日悲伤', '重金属'],
    },
  ),
  'scene-country': rule(
    '乡村音乐及 country folk、bluegrass 等相关传统。',
    'country',
    ['Country', 'Bluegrass', '乡村民谣'],
    ['country', '乡村音乐', 'bluegrass', '蓝草', '乡村民谣'],
    ['田园', '原野'],
    {
      evidenceGroups: [
        ['country', '乡村音乐', 'bluegrass', '蓝草', '乡村民谣'],
      ],
      requiredGenres: ['country', '乡村音乐', 'bluegrass', '蓝草', '乡村民谣'],
    },
  ),
  'scene-breakup': rule(
    '主题明确涉及分手、心碎和失去的悲伤人声情歌。',
    'breakup',
    ['伤心情歌', 'Heartbreak Ballads', '分手情歌'],
    ['伤心情歌', 'ballad'],
    sad,
    {
      vocals: 'required',
      evidenceGroups: [
        ['失恋', '分手', '心碎', '伤心', 'heartbreak', 'breakup'],
      ],
      excludedKeywords: ['甜蜜', '表白', '热恋', 'happy love'],
    },
  ),
  'scene-game': rule(
    '适合打游戏的高燃电音、强鼓点和快节奏战歌；按节奏、能量与战斗氛围筛选，无需游戏／电竞标签。',
    'game',
    ['高燃 EDM', '快节奏战歌', '强鼓点 Drum and Bass', 'High Energy Trap'],
    [...fastElectronic, ...battleStyles, ...rock, ...rap],
    gamingRhythm,
    {
      energy: 'high',
      listeningContext: 'gaming',
      requiredGenres: [...fastElectronic, ...battleStyles, ...rock, ...rap],
      balancedRecall: true,
      sources: [
        sources.game,
        apple('ministry-gaming', 'pl.937e76f80b2e426f8f7f85f4bda6af5b'),
        apple('gaming-music-2026', 'pl.0d42f203b7054167a6da95e17ca4ed0a'),
      ],
      evidenceGroups: [
        [...fastElectronic, ...battleStyles, ...rock, ...rap],
        [...fastElectronic, ...gamingRhythm],
      ],
      excludedKeywords: [
        '助眠',
        'sleep',
        '白噪音',
        '自然声',
        '电影原声',
        '电视剧原声',
        '影视原声',
      ],
    },
  ),
  'scene-campus': rule(
    '校园民歌、吉他民谣和青春学生时代的歌曲。',
    'campus',
    ['校园民谣', '青春民歌', '吉他民谣'],
    ['校园民谣', '校园民歌', '吉他民谣', 'folk'],
    ['青春', '学生时代', '毕业'],
    {
      vocals: 'required',
      evidenceGroups: [
        [
          '校园民谣',
          '校园民歌',
          '青春民歌',
          '金韵民歌',
          '吉他民谣',
          'campus folk',
        ],
      ],
    },
  ),
  'scene-wakeup': rule(
    '正向、轻快、节拍明确的晨间流行、funk 和 R&B。',
    'wakeup',
    ['轻快流行', 'Funk', '积极 R&B'],
    ['funk', '流行', 'r&b'],
    ['轻快', '积极', '明亮', '欢快', 'upbeat'],
    {
      energy: 'high',
      evidenceGroups: [['轻快', '积极', '明亮', '欢快', 'upbeat', 'funk']],
      excludedKeywords: ['助眠', 'sleep', ...sad],
    },
  ),
};

type SceneRow = readonly [string, string, Track['language']?];
const sceneRows: readonly SceneRow[] = [
  ['phonk', 'Phonk'],
  ['80s', '80年代'],
  ['90s', '90年代'],
  ['deep-emo', '深夜emo'],
  ['sleep', '助眠'],
  ['dynamic-dj', '动感DJ'],
  ['commute', '通勤'],
  ['happy', '快乐时光'],
  ['ktv', 'KTV必点'],
  ['jay', '听杰伦'],
  ['nostalgia', '怀旧老歌'],
  ['cantonese', '粤语', '粤语'],
  ['chinese-style', '国风'],
  ['workout', '运动'],
  ['focus', '专注'],
  ['city', '城市'],
  ['ost', 'OST'],
  ['defjam', 'DefJam'],
  ['slacking', '摸鱼'],
  ['faye', '听王菲'],
  ['rock', '摇滚'],
  ['rnb', 'R&B'],
  ['relax', '放松'],
  ['children', '儿歌'],
  ['kpop', 'Kpop', '日韩'],
  ['western', '欧美', '欧美'],
  ['jpop', 'Jpop', '日韩'],
  ['electronic', '电音'],
  ['rap', '说唱'],
  ['travel', '旅行'],
  ['shower', '洗澡'],
  ['classical', '古典'],
  ['night', '夜晚'],
  ['healing', '治愈'],
  ['light-music', '轻音乐', '纯音乐'],
  ['bistro', '小酒馆'],
  ['romance', '浪漫情歌'],
  ['zen', '佛系时间'],
  ['rain', '雨天'],
  ['beach', '海边'],
  ['country', '乡村'],
  ['breakup', '失恋必听'],
  ['game', '游戏'],
  ['campus', '校园'],
  ['wakeup', '起床'],
];
export const HOME_MENU_SCENES = sceneRows.map(
  ([suffix, label, language]) => {
    const id = `scene-${suffix}`;
    const scene = HOME_MENU_SCENE_RULES[id]!;
    return {
      id,
      kind: 'scene' as const,
      label,
      language,
      queries: scene.recallQueries,
      artistPattern: scene.artistPattern,
    };
  },
);

const musicProviders = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui']);
const typeKeys = [
  'mediaType',
  'media_type',
  'discoveryEntity',
  'discovery_entity',
  'contentType',
  'content_type',
  'resourceType',
  'resource_type',
  'typeName',
  'type_name',
  'categoryName',
  'category_name',
  'category',
  'genre',
  'style',
  'tags',
  'albumType',
  'program',
  'radio',
  'book',
  'chapter',
  'episode',
];

const textValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return [
      'name',
      'title',
      'type',
      'typeName',
      'category',
      'categoryName',
      'tags',
      'genre',
      'style',
      'language',
    ].flatMap(key => textValues(item[key]));
  }
  return typeof value === 'string' ? [value] : [];
};
const metadataText = (metadata: Record<string, unknown> = {}) =>
  [
    ...typeKeys,
    'language',
    'languageName',
    'language_name',
    'lang',
    'songLanguage',
    'song_language',
    'label',
    'labelName',
    'description',
    'intro',
    'remark',
    'mood',
    'country',
    'region',
  ]
    .flatMap(key => textValues(metadata[key]))
    .concat(textValues(metadata.trans_param))
    .join(' ')
    .toLocaleLowerCase();

// Keep the child-content boundary explicit. Generic words such as "lullaby",
// "摇篮曲", "children" in an artist name (Mr. Children), or "kids" in a
// band name (Stray Kids) are not sufficient on their own; the marker must
// describe child-directed music or a child-focused collection.
const childMusicMarker =
  /儿歌|兒歌|童谣|童謠|儿童(?:歌曲|音乐|歌谣)?|兒童(?:歌曲|音樂|歌謠)?|少儿(?:歌曲|音乐|歌谣)?|少兒(?:歌曲|音樂|歌謠)?|幼儿(?:歌曲|音乐|歌谣|园)?|幼兒(?:歌曲|音樂|歌謠|園)?|孩童(?:歌曲|音乐|歌谣)?|孩子(?:歌曲|音乐|歌谣)|童声|童聲|亲子|親子|宝宝(?:歌曲|音乐|歌谣)?|寶寶(?:歌曲|音樂|歌謠)?|婴儿(?:歌曲|音乐|歌谣)?|嬰兒(?:歌曲|音樂|歌謠)?|nursery\s+(?:rhymes?|songs?)|children[’']?s?\s+(?:music|songs?|rhymes?|sing[- ]?along|favorites?|classics?|party)|kids?[’']?s?\s+(?:music|songs?|rhymes?|sing[- ]?along|favorites?|classics?|party)|baby[’']?s?\s+(?:songs?|music)|baby\s+shark|preschool|kindergarten|こどものうた|子供の歌|キッズ(?:ソング|音楽)|동요|어린이(?:\s+(?:노래|음악))?|키즈(?:송|음악)|canciones?\s+infantiles|m[úu]sica\s+infantil|chansons?\s+pour\s+enfants?|musique\s+pour\s+enfants?|canzoni\s+per\s+bambini|kinder(?:lieder|musik)|детские\s+(?:песни|песен|музыка)/i;

const childContentMetadataText = (metadata: Record<string, unknown> = {}) =>
  [
    metadataText(metadata),
    ...[
      'songName',
      'song_name',
      'songname',
      'originalSongName',
      'originalName',
      'originSongName',
      'name',
      'title',
      'subtitle',
      'subTitle',
      'sub_title',
      'version',
      'versionName',
      'version_name',
    ].flatMap(key => textValues(metadata[key])),
  ]
    .join(' ')
    .toLocaleLowerCase();

const isChildDirectedText = (text: string) => childMusicMarker.test(text);

const isChildDirectedCollection = (item: CatalogItem) =>
  isChildDirectedText(
    `${item.title} ${item.description} ${childContentMetadataText(item.metadata)}`,
  );

const isChildDirectedTrack = (track: Track, collection?: CatalogItem) =>
  isChildDirectedText(
    `${track.title} ${track.artist} ${track.album} ${track.genre} ${track.mood} ${childContentMetadataText(track.metadata)}`,
  ) || Boolean(collection && isChildDirectedCollection(collection));

const contains = (text: string, values: readonly string[]) =>
  values.some(value => {
    const normalized = value.toLocaleLowerCase();
    if (!/^[a-z0-9][a-z0-9 &'-]*$/i.test(normalized))
      return text.includes(normalized);
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(text);
  });
const groupsMatch = (text: string, groups: readonly (readonly string[])[]) =>
  groups.every(group => contains(text, group));
const danceVersion =
  /(?:^|[^a-z0-9])dj(?:[^a-z0-9]|$)|\bdj(?=版|版本|舞曲|混音|remix|mix|edit|version)|\b(?:club[ -]?(?:mix|remix|edit|version)|dance[ -]?(?:mix|remix|edit|version))\b|舞曲(?:版|改编|改編|混音)|电音(?:版|改编|改編|混音)|電音(?:版|改编|改編|混音)|蹦迪/i;
const recordingVersionText = (metadata: Record<string, unknown> = {}) =>
  ['songName', 'song_name', 'songname', 'songname_original', 'songname_ori',
    'originalSongName', 'originalName', 'originSongName', 'name', 'title',
    'SONGNAME', 'SONG_NAME', 'NAME', 'MUSIC_NAME', 'subtitle', 'subTitle', 'sub_title',
    'version', 'versionName', 'version_name', 'mix', 'mixName', 'extra', 'alia',
    'alias', 'tns', 'transNames', 'trans_param', 'genre', 'style', 'tags', 'category']
    .flatMap(key => textValues(metadata[key])).join(' ');
export function isSceneMusicTrack(track: Track) {
  return (
    musicProviders.has(track.provider) &&
    isMusicTrack(track) &&
    isOrdinaryTrack(track) &&
    !/\b(?:tv|anime)\s*(?:size|edit)|short\s*(?:version|ver\.?|edit)|剪辑片段|剪輯片段|截取版/i.test(
      track.title,
    )
  );
}

export function matchesSceneCollection(
  item: CatalogItem,
  scene: HomeMenuSceneRule,
) {
  const text = `${item.title} ${item.description} ${metadataText(
    item.metadata,
  )}`.toLocaleLowerCase();
  if (
    !isRecommendationMusicCollection(item) ||
    !item.id ||
    !musicProviders.has(item.provider)
  )
    return false;
  if (!scene.allowsChildren && isChildDirectedCollection(item)) return false;
  if (contains(text, scene.excludedKeywords)) return false;
  if (scene.excludeDanceVersions && danceVersion.test(
    `${item.title} ${recordingVersionText(item.metadata)}`,
  )) return false;
  if (scene.listeningContext === 'gaming' && contains(text, gamingLowEnergy))
    return false;
  if (scene.vocals === 'required' && contains(text, [...instrumental, '伴奏']))
    return false;
  if (scene.playlistSearchQuery) return true;
  // Description can discuss other styles; only the actual title/type/tags
  // establish collection membership. Never use the search query as evidence.
  const classification = `${item.title} ${metadataText({
    genre: item.metadata?.genre,
    style: item.metadata?.style,
    tags: item.metadata?.tags,
    category: item.metadata?.category,
    categoryName: item.metadata?.categoryName,
  })}`.toLocaleLowerCase();
  return groupsMatch(classification, scene.evidenceGroups);
}

// Market identity for English-title releases comes from the cited editorial
// catalogues, rather than guessing nationality from Latin artist names.
export const HOME_MENU_IDENTITY_SOURCES = [
  'https://music.apple.com/mo/playlist/k-pop-essentials/pl.6a3c854a49a542739e5d57291b27e122?l=en-GB',
  'https://music.apple.com/us/playlist/k-pop-hits-2024/pl.b3c079fea5704332baed562d8f90d3a8',
  'https://music.apple.com/us/playlist/k-pop-hits-2025/pl.161503b34ff7441a949c81bd19525b35',
  'https://music.apple.com/us/playlist/riize-official-playlist/pl.8721f599f2234c22a17addf82092d56f',
  'https://music.apple.com/ec/playlist/office-dj-japan/pl.a2e8077550014d08a1c9d13d023f259e?l=en-GB',
  'https://music.apple.com/co/playlist/canciones-de-amor-japonesas-de-los-2010-imprescindibles/pl.0a0963678a974770a90ceba37250ed67',
];
const koreanPopArtists = new Set([
  'boa',
  'red velvet',
  'brown eyed girls',
  'wonder girls',
  'psy',
  'block b',
  'bts',
  'ive',
  'seotaiji and boys',
  'shinee',
  'bigbang',
  '2ne1',
  'aespa',
  'blackpink',
  'illit',
  'le sserafim',
  'riize',
  'kiss of life',
  'stray kids',
  'seventeen',
  'iu',
  'tomorrow x together',
  'babymonster',
  'boynextdoor',
  'qwer',
  'v',
  'jennie',
  'jisoo',
  'lisa',
  'rosé',
  'j-hope',
  'zico',
  'twice',
  'nayeon',
  '娜琏',
  'allDAY project'.toLowerCase(),
  'hearts2hearts',
  'izna',
  'tws',
  'enhypen',
]);
const japanesePopArtists = new Set([
  'yoasobi',
  'perfume',
  'capsule',
  'king gnu',
  'ado',
  'sekai no owari',
  'tomoo',
  'sakanaction',
  'kenshi yonezu',
  '米津玄師',
  'hikaru utada',
  '宇多田ヒカル',
  'da-ice',
  'omoinotake',
  'back number',
  'awesome city club',
  'official hige dandism',
  'love psychedelico',
  'yorushika',
  'yuzu',
  'tani yuuki',
  'fujii kaze',
  '藤井風',
  'niziu',
  'akb48',
  'aimyon',
  'kana nishino',
  'mr.children',
  'masaki suda',
  'misia',
  'nogizaka46',
  'novelbright',
  'eill',
  'ske48',
]);
const classicalWork =
  /\b(?:symphony|symphonies|concerto|sonata|sonate|quartet|quintet|etude|étude|nocturne|prelude|overture|sarabande|adagio|allegro|bach|mozart|beethoven|chopin|brahms|vivaldi|tchaikovsky|debussy|schubert|schumann|handel|haydn|verdi|puccini|rachmaninoff)\b|交响|協奏|协奏|奏鸣|奏鳴|四重奏|五重奏|练习曲|練習曲|乐章|樂章|歌剧|歌劇|巴赫|莫扎特|贝多芬|肖邦|柴可夫斯基|匈牙利舞曲/i;
const instrumentalRecording =
  /instrumental|solo piano|piano (?:music|pieces|collection)|piano:|钢琴|鋼琴|古筝|古箏|古琴|小提琴|器乐|器樂|纯音乐|純音樂|chillhop|lo[ -]?fi (?:beats|instrumental)|harmonica version|ハーモニカ・バージョン|\b(?:sonata|concerto|symphony|symphonies|quartet|nocturne|sarabande)\b|交响|协奏|奏鸣|四重奏/i;

const knownYear = (track: Track) => {
  const raw = track.metadata ?? {};
  for (const key of [
    'originalReleaseYear',
    'originalReleaseDate',
    'releaseYear',
    'releaseDate',
    'publishTime',
    'publishDate',
    'pubtime',
    'year',
  ]) {
    const value = raw[key];
    if (typeof value === 'number' && value > 1000000000) {
      const year = new Date(
        value < 100000000000 ? value * 1000 : value,
      ).getUTCFullYear();
      if (year >= 1900 && year <= 2100) return year;
    }
    const match = String(value ?? '').match(/(?:19|20)\d{2}/);
    if (match) return Number(match[0]);
  }
  return undefined;
};

export function matchesHomeMenuScene(
  track: Track,
  scene: HomeMenuSceneRule,
  collection?: CatalogItem,
  searchQuery?: string,
) {
  if (!isSceneMusicTrack(track)) return false;
  if (!scene.allowsChildren && isChildDirectedTrack(track, collection)) return false;
  const raw = track.metadata ?? {};
  if (scene.playlistSearchQuery &&
    !(collection?.provider === track.provider && matchesSceneCollection(collection, scene))) return false;
  if (scene.searchQuery && scene.searchQuery.toLowerCase() !== searchQuery?.trim().toLowerCase()) return false;
  const tags = `${track.genre} ${track.mood} ${metadataText(
    raw,
  )}`.toLocaleLowerCase();
  const text =
    `${track.title} ${track.artist} ${track.album} ${tags}`.toLocaleLowerCase();
  if (contains(text, scene.excludedKeywords)) return false;
  if (scene.excludeDanceVersions && danceVersion.test(
    `${track.title} ${track.album} ${track.genre} ${recordingVersionText(raw)}`,
  )) return false;
  const knownGenres = [...textValues(raw.genre), ...textValues(raw.style)]
    .filter(value => !/^(?:流行|pop|music|音乐)$/i.test(value.trim()))
    .join(' ')
    .toLocaleLowerCase();
  if (
    scene.requiredGenres?.length &&
    knownGenres &&
    !contains(knownGenres, scene.requiredGenres)
  )
    return false;
  const pianoVocalRecording = scene.excludeDanceVersions &&
    /钢琴弹唱|鋼琴彈唱|\bpiano[ -]+vocals?\b|\bvocals?[ -]+piano\b/i.test(
      `${track.title} ${recordingVersionText(raw)}`,
    ) && raw.isInstrumental !== true && raw.hasVocals !== false && raw.hasVocal !== false &&
    !(track.provider === 'qq' && raw.language === 9) &&
    !contains(`${track.title} ${track.album} ${tags}`.toLocaleLowerCase(), instrumental);
  const isInstrumental = !pianoVocalRecording && (
    track.language === '纯音乐' ||
    contains(text, instrumental) ||
    /纯音乐|純音樂|instrumental/i.test(metadataText(raw)) ||
    (track.provider === 'qq' && raw.language === 9) ||
    raw.isInstrumental === true ||
    raw.hasVocals === false ||
    raw.hasVocal === false);
  const hasVocals =
    raw.hasVocals === true ||
    raw.hasVocal === true ||
    raw.isInstrumental === false ||
    /人声|vocal pop|vocal jazz|歌唱/.test(tags) || pianoVocalRecording;
  if (scene.vocals === 'required' && isInstrumental) return false;
  const ownRecordingText = `${track.title} ${track.album} ${tags}`;
  // Direct recall may use explicit words from this recording's own identity;
  // a query, artist biography or collection title supplies no such evidence.
  const directClassicalVocalEvidence=Boolean(scene.requiredGenres?.includes('classical')) && !collection &&
    /古典|歌剧|歌劇|咏叹调|詠嘆調|\b(?:classical|opera)\b/i.test(ownRecordingText) &&
    (hasVocals || /声乐|聲樂|歌唱|咏叹调|詠嘆調|合唱|艺术歌曲|藝術歌曲|\b(?:vocals?|arias?|choir|choral|lieder?|cantata|oratorio)\b/i.test(ownRecordingText));
  if (scene.requiredGenres?.includes('classical') && !hasVocals &&
    !/声乐|聲樂|歌唱|咏叹调|詠嘆調|合唱|艺术歌曲|藝術歌曲|\b(?:vocals?|opera|arias?|choir|choral|lieder?|cantata|oratorio)\b/i.test(ownRecordingText))
    return false;
  const hasBackgroundEvidence = Boolean(scene.backgroundSounds) && contains(
    ownRecordingText.toLocaleLowerCase(),
    scene.backgroundSounds === 'nature-and-brainwave'
      ? [...brainwaveSounds, ...natureSounds, 'delta waves', 'δ波']
      : brainwaveSounds,
  );
  const hasInstrumentalEvidence =
    isInstrumental || (!pianoVocalRecording && instrumentalRecording.test(ownRecordingText)) || hasBackgroundEvidence;
  if (scene.vocals === 'required' && (hasInstrumentalEvidence || contains(
    ownRecordingText.toLocaleLowerCase(), [...natureSounds, ...brainwaveSounds, 'delta waves', 'δ波'],
  ))) return false;
  if (
    scene.vocals === 'instrumental' &&
    (hasVocals || !hasInstrumentalEvidence)
  )
    return false;
  if (
    scene.requiredGenres?.includes('classical') &&
    !contains(tags, scene.requiredGenres) &&
    !classicalWork.test(`${track.title} ${track.artist} ${track.album}`) &&
    !directClassicalVocalEvidence
  )
    return false;
  const energy = Number(raw.energy);
  if (
    raw.energy != null &&
    Number.isFinite(energy) &&
    energy >= 0 &&
    energy <= 1
  ) {
    if (scene.energy === 'low' && energy > 0.65) return false;
    if (scene.energy === 'high' && energy < 0.35) return false;
  }
  if (scene.energy === 'low' && contains(tags, energetic)) return false;
  if (
    scene.energy === 'low' &&
    scene.vocals === 'instrumental' &&
    /\b(?:allegro|presto|vivace)\b|急板|快板/.test(
      track.title.toLocaleLowerCase(),
    )
  )
    return false;
  if (scene.energy === 'high' && /助眠|睡眠|sleep|冥想|meditation/.test(tags))
    return false;
  if (scene.listeningContext === 'gaming' && contains(tags, gamingLowEnergy))
    return false;
  if (scene.listeningContext === 'gaming' &&
    !/^(?:流行|pop|music|音乐)$/i.test(track.genre.trim()) &&
    !contains(track.genre.toLocaleLowerCase(), scene.genreKeywords) &&
    !contains(knownGenres, scene.genreKeywords)) return false;
  const japanese =
    /j[ -]?pop|日本流行|日语|日語|japanese|日本語/.test(tags) ||
    /[\u3040-\u30ff]/.test(track.title + track.artist);
  const korean =
    /k[ -]?pop|韩国流行|韩语|韓語|korean|한국어/.test(tags) ||
    /[\uac00-\ud7af]/.test(track.title + track.artist);
  const artistKeys = constituentArtists(track.artist);
  const verifiedKoreanArtist = artistKeys.some(artist =>
    koreanPopArtists.has(artist),
  );
  const verifiedJapaneseArtist = artistKeys.some(artist =>
    japanesePopArtists.has(artist),
  );
  const cantonese = /粤语|粵語|广东话|廣東話|cantonese|cantopop/.test(tags);
  if (scene.region === 'korean' && japanese && !/k[ -]?pop|韩国流行/.test(tags))
    return false;
  if (scene.region === 'japanese' && korean && !/j[ -]?pop|日本流行/.test(tags))
    return false;
  if (scene.region === 'korean' && !korean && !verifiedKoreanArtist)
    return false;
  if (scene.region === 'japanese' && !japanese && !verifiedJapaneseArtist)
    return false;
  if (
    scene.region === 'cantonese' &&
    (/国语|國語|普通话|普通話|mandarin/.test(tags) ||
      (track.provider === 'qq' && raw.language === 0)) &&
    !cantonese
  )
    return false;
  if (
    scene.region === 'western' &&
    (japanese ||
      korean ||
      cantonese ||
      /华语|国语|mandarin|c[ -]?pop/.test(tags))
  )
    return false;
  if (
    scene.region === 'western' &&
    /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(track.title + track.artist)
  )
    return false;
  const year = knownYear(track);
  if (scene.originalYearBefore && year && year >= scene.originalYearBefore)
    return false;
  if (scene.artistPattern)
    return constituentArtists(track.artist).some(artist =>
      scene.artistPattern!.test(artist),
    );

  // The item's real platform/ID is carried only from its own detail request.
  const hasCollectionEvidence =
    collection?.provider === track.provider &&
    matchesSceneCollection(collection, scene);
  const hasTrackEvidence =
    Boolean(scene.searchQuery) ||
    (scene.requiredGenres?.includes('classical') && directClassicalVocalEvidence) ||
    groupsMatch(tags, scene.evidenceGroups) ||
    (scene.listeningContext === 'gaming' &&
      contains(tags, scene.genreKeywords) &&
      (contains(tags, gamingRhythm) ||
        (raw.energy != null && Number.isFinite(energy) && energy >= 0.65 && energy <= 1) ||
        [raw.bpm, raw.tempo, raw.beatsPerMinute].some(value =>
          value != null && value !== '' && Number.isFinite(Number(value)) &&
          Number(value) >= 120 && Number(value) <= 300))) ||
    // A classified nature/brainwave recording supplies its own evidence;
    // an arbitrary playlist cannot turn a vocal song into background sound.
    hasBackgroundEvidence;
  if (!hasCollectionEvidence && !hasTrackEvidence) return false;
  if (
    scene.vocals === 'instrumental' &&
    !isInstrumental &&
    !(scene.backgroundSounds && hasInstrumentalEvidence) &&
    !hasCollectionEvidence
  )
    return false;
  return true;
}

export function sceneEvidenceScore(track: Track, scene: HomeMenuSceneRule, collection?: CatalogItem) {
  const text = `${track.genre} ${track.mood} ${metadataText(
    track.metadata,
  )}`.toLocaleLowerCase();
  const evidence = scene.evidenceGroups.filter(group => contains(text, group)).length;
  if (scene.listeningContext !== 'gaming') return evidence;
  // A small tie preference keeps profile relevance first while favouring
  // high-energy electronic recall over otherwise comparable battle songs.
  const electronicEvidence = contains(text, fastElectronic) || Boolean(
    collection?.provider === track.provider && matchesSceneCollection(collection, scene) &&
    contains(`${collection.title} ${metadataText(collection.metadata)}`.toLocaleLowerCase(), fastElectronic),
  );
  return evidence + (electronicEvidence ? 1 : 0);
}
