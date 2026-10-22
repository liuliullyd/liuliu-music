import type { CatalogRequestBudget } from './catalogRequestBudget';
import type {
  CatalogDetail,
  CatalogItem,
  CatalogKind,
  CoverKey,
  PlatformSetting,
  Track,
} from '../domain/types';
import { md5 } from './storage';
import { qqSign } from './qqSignature';
import { getQishuiCollection, getQishuiPlaylistPage, getQishuiPlaylists, qishuiCharts } from './qishuiCatalog';

export type OnlineProvider = PlatformSetting['id'];

export interface CatalogRequestOptions {
  // Roam opts in; existing all-playlists callers retain their legacy route.
  paginateKugouAllPlaylists?: boolean;
  requestContext?: CatalogRequestBudget;
}

export interface PlaylistCatalogPage {
  items: CatalogItem[];
  nextPage: number | null;
  outOfRange: boolean;
}

const providerNames: Record<OnlineProvider, string> = {
  netease: '网易云音乐',
  qq: 'QQ音乐',
  kugou: '酷狗音乐',
  kuwo: '酷我音乐',
  migu: '咪咕音乐',
  qishui: '汽水音乐',
};
const sourceTypes: Record<OnlineProvider, string> = {
  netease: 'wy',
  qq: 'tx',
  kugou: 'kg',
  kuwo: 'kw',
  migu: 'mg',
  qishui: 'qs',
};
export const onlineProviderIds: OnlineProvider[] = [
  'netease',
  'qq',
  'kugou',
  'kuwo',
  'migu',
  'qishui',
];
// Migu's official rising chart is exposed through the share-page column
// endpoint, but is not included in the current rank-index response. Keep its
// verified real identity available without relabeling another chart.
export const miguRisingChart = {
  id: '83049116',
  title: '飙升榜',
} as const;
// Keep the official hot-song identity available for offline fallback and for
// a rank-index response that is temporarily partial.
export const miguHotChart = {
  id: '27186466',
  title: '热歌榜',
} as const;
// The rank-index endpoint currently exposes these nine real charts. The
// rising chart above is the tenth verified chart supplied by the share page.
// This list is only the offline fallback; a successful rank-index response is
// still authoritative and may add newly published Migu charts.
const miguCatalogCharts = [
  miguRisingChart,
  { id: '83048887', title: '全网热歌榜' },
  { id: '83049014', title: '抖音热歌榜' },
  { id: '83048867', title: '免费热歌榜' },
  { id: '83049056', title: '收藏人气榜' },
  { id: '76557745', title: '会员臻爱榜' },
  { id: '83176390', title: '国风热歌榜' },
  { id: '27553319', title: '新歌榜' },
  miguHotChart,
  { id: '27553408', title: '原创榜' },
] as const;
const defaultCharts: Record<
  OnlineProvider,
  Array<{ id: string; title: string }>
> = {
  netease: [
    { id: '19723756', title: '飙升榜' },
    { id: '3778678', title: '热歌榜' },
    { id: '3779629', title: '新歌榜' },
    { id: '3778678', title: '热歌榜' },
  ],
  qq: [
    { id: '4', title: '流行指数榜' },
    { id: '26', title: '热歌榜' },
    { id: '27', title: '新歌榜' },
    { id: '62', title: '飙升榜' },
  ],
  kugou: [
    { id: '8888', title: '热歌榜' },
    { id: '6666', title: '飙升榜' },
    { id: '31308', title: '华语新歌榜' },
    { id: '52144', title: '抖音热歌榜' },
  ],
  kuwo: [
    { id: '93', title: '飙升榜' },
    { id: '17', title: '新歌榜' },
    { id: '16', title: '热歌榜' },
    { id: '158', title: '抖音热歌榜' },
  ],
  migu: [...miguCatalogCharts],
  qishui: qishuiCharts.map(value => ({ ...value })),
};

type KugouPlaylistTag = { tagid: number; parentId: number };

/**
 * Playlist labels are platform-owned.  The UI may share a friendly label,
 * but every request must resolve it to the selected provider's real tag or
 * category identifier before loading cards.
 */
const playlistCategoryIds: Record<
  OnlineProvider,
  Record<string, string | KugouPlaylistTag>
> = {
  qishui: Object.fromEntries(['全部', '流行', '华语', '欧美', '国风', '民谣', '摇滚', '说唱', '电子', 'R&B', '治愈', '睡前', '学习'].map(value => [value, value])),
  netease: Object.fromEntries([
    '全部',
    '华语',
    '欧美',
    '日语',
    '韩语',
    '粤语',
    '小语种',
    '流行',
    '摇滚',
    '民谣',
    '电子',
    '舞曲',
    '说唱',
    '轻音乐',
    '爵士',
    '古典',
    '乡村',
    '蓝调',
    '另类',
    '世界音乐',
    '原声',
    '影视',
    'ACG',
    '古风',
    '中国风',
    '怀旧',
    '清新',
    '浪漫',
    '伤感',
    '治愈',
    '放松',
    '安静',
    '夜晚',
    '学习',
    '工作',
    '通勤',
    '旅行',
    '运动',
    '亲子',
    '快乐',
    '孤独',
    '感动',
    '兴奋',
    '青春',
    '网络歌曲',
    'KTV',
    '翻唱',
    '现场',
    'DJ',
    '综艺',
    '儿歌',
    '少儿',
    '游戏',
    '80后',
    '90后',
    '00后',
  ].map(value => [value, value])),
  qq: {
    全部: '10000000',
    华语: '165',
    欧美: '167',
    日语: '169',
    韩语: '168',
    粤语: '166',
    小语种: '170',
    流行: '6',
    轻音乐: '15',
    摇滚: '11',
    民谣: '28',
    电子: '24',
    说唱: '153',
    爵士: '21',
    古典: '27',
    乡村: '18',
    蓝调: '22',
    世界音乐: '220',
    ACG: '39',
    影视: '133',
    古风: '194',
    中国风: '145',
    怀旧: '136',
    网络歌曲: '146',
    KTV: '141',
    儿歌: '131',
    伤感: '52',
    安静: '122',
    快乐: '117',
    治愈: '116',
    学习: '101',
    工作: '94',
    旅行: '81',
    运动: '99',
    夜晚: '78',
    // QQ's current public tag configuration no longer exposes the decade
    // group. Keep the visible categories real by routing decade labels
    // through QQ's playlist search endpoint rather than inventing stale IDs.
    '80后': '80后',
    '90后': '90后',
    '00后': '00后',
    现场: '197',
    DJ: '14',
  },
  kugou: {
    全部: '0',
    华语: { tagid: 37, parentId: 1599 },
    欧美: { tagid: 35, parentId: 1599 },
    日语: { tagid: 1091, parentId: 1599 },
    韩语: { tagid: 1093, parentId: 1599 },
    粤语: { tagid: 13, parentId: 1599 },
    小语种: { tagid: 12, parentId: 1599 },
    流行: { tagid: 393, parentId: 1599 },
    摇滚: { tagid: 389, parentId: 1599 },
    民谣: { tagid: 392, parentId: 1599 },
    电子: { tagid: 391, parentId: 1599 },
    说唱: { tagid: 387, parentId: 1599 },
    轻音乐: { tagid: 173, parentId: 1599 },
    爵士: { tagid: 397, parentId: 1599 },
    古典: { tagid: 390, parentId: 1599 },
    乡村: { tagid: 399, parentId: 1599 },
    ACG: { tagid: 181, parentId: 1263 },
    影视: { tagid: 180, parentId: 1263 },
    古风: { tagid: 127, parentId: 1599 },
    中国风: { tagid: 127, parentId: 1599 },
    怀旧: { tagid: 155, parentId: 1263 },
    伤感: { tagid: 146, parentId: 2005 },
    治愈: { tagid: 143, parentId: 2005 },
    快乐: { tagid: 143, parentId: 2005 },
    兴奋: { tagid: 139, parentId: 2005 },
    安静: { tagid: 67, parentId: 2005 },
    学习: { tagid: 1876, parentId: 2003 },
    工作: { tagid: 386, parentId: 2003 },
    通勤: { tagid: 2202, parentId: 2003 },
    旅行: { tagid: 375, parentId: 2003 },
    运动: { tagid: 366, parentId: 2003 },
    夜晚: { tagid: 354, parentId: 2003 },
    儿歌: { tagid: 171, parentId: 32 },
    少儿: { tagid: 171, parentId: 32 },
    游戏: { tagid: 1877, parentId: 1263 },
    // Kugou's live tag payload separates the display id from the
    // special_tag_id consumed by /tag/specialList.
    '80后': { tagid: 14, parentId: 32 },
    '90后': { tagid: 76, parentId: 32 },
    '00后': { tagid: 571, parentId: 32 },
    KTV: { tagid: 361, parentId: 2003 },
    翻唱: { tagid: 1848, parentId: 1263 },
    DJ: { tagid: 168, parentId: 1599 },
  },
  kuwo: {
    全部: '0',
    华语: '37',
    欧美: '35',
    日语: '1091',
    韩语: '1093',
    粤语: '13',
    小语种: '12',
    流行: '393',
    摇滚: '389',
    民谣: '392',
    电子: '391',
    说唱: '387',
    轻音乐: '173',
    爵士: '397',
    古典: '390',
    乡村: '399',
    ACG: '181',
    影视: '180',
    古风: '127',
    中国风: '127',
    怀旧: '155',
    伤感: '146',
    治愈: '143',
    快乐: '143',
    兴奋: '139',
    安静: '67',
    学习: '1876',
    工作: '386',
    通勤: '2202',
    旅行: '375',
    运动: '366',
    夜晚: '354',
    儿歌: '171',
    少儿: '171',
    游戏: '1877',
    '80后': '638',
    '90后': '639',
    '00后': '640',
    KTV: '361',
    翻唱: '1848',
    DJ: '168',
  },
  migu: Object.fromEntries([
    '全部',
    '华语',
    '欧美',
    '日语',
    '韩语',
    '粤语',
    '小语种',
    '流行',
    '摇滚',
    '民谣',
    '电子',
    '舞曲',
    '说唱',
    '轻音乐',
    '爵士',
    '古典',
    '乡村',
    '蓝调',
    '另类',
    '世界音乐',
    '原声',
    '影视',
    'ACG',
    '古风',
    '中国风',
    '怀旧',
    '清新',
    '浪漫',
    '伤感',
    '治愈',
    '放松',
    '安静',
    '夜晚',
    '学习',
    '工作',
    '通勤',
    '旅行',
    '运动',
    '亲子',
    '快乐',
    '孤独',
    '感动',
    '兴奋',
    '青春',
    '网络歌曲',
    'KTV',
    '翻唱',
    '现场',
    'DJ',
    '综艺',
    '儿歌',
    '少儿',
    '游戏',
    '80后',
    '90后',
    '00后',
  ].map(value => [value, value])),
};

export const playlistCategoryLabelsForProvider = (provider: OnlineProvider) =>
  Object.keys(playlistCategoryIds[provider]);

const miguPlaylistRows = (body: any): any[] => {
  const direct =
    body?.songListResultData?.result ??
    body?.songListResultData?.resultList ??
    body?.songlistResultData?.result ??
    body?.songlistResultData?.resultList ??
    body?.playlistResultData?.result ??
    body?.playlistResultData?.resultList ??
    body?.songLists ??
    body?.playlists ??
    body?.data?.songLists;
  if (Array.isArray(direct)) return direct.flat();
  const result: any[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (
      (value.songListId || value.playlistId || String(value.resType) === '2021') &&
      (value.songListName || value.playlistName || value.title || value.name || value.txt)
    ) {
      result.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return result;
};

const getMiguCategoryPlaylists = async (category: string, page: number) => {
  const query = category.trim();
  const timestamp = Date.now().toString();
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const sign = await md5(
    `${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`,
  );
  const searchSwitch = encodeURIComponent(
    JSON.stringify({
      song: 0,
      album: 0,
      singer: 0,
      tagSong: 0,
      mvSong: 0,
      bestShow: 0,
      songlist: 1,
      lyricSong: 0,
    }),
  );
  const body = await jsonText(
    `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=30&text=${encodeURIComponent(query)}&pageNo=${Math.max(1, page)}&sort=0&sid=USS`,
    {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId,
        timestamp,
        sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
      },
    },
  );
  return miguPlaylistRows(body).map(value =>
    item(
      'migu',
      'playlists',
      value.songListId ?? value.playlistId ?? value.resId ?? value.id,
      value.songListName ?? value.playlistName ?? value.title ?? value.name ?? value.txt,
      value.summary ?? value.desc ?? value.description ?? value.txt2,
      value.imgItem?.img ?? value.img ?? value.image ?? value.coverUrl,
      [
        value.imgItem?.img2,
        value.imageUrl,
        value.pic,
        value.picUrl,
        value.musicListPicUrl,
      ],
    ),
  );
};

/**
 * QQ removed the decade group from its public category configuration, but its
 * real playlist search still exposes the same 80后 collection query. Keep the
 * category bound to QQ by using that platform-owned search route instead of
 * sending a made-up numeric category id.
 */
const getQqCategorySearchPlaylists = async (category: string, page: number) => {
  const limit = 30;
  const data = {
    comm: {
      ct: '11',
      cv: '14090508',
      v: '14090508',
      tmeAppID: 'qqmusic',
      phonetype: 'Android',
      os_ver: '12',
      OpenUDID: '0',
      QIMEI36: '0',
      nettype: '1020',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 3,
        searchid: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        query: category,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: (page - 1) * limit,
        sem: 0,
      },
    },
  };
  const payload = JSON.stringify(data);
  const body = await jsonText(
    `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(payload)}`,
    {
      method: 'POST',
      headers: {
        ...headers('https://y.qq.com/'),
        'Content-Type': 'application/json',
        'User-Agent': 'QQMusic 14090508(android 12)',
      },
      body: payload,
    },
  );
  if (body.code !== 0 || body.req?.code !== 0)
    throw new Error(`秋秋歌单分类搜索错误 ${body.req?.code ?? body.code ?? '未知'}`);
  return (body.req?.data?.body?.item_songlist ?? []).map((value: any) =>
    item(
      'qq',
      'playlists',
      value.dissid ?? value.dissId ?? value.tid ?? value.docid,
      value.dissname ?? value.title ?? value.name,
      value.subhead ?? value.description ?? value.introduction ?? value.nickname,
      value.logo ?? value.cover_url_medium ?? value.imgurl,
    ),
  );
};

const clean = (value: unknown) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const coverFields = [
  'url',
  'image',
  'imageUrl',
  'img',
  'imgurl',
  'pic',
  'picUrl',
  'pic_url',
  'album_pic',
  'albumpic',
  'src',
  'cover',
  'coverUrl',
  'imgItem',
  'img1',
  'img2',
  'img3',
  'Image',
  'blurPicUrl',
  'album_img',
  'albumImg',
  'musicPic',
  'coverImg',
  'union_cover',
] as const;

const rawCoverValues = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(rawCoverValues);
  if (!value || typeof value !== 'object') return [value];
  const record = value as Record<string, unknown>;
  return coverFields.flatMap(field =>
    record[field] === undefined ? [] : rawCoverValues(record[field]),
  );
};

const normalizeCoverCandidate = (value: unknown, provider?: OnlineProvider) => {
  if (
    typeof value === 'string' &&
    /^http:\/\/artistpicserver\.kuwo\.cn\/pic\.web\?/i.test(value)
  )
    return value;
  let url = clean(value)
    .replace(/\{(?:size|width|height)\}/gi, '400')
    .replace(/^\/\//, 'https:')
    .replace(/^http:/i, 'https:');
  if (provider === 'migu' && !/^https?:\/\//i.test(url)) {
    const relative = url.replace(/^\/+/, '');
    // Migu's search endpoint returns the three artwork sizes as extensionless
    // `/data/oss/...` objects. They are image resources (the response carries
    // the content type), so requiring a filename extension silently discards
    // the real cover and leaves every Live row on its bundled fallback.
    if (
      /^(?:data\/oss|resource)\/[\w./-]+(?:\.(?:jpe?g|png|webp|gif))?(?:[?#].*)?$/i.test(
        relative,
      ) ||
      /^[\w/-]+\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(relative)
    )
      url = `https://d.musicapp.migu.cn/${relative}`;
  }
  if (!/^https?:\/\//i.test(url)) return '';
  if (provider === 'kuwo') {
    url = url.replace(
      /^https?:\/\/img1\.kwcdn\.kuwo\.cn\//i,
      'https://img1.kuwo.cn/',
    );
    url = url.replace(/^http:\/\/img1\.kuwo\.cn\//i, 'https://img1.kuwo.cn/');
  }
  try {
    return new URL(url).toString();
  } catch {
    return '';
  }
};

/** Return ordered, provider-aware cover candidates without changing identity. */
export const coverCandidates = (
  provider: OnlineProvider | undefined,
  value: unknown,
): string[] => {
  const candidates: string[] = [];
  for (const raw of rawCoverValues(value)) {
    const normalized = normalizeCoverCandidate(raw, provider);
    if (normalized && !candidates.includes(normalized))
      candidates.push(normalized);
    if (provider === 'kuwo' && typeof raw === 'string') {
      const original = clean(raw).replace(/^\/\//, 'https:');
      if (/^https?:\/\/img1\.kwcdn\.kuwo\.cn\//i.test(original)) {
        const httpFallback = original.replace(
          /^https:\/\/img1\.kwcdn\.kuwo\.cn\//i,
          'http://img1.kwcdn.kuwo.cn/',
        );
        if (!candidates.includes(httpFallback)) candidates.push(httpFallback);
      }
      if (/^https?:\/\/img1\.kuwo\.cn\//i.test(original)) {
        const httpFallback = original.replace(
          /^https:\/\/img1\.kuwo\.cn\//i,
          'http://img1.kuwo.cn/',
        );
        if (!candidates.includes(httpFallback)) candidates.push(httpFallback);
      }
    }
    if (provider === 'migu' && typeof raw === 'string') {
      if (/^https:\/\/d\.musicapp\.migu\.cn\//i.test(normalized)) {
        const httpFallback = normalized.replace(/^https:/i, 'http:');
        if (!candidates.includes(httpFallback)) candidates.push(httpFallback);
      }
    }
  }
  return candidates;
};

const coverUrl = (value: unknown, provider?: OnlineProvider): string =>
  coverCandidates(provider, value)[0] ?? '';

/**
 * Return only the cover candidates that belong to this track's metadata.
 *
 * Playback screens may receive provider records with several differently named
 * image fields.  Keeping the extraction here makes the identity/presentation
 * boundary explicit: callers can try every metadata candidate, but never need
 * to invent a URL from an unrelated track or replace the track's bundled
 * fallback.
 */
export const trackCoverCandidates = (track: Track): string[] => {
  const metadata = track.metadata ?? {};
  const album =
    metadata.album && typeof metadata.album === 'object'
      ? (metadata.album as Record<string, unknown>)
      : metadata.al && typeof metadata.al === 'object'
      ? (metadata.al as Record<string, unknown>)
      : {};
  const values: unknown[] = [
    track.cover,
    metadata.picUrl,
    metadata.picurl,
    metadata.album_pic,
    metadata.albumpic,
    metadata.album_img,
    metadata.albumImg,
    metadata.albumImage,
    metadata.albumCover,
    metadata.union_cover,
    metadata.trans_param && typeof metadata.trans_param === 'object'
      ? (metadata.trans_param as Record<string, unknown>).union_cover
      : undefined,
    metadata.img3,
    metadata.img2,
    metadata.img1,
    metadata.imgItem,
    metadata.Image,
    metadata.blurPicUrl,
    metadata.musicPic,
    metadata.coverImg,
    metadata.cover,
    metadata.coverUrl,
    metadata.img,
    metadata.imgurl,
    metadata.pic,
    metadata.pic_url,
    metadata.albumImgs,
    metadata.image,
    metadata.imageUrl,
    album.picUrl,
    album.blurPicUrl,
    album.pic_url,
    album.img,
    album.cover,
    album.album_pic,
    album.albumpic,
    album.album_img,
    album.albumImg,
    album.pic,
    album.image,
    album.imgItem,
  ];
  if (track.provider === 'qq') {
    const albumMid = [metadata.albummid, metadata.albumMid, album.mid]
      .map(clean)
      .find(Boolean);
    if (albumMid)
      values.push(
        `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`,
      );
  }
  if (track.provider === 'kuwo' && clean(metadata.web_albumpic_short))
    values.push(
      `https://img1.kuwo.cn/star/albumcover/${clean(
        metadata.web_albumpic_short,
      )}`,
    );
  const result = coverCandidates(
    track.provider === 'custom' ? undefined : track.provider,
    values,
  );
  // Last candidate: resolve only this Kuwo song's artwork, never an album ID or audio URL.
  const rid = clean(track.providerId).replace(/^MUSIC_/, '');
  if (track.provider === 'kuwo' && /^\d+$/.test(rid)) {
    const lookup = `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=url&size=500&rid=${rid}`;
    if (!result.includes(lookup)) result.push(lookup);
  }
  return result;
};

const uniqueCoverCandidates = (values: string[]) =>
  Array.from(new Set(values.filter(value => /^https?:\/\//i.test(value))));

/**
 * Return playback-page artwork candidates with the largest provider variant
 * first. Home and catalog surfaces intentionally keep their thumbnail
 * normalizer; this helper is only for the full-screen player where a small
 * thumbnail is visibly enlarged.
 */
export const playerCoverCandidates = (track: Track): string[] => {
  const base = trackCoverCandidates(track);
  const result: string[] = [];
  const add = (value: string) => {
    if (value && !result.includes(value)) result.push(value);
  };
  const addSizedPathVariants = (value: string) => {
    const sizes = [1000, 800, 600, 500, 400];
    const pathMatch = value.match(
      /\/(?:100|120|150|180|200|240|256|300|400|500|600|800|1000)(?=\/)/,
    );
    if (pathMatch) {
      for (const size of sizes) add(value.replace(pathMatch[0], `/${size}`));
    }
    if (/[?&]size=\d+/i.test(value)) {
      for (const size of sizes)
        add(value.replace(/([?&]size=)\d+/i, `$1${size}`));
    }
  };

  for (const value of base) {
    if (track.provider === 'netease' && /music\.126\.net\//i.test(value)) {
      const [baseUrl, query = ''] = value.split('?');
      const params = query
        .split('&')
        .filter(part => part && !/^param=/i.test(part));
      for (const size of [1000, 800, 600, 500])
        add(`${baseUrl}?${[...params, `param=${size}y${size}`].join('&')}`);
    }
    if (track.provider === 'qq') {
      for (const size of [800, 500, 300])
        add(value.replace(/T002R\d+x\d+M000/i, `T002R${size}x${size}M000`));
    }
    if (track.provider === 'kugou' || track.provider === 'migu')
      addSizedPathVariants(value);
    if (track.provider === 'kuwo') addSizedPathVariants(value);
    add(value);
  }
  return uniqueCoverCandidates(result);
};
const seconds = (value: unknown) => {
  if (typeof value === 'string') {
    const parts = value.trim().split(':');
    if (
      (parts.length === 2 || parts.length === 3) &&
      parts.every(part => /^\d{1,3}$/.test(part))
    ) {
      const numbers = parts.map(Number);
      return parts.length === 3
        ? numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!
        : numbers[0]! * 60 + numbers[1]!;
    }
  }
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number > 1000 ? number / 1000 : number)
    : 0;
};
const coverKey = (value: string): CoverKey => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  return (['train', 'cat', 'ocean', 'vinyl'] as CoverKey[])[
    Math.abs(hash) % 4
  ]!;
};
const metadataText = (raw: Record<string, unknown>) => {
  const album =
    raw.album && typeof raw.album === 'object'
      ? (raw.album as Record<string, unknown>)
      : raw.al && typeof raw.al === 'object'
      ? (raw.al as Record<string, unknown>)
      : {};
  const values = [
    raw.language,
    raw.languageName,
    raw.language_name,
    raw.lang,
    raw.songLanguage,
    raw.song_language,
    raw.languageType,
    raw.language_type,
    raw.category,
    raw.categoryName,
    raw.category_name,
    raw.genre,
    raw.style,
    raw.tags,
    album.language,
    album.languageName,
    album.language_name,
    album.publishTime,
    album.pub_time,
    album.publicTime,
  ];
  return values
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .map(value => clean(value))
    .filter(Boolean)
    .join(' ');
};

const parseYear = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1900 && value <= 2100) return Math.trunc(value);
    if (value >= 1_000_000_000) {
      const year = new Date(
        value < 10_000_000_000 ? value * 1000 : value,
      ).getFullYear();
      return year >= 1900 && year <= 2100 ? year : 0;
    }
  }
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
};

const releaseYearFor = (raw: Record<string, unknown>) => {
  const album =
    raw.album && typeof raw.album === 'object'
      ? (raw.album as Record<string, unknown>)
      : raw.al && typeof raw.al === 'object'
      ? (raw.al as Record<string, unknown>)
      : {};
  for (const value of [
    raw.releaseYear,
    raw.release_year,
    raw.publishTime,
    raw.publish_time,
    raw.pub_time,
    raw.publicTime,
    raw.public_time,
    raw.issueDate,
    raw.issue_date,
    raw.releaseDate,
    raw.release_date,
    album.publishTime,
    album.publish_time,
    album.pub_time,
    album.publicTime,
    album.public_time,
    album.releaseDate,
  ]) {
    const year = parseYear(value);
    if (year) return year;
  }
  return new Date().getFullYear();
};

const languageFor = (
  title: string,
  raw: Record<string, unknown> = {},
): Track['language'] => {
  const text = `${title} ${metadataText(raw)}`;
  if (/(?:粤语|廣東話|广东话|cantonese|cantopop)/i.test(text)) return '粤语';
  if (/(?:纯音乐|轻音乐|instrumental|piano|钢琴|ambient)/i.test(text))
    return '纯音乐';
  if (/(?:acg|动漫|二次元|anime|game\s*ost)/i.test(text)) return 'ACG';
  if (/(?:日语|日本語|j-pop|jpop|韩语|한국어|k-pop|kpop)/i.test(text))
    return '日韩';
  return /[\u3040-\u30ff\uac00-\ud7af]/.test(title)
    ? '日韩'
    : /[\u4e00-\u9fff]/.test(title)
    ? '华语'
    : '欧美';
};
const artistNames = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map(item =>
          clean(
            typeof item === 'string' ? item : (item as { name?: unknown }).name,
          ),
        )
        .filter(Boolean)
        .join(' / ')
    : clean(value);

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
};

function toTrack(
  provider: OnlineProvider,
  id: unknown,
  titleValue: unknown,
  artistValue: unknown,
  albumValue: unknown,
  durationValue: unknown,
  coverValue: unknown,
  raw: Record<string, unknown>,
): Track {
  const providerId = firstText(
    id,
    raw.songmid,
    raw.songId,
    raw.songid,
    raw.strMediaMid,
    raw.musicId,
    raw.musicid,
    raw.contentId,
    raw.hash,
    raw.id,
  ).replace(/^MUSIC_/, '');
  const title = firstText(
    titleValue,
    raw.name,
    raw.songname,
    raw.songName,
    raw.SONGNAME,
    raw.title,
    raw.filename,
    raw.fileName,
  );
  const artist = firstText(
    artistNames(artistValue),
    artistNames(raw.singer),
    raw.singername,
    raw.singerName,
    raw.artist,
    raw.ARTIST,
  );
  const album = firstText(
    albumValue,
    raw.albumName,
    raw.album_name,
    raw.albumname,
    raw.ALBUM,
  );
  const albumRecord =
    raw.album && typeof raw.album === 'object'
      ? (raw.album as Record<string, unknown>)
      : raw.al && typeof raw.al === 'object'
      ? (raw.al as Record<string, unknown>)
      : {};
  const cover = coverUrl(
    [
      coverValue,
      ...coverFields
        .filter(field => field !== 'url' && field !== 'src')
        .map(field => raw[field]),
      albumRecord,
      raw.trans_param,
    ],
    provider,
  );
  return {
    id: `${provider}-${providerId}`,
    title,
    artist,
    album,
    duration: seconds(durationValue),
    provider,
    providerId,
    cover: cover || undefined,
    coverKey: coverKey(`${provider}:${providerId}`),
    language: languageFor(`${title} ${artist}`, raw),
    genre: '流行',
    mood: '发现',
    releaseYear: releaseYearFor(raw),
    quality: 'SQ',
    metadata: {
      ...raw,
      id: providerId,
      songmid: raw.songmid ?? providerId,
      name: firstText(raw.name, title),
      singer: firstText(raw.singer, artist),
      albumName: firstText(raw.albumName, album),
      sourceType: sourceTypes[provider],
      providerName: providerNames[provider],
    },
  };
}

/** Fill presentation fields from provider metadata without changing playback identity. */
export const enrichTrackPresentation = (track: Track): Track => {
  const metadata = track.metadata ?? {};
  const album =
    metadata.album && typeof metadata.album === 'object'
      ? (metadata.album as Record<string, unknown>)
      : metadata.al && typeof metadata.al === 'object'
      ? (metadata.al as Record<string, unknown>)
      : {};
  const title = firstText(
    track.title,
    metadata.name,
    metadata.songname,
    metadata.songName,
    metadata.SONGNAME,
    metadata.title,
    metadata.filename,
  );
  const artist = firstText(
    track.artist,
    artistNames(metadata.singer),
    metadata.singername,
    metadata.singerName,
    metadata.artist,
    metadata.ARTIST,
  );
  const albumTitle = firstText(
    track.album,
    metadata.albumName,
    metadata.album_name,
    metadata.albumname,
    album.name,
    album.title,
  );
  const cover = trackCoverCandidates(track)[0];
  const providerId = firstText(
    track.providerId,
    metadata.songmid,
    metadata.songId,
    metadata.songid,
    metadata.strMediaMid,
    metadata.musicId,
    metadata.musicid,
    metadata.copyrightId,
    metadata.contentId,
    metadata.hash,
    metadata.id,
  );
  return {
    ...track,
    title: title || '未命名歌曲',
    artist: artist || '未知歌手',
    album: albumTitle || '未知专辑',
    cover: cover || undefined,
    providerId: providerId || undefined,
  };
};

export const normalizeNeteaseTrack = (song: any): Track => {
  const album = song.al ?? song.album ?? {};
  const artists = song.ar ?? song.artists ?? [];
  return toTrack(
    'netease',
    song.id,
    song.name,
    artists,
    album.name,
    song.dt ?? song.duration,
    [album.picUrl, album.blurPicUrl, song.picUrl],
    {
      ...song,
      albumId: String(album.id ?? ''),
      _types: neteaseQualities(song, song.privilege),
    },
  );
};
export const normalizeQqTrack = (song: any): Track => {
  const id = song.songmid ?? song.mid ?? song.songid ?? song.id;
  const album = song.album ?? {};
  const albumMid = firstText(song.albummid, album.mid);
  const artist = artistNames(song.singer);
  return toTrack(
    'qq',
    id,
    song.songname ?? song.title ?? song.name,
    artist,
    song.albumname ?? album.name,
    song.interval,
    albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
      : '',
    {
      ...song,
      songmid: clean(id),
      songId: Number(song.songid ?? song.id),
      strMediaMid: clean(song.strMediaMid ?? song.file?.media_mid ?? id),
      albumMid,
      albumId: albumMid,
      // Keep the provider singer entities intact.  QQ's singer detail route
      // needs singerMid; replacing the array with the display string loses
      // that identity and makes every detail click fall back to an unstable
      // aggregate search.
      singer: song.singer ?? artist,
      artistEntities: song.singer ?? [{ name: artist }],
      _types: qqQualities(song.file ?? {}),
    },
  );
};
export const normalizeKuwoTrack = (song: any): Track => {
  const id = clean(
    song.id ?? song.musicrid ?? song.MUSICRID ?? song.MUSICID ?? song.rid,
  ).replace(/^MUSIC_/, '');
  const title = song.name ?? song.SONGNAME;
  const artist = song.artist ?? song.ARTIST;
  const album = song.album ?? song.ALBUM;
  const cover = song.web_albumpic_short
    ? `https://img1.kuwo.cn/star/albumcover/${song.web_albumpic_short}`
    : [
        song.albumpic,
        song.musicPic,
        song.pic,
        song.picUrl,
        song.album_pic,
        song.albumImg,
      ];
  return toTrack(
    'kuwo',
    id,
    title,
    artist,
    album,
    song.song_duration ?? song.duration ?? song.DURATION,
    cover,
    {
      ...song,
      songmid: id,
      albumId: String(song.albumId ?? song.albumid ?? song.ALBUMID ?? ''),
      artistEntities: [
        {
          id: song.artistId ?? song.artistid ?? song.ARTISTID,
          name: artist,
        },
      ],
    },
  );
};
export const normalizeKugouTrack = (song: any): Track => {
  const hash = clean(
    song.hash ?? song.FileHash ?? song.audio_id ?? song.Audioid,
  );
  const fileName = clean(song.filename);
  const artist = clean(
    song.singername ??
      song.SingerName ??
      song.Singers?.map((item: any) => item.name).join(' / ') ??
      fileName.split(' - ')[0],
  );
  const title = clean(song.songname ?? song.SongName ?? fileName).replace(
    /^.*?\s-\s/,
    '',
  );
  const singerValues = [
    ...(Array.isArray(song.Singers) ? song.Singers : []),
    ...(Array.isArray(song.singerList) ? song.singerList : []),
    ...(Array.isArray(song.singer_list) ? song.singer_list : []),
  ].filter(Boolean);
  const singerId = clean(
    song.singerid ??
      song.singerId ??
      song.SingerId ??
      song.SingerID ??
      song.singer_id ??
      singerValues[0]?.id ??
      singerValues[0]?.singerid ??
      singerValues[0]?.singerId,
  );
  const artistEntities = singerValues.length
    ? singerValues.map((value: any) => ({
        id: clean(
          value.id ?? value.singerid ?? value.singerId ?? value.SingerId,
        ),
        name: clean(value.name ?? value.SingerName ?? value.singername),
      }))
    : singerId
    ? [{ id: singerId, name: artist }]
    : [{ name: artist }];
  return toTrack(
    'kugou',
    hash,
    title,
    artist,
    song.album_name ?? song.AlbumName ?? song.remark,
    song.duration ?? song.Duration,
    [
      song.img,
      song.Image,
      song.pic,
      song.picUrl,
      song.trans_param?.union_cover,
      song.album_img,
      song.albumImg,
    ],
    {
      ...song,
      id: hash,
      songmid: hash,
      hash,
      '320hash': song.HQFileHash ?? song.hash_320,
      sqhash: song.SQFileHash ?? song.sqhash,
      hash_high: song.ResFileHash ?? song.hash_high,
      albumId: String(song.album_id ?? song.AlbumID ?? ''),
      artistEntities,
    },
  );
};
export const normalizeMiguTrack = (song: any): Track => {
  const id = song.songId ?? song.id ?? song.contentId;
  const artist =
    song.singerList ?? song.artists ?? song.singer ?? song.singerName;
  const rawCover = [
    song.img3,
    song.img2,
    song.img1,
    song.picUrl,
    song.image,
    song.imageUrl,
    song.cover,
    song.img,
    song.pic,
    song.imgItem,
    song.albumImgs,
    song.album?.imgItem,
    song.album?.img,
    song.album?.image,
    song.album?.picUrl,
    song.coverImg,
  ];
  const cover = coverUrl(rawCover, 'migu');
  return toTrack(
    'migu',
    id,
    song.songName ?? song.name,
    artist,
    song.album ?? song.albumName,
    song.duration ??
      song.length ??
      song.totalTime ??
      song.songTime ??
      song.songDuration,
    cover,
    {
      ...song,
      songmid: clean(id),
      copyrightId: clean(song.copyrightId ?? song.contentId ?? id),
      albumId: String(
        song.albumId ??
          song.album_id ??
          song.AlbumID ??
          song.album?.id ??
          song.album?.albumId ??
          '',
      ),
    },
  );
};

const neteaseQualities = (song: any, privilege?: any) => {
  const result: Record<string, { size: string | null }> = {};
  const max = Number(privilege?.maxbr ?? 999000);
  if (max >= 128000) result['128k'] = { size: sizeValue(song.l?.size) };
  if (max >= 320000) result['320k'] = { size: sizeValue(song.h?.size) };
  if (max >= 999000) result.flac = { size: sizeValue(song.sq?.size) };
  // NetEase `hr` is its high-resolution/master tier. Keep it as `hires`
  // through candidate selection; the native URL probe still decides whether
  // the returned file is actually 至臻 or 母带.
  if (song.hr?.size) result.hires = { size: sizeValue(song.hr.size) };
  return result;
};
const qqQualities = (file: any) =>
  Object.fromEntries(
    [
      ['128k', file.size_128mp3],
      ['320k', file.size_320mp3],
      ['flac', file.size_flac],
      ['hires', file.size_hires],
    ]
      .filter(([, size]) => Number(size) > 0)
      .map(([type, size]) => [type, { size: String(size) }]),
  );
const sizeValue = (value: unknown) =>
  Number(value) > 0 ? String(value) : null;

const withTimeout = async (url: string, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
};
const json = async (url: string, init: RequestInit = {}, requestContext?: CatalogRequestBudget) =>
  (requestContext ? requestContext.fetch(url, init) : withTimeout(url, init))
    .then(response => response.text())
    .then(parsePlatformJsonText);
export const parsePlatformJsonText = (text: string) => {
  const raw = text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
    const candidate = (match?.[1] ?? raw).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Some legacy Kuwo endpoints return a Python-literal object instead of
      // JSON (single-quoted strings and, occasionally, None/True/False).
      // Convert only syntax outside strings; a global quote replacement would
      // corrupt apostrophes in album titles and descriptions.
      let output = '';
      let singleQuoted = false;
      let doubleQuoted = false;
      let escaped = false;
      for (let index = 0; index < candidate.length; index += 1) {
        const character = candidate[index]!;
        if (singleQuoted) {
          if (escaped) {
            if (character === "'") output += "'";
            else if (character === '"') output += '\\"';
            else output += `\\${character}`;
            escaped = false;
          } else if (character === '\\') escaped = true;
          else if (character === "'") {
            output += '"';
            singleQuoted = false;
          } else if (character === '"') output += '\\"';
          else if (character === '\n') output += '\\n';
          else if (character === '\r') output += '\\r';
          else if (character === '\t') output += '\\t';
          else output += character;
          continue;
        }
        if (doubleQuoted) {
          output += character;
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') doubleQuoted = false;
          continue;
        }
        if (character === "'") {
          output += '"';
          singleQuoted = true;
          continue;
        }
        if (character === '"') {
          output += character;
          doubleQuoted = true;
          continue;
        }
        if (candidate.startsWith('None', index)) {
          output += 'null';
          index += 3;
        } else if (candidate.startsWith('True', index)) {
          output += 'true';
          index += 3;
        } else if (candidate.startsWith('False', index)) {
          output += 'false';
          index += 4;
        } else output += character;
      }
      if (singleQuoted || doubleQuoted || escaped)
        throw new Error('平台返回了无效 JSON');
      try {
        return JSON.parse(output);
      } catch {
        throw new Error('平台返回了无效 JSON');
      }
    }
  }
};
const jsonText = async (url: string, init: RequestInit = {}) =>
  withTimeout(url, init)
    .then(response => response.text())
    .then(parsePlatformJsonText);
const headers = (referer: string) => ({
  Referer: referer,
  'User-Agent': 'Mozilla/5.0',
});
const item = (
  provider: OnlineProvider,
  kind: CatalogKind,
  id: unknown,
  title: unknown,
  description: unknown,
  cover: unknown,
  coverValues: unknown[] = [],
): CatalogItem => ({
  id: clean(id),
  title: clean(title) || '未命名内容',
  description: clean(description),
  cover: coverUrl([cover, ...coverValues], provider) || undefined,
  coverCandidates: coverCandidates(provider, [cover, ...coverValues]),
  provider,
  kind,
});

type ChartCatalogValue = {
  id: string;
  title: string;
  cover?: string;
  coverValues?: unknown[];
};

/** Accept the response shapes used by the Migu chart endpoint over time. */
export const extractMiguChartRows = (body: any): any[] => {
  const direct = [
    body?.columnInfo?.contents,
    body?.data?.columnInfo?.contents,
    body?.data?.contents,
    body?.columnInfo?.songList,
    body?.data?.songList,
    body?.songList,
  ].find(Array.isArray) as any[] | undefined;
  if (direct?.length)
    return direct.map(value => value?.objectInfo ?? value);
  const rows: any[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const hasSongIdentity =
      value.songId ??
      value.song_id ??
      value.contentId ??
      value.copyrightId ??
      value.songName ??
      value.song_name;
    if (hasSongIdentity) {
      rows.push(value.objectInfo ?? value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return rows;
};

/**
 * Parse the catalogue used by Migu's current web ranking page. The response
 * groups charts under ZJ-RANK-SPECIAL and ZJ-RANK-NORMAL, while older
 * responses have used columnId/resId and slightly different artwork fields.
 */
export const extractMiguRankIndexCharts = (
  body: any,
): ChartCatalogValue[] => {
  const values: ChartCatalogValue[] = [];
  const seen = new Set<string>();
  const visit = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (
      value.songId ||
      value.copyrightId ||
      value.songData ||
      value.resType === '2'
    )
      return;
    const id = clean(value.rankId ?? value.columnId ?? value.resId ?? value.id);
    const title = clean(
      value.rankName ??
        value.columnTitle ??
        value.title ??
        value.name ??
        value.txt,
    );
    const isChart =
      value.rankId || value.columnId || (value.resId && /榜/.test(title));
    if (id && title && isChart) {
      if (seen.has(id)) return;
      const coverValues = [
        value.imageUrl,
        value.columnPicUrl,
        value.columnSmallpicUrl,
        value.customizedPicUrls,
        value.recommendPicUrl,
        value.img,
        value.image,
      ].filter(candidate => clean(candidate));
      seen.add(id);
      values.push({
        id,
        title,
        cover: clean(coverValues[0]),
        coverValues,
      });
      // Normal chart nodes also contain preview songs. Their children are
      // tracks, not additional chart entities.
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(body?.data?.contents ?? body?.contents ?? body);
  return values;
};

const miguChartCoverCache = new Map<string, unknown[]>();
let miguCoverCacheGeneration = 0;
const miguChartCoverRequests = new Map<string, Promise<unknown[]>>();

export function clearMiguChartCoverCache() {
  miguCoverCacheGeneration += 1;
  miguChartCoverCache.clear();
}

/**
 * The Migu rank-index catalog is occasionally unavailable even though the
 * verified chart detail endpoint is healthy. Fetch artwork for every real
 * chart identity returned by the catalog (and every verified fallback chart),
 * rather than only the two Home-highlighted identities.
 */
const loadMiguChartCoverValues = (id: string): Promise<unknown[]> => {
  const cached = miguChartCoverCache.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = miguChartCoverRequests.get(id);
  if (pending) return pending;
  const generation = miguCoverCacheGeneration;
  const request = (async () => {
    try {
      const body = await json(
        `https://app.c.nf.migu.cn/MIGUM3.0/column/rank/h5/v1.0?columnId=${encodeURIComponent(
          id,
        )}`,
        { headers: headers('https://m.music.migu.cn/') },
      );
      const column = body.data?.columnInfo ?? body.columnInfo ?? {};
      const values: unknown[] = [
        column.columnPicUrl,
        column.columnSmallpicUrl,
        column.customizedPicUrls,
        column.recommendPicUrl,
      ].filter(Boolean);
      if (values.length && generation === miguCoverCacheGeneration) miguChartCoverCache.set(id, values);
      return values;
    } catch {
      return [];
    }
  })();
  miguChartCoverRequests.set(id, request);
  return request.finally(() => miguChartCoverRequests.delete(id));
};

const enrichMiguVerifiedChartCovers = async (
  values: ChartCatalogValue[],
): Promise<ChartCatalogValue[]> => {
  const next = values.map(value => ({ ...value }));
  const verified = [...values];
  for (const chart of miguCatalogCharts) {
    if (!verified.some(value => value.id === chart.id))
      verified.push({ ...chart });
  }
  await Promise.all(
    verified.map(async chart => {
      let value = next.find(candidate => candidate.id === chart.id);
      if (!value) {
        value = { ...chart };
        next.push(value);
      }
      if (value.cover || value.coverValues?.length) return;
      const coverValues = await loadMiguChartCoverValues(chart.id);
      if (coverValues.length) {
        value.coverValues = coverValues;
        value.cover = clean(coverValues[0]);
      }
    }),
  );
  return next;
};

type NewReleaseType = 'album' | 'single';

const releaseArtist = (value: any) =>
  clean(
    value.artist?.name ??
      value.artist ??
      value.artistName ??
      value.author_name ??
      value.authorName ??
      value.singerName ??
      value.singername ??
      value.singer ??
      (Array.isArray(value.artists)
        ? value.artists.map((artist: any) => artist?.name ?? artist).join(' / ')
        : ''),
  );

const releaseAlbumId = (value: any) =>
  clean(
    value.albumId ??
      value.album_id ??
      value.albumid ??
      value.albumMid ??
      value.albummid ??
      value.album?.id ??
      value.album?.albumId ??
      value.album?.mid,
  );

const releaseTrackId = (value: any) =>
  clean(
    value.songId ??
      value.song_id ??
      value.contentId ??
      value.content_id ??
      value.copyrightId ??
      value.copyright_id ??
      value.songmid ??
      value.songMid,
  );

const releaseCoverValues = (value: any) => [
  value.cover,
  value.coverUrl,
  value.cover_url,
  value.sizable_cover,
  value.imageUrl,
  value.image,
  value.img,
  value.imgurl,
  value.pic,
  value.picUrl,
  value.pic_url,
  value.album_img,
  value.albumImg,
  value.album?.picUrl,
  value.album?.img,
  value.album?.cover,
];

const releaseItem = (
  provider: OnlineProvider,
  value: any,
  releaseType: NewReleaseType,
): CatalogItem | null => {
  const albumId = releaseAlbumId(value);
  const trackId = releaseTrackId(value);
  const id = clean(
    releaseType === 'single'
      ? trackId || value.id
      : albumId || value.id,
  );
  const title = clean(
    releaseType === 'single'
      ? value.songName ?? value.song_name ?? value.songname ?? value.name ?? value.title
      : value.albumName ??
          value.album_name ??
          value.albumname ??
          value.album?.name ??
          value.album?.title ??
          value.name ??
          value.title,
  );
  if (!id || !title) return null;
  const artist = releaseArtist(value);
  const coverValues = releaseCoverValues(value);
  const releaseDate = clean(
    value.releaseDate ??
      value.release_date ??
      value.publishDate ??
      value.publish_date ??
      value.publicTime ??
      value.public_time,
  );
  const normalized = item(
    provider,
    'new-albums',
    id,
    title,
    artist ? `${artist} · 新近发行` : '新近发行',
    coverValues[0],
    coverValues.slice(1),
  );
  const releaseTrack =
    releaseType === 'single' ? normalizeMiguTrack(value) : undefined;
  return {
    ...normalized,
    artist: artist || undefined,
    releaseDate: releaseDate || undefined,
    metadata: {
      ...(normalized.metadata ?? {}),
      sourceEntity: 'new-release',
      releaseType,
      albumId: albumId || undefined,
      trackId: trackId || undefined,
      releaseDate: releaseDate || undefined,
      releaseTrack,
    },
  };
};

const arrayAt = (value: any, paths: string[][]): any[] => {
  for (const path of paths) {
    let current = value;
    for (const key of path) current = current?.[key];
    if (Array.isArray(current)) return current;
  }
  return Array.isArray(value) ? value : [];
};

const flattenMiguReleaseRows = (value: unknown): any[] => {
  if (Array.isArray(value)) return value.flatMap(flattenMiguReleaseRows);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, any>;
  const trackId = releaseTrackId(row);
  const title = clean(
    row.songName ?? row.song_name ?? row.songname ?? row.name ?? row.title,
  );
  if (
    trackId &&
    title &&
    (row.songId || row.songName || row.contentId || row.copyrightId)
  )
    return [row];
  return Object.values(row).flatMap(flattenMiguReleaseRows);
};

/** Normalize provider-native new-release entities without deriving albums from charts. */
export const normalizeNewReleaseItems = (
  provider: OnlineProvider,
  body: any,
): CatalogItem[] => {
  const values =
    provider === 'migu'
      ? flattenMiguReleaseRows(body)
      : arrayAt(body, [
          ['albums'],
          ['data', 'albums'],
          ['data', 'albumList'],
          ['data', 'albumlist'],
          ['data', 'list'],
          ['data', 'info'],
          ['data', 'data'],
          ['data', 'album'],
          ['data'],
          ['albumlib', 'data', 'albumList'],
          ['albumlib', 'data', 'list'],
          ['albumlib', 'data', 'albums'],
          ['albumlib', 'data', 'v_album'],
          ['result', 'albums'],
          ['albumlist'],
          ['albumList'],
          ['rows'],
        ]);
  const seen = new Set<string>();
  return values
    .map(value => releaseItem(provider, value, provider === 'migu' ? 'single' : 'album'))
    .filter((value): value is CatalogItem => {
      if (!value) return false;
      const key = `${value.provider}:${value.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const getNewReleaseCatalog = async (
  provider: OnlineProvider,
  page = 1,
): Promise<CatalogItem[]> => {
  if (provider === 'qishui') throw new Error('汽水暂无可验证的新碟目录接口');
  const current = Math.max(1, Math.floor(page));
  let body: any;
  if (provider === 'netease') {
    body = await json(
      `https://music.163.com/api/album/new?area=ALL&offset=${
        (current - 1) * 20
      }&total=true&limit=20`,
      { headers: headers('https://music.163.com/') },
    );
  } else if (provider === 'qq') {
    body = await json(
      `https://c.y.qq.com/v8/fcg-bin/album_library?g_tk=5381&hostUin=0&format=json&inCharset=utf8&outCharset=utf8&notice=0&platform=yqq&needNewCode=0&cmd=firstpage&page=${
        current - 1
      }&pagesize=20&sort=1&language=-1&genre=0&year=1&pay=0&type=-1&company=-1`,
      { headers: headers('https://y.qq.com/') },
    );
  } else if (provider === 'kugou') {
    body = await json(
      `http://service.mobile.kugou.com/v1/yueku/recommend?plat=0&type=8&operator=2&version=8352&page=${current}&pagesize=20`,
      { headers: headers('http://www.kugou.com/') },
    );
  } else if (provider === 'kuwo') {
    body = await json(
      `http://wapi.kuwo.cn/openapi/v1/pc/disc/shelves?pn=${current}&rn=20`,
      { headers: headers('http://www.kuwo.cn/') },
    );
  } else {
    // Migu labels this column “新歌首发”; it is the platform's equivalent of
    // the new-release rail and contains songs, not album entities. Keep it
    // separate from the “新碟上架” album column and chart columns: falling
    // back to either would recreate the old song-as-album bug.
    body = await json(
      `https://c.musicapp.migu.cn/MIGUM3.0/column/column-info/h5/v2.0?columnId=75579758`,
      { headers: headers('https://m.music.migu.cn/') },
    );
  }
  const normalized = normalizeNewReleaseItems(provider, body);
  return provider === 'migu'
    ? normalized.slice((current - 1) * 20, current * 20)
    : normalized;
};

const validPlaylist = (id: unknown, title: unknown) =>
  (typeof id !== 'number' || Number.isSafeInteger(id)) &&
  /^[1-9]\d*$/.test(clean(id)) && !!clean(title);

const playlistRows = (rows: unknown): any[] => {
  if (!Array.isArray(rows)) throw new Error('歌单目录响应不完整，请重试');
  return rows;
};

const playlistStatus = (code: unknown, success: number) => {
  if (code !== undefined && Number(code) !== success)
    throw new Error(`歌单目录接口 ${clean(code)}`);
};

function playlistPage(
  items: CatalogItem[], page: number, size: number, total?: unknown, more?: unknown,
): PlaylistCatalogPage {
  const count = total === undefined || total === null ? NaN : Number(total);
  const hasTotal = Number.isFinite(count) && count >= 0;
  const outOfRange = page > 1 && hasTotal && (page - 1) * size >= count;
  if (!items.length && !outOfRange &&
      ((hasTotal && count > (page - 1) * size) || more === true || more === 1 || more === '1'))
    throw new Error('歌单目录尚有内容但本页为空，请重试');
  const hasMore = items.length > 0 && !outOfRange && more !== false && more !== 0 &&
    more !== '0' && (!hasTotal || page * size < count);
  return { items, nextPage: hasMore ? page + 1 : null, outOfRange };
}

/** Real directory continuation facts, independent from the twenty-card UI batch. */
export async function getPlaylistCatalogPage(
  provider: OnlineProvider,
  page = 1,
  options: CatalogRequestOptions = {},
): Promise<PlaylistCatalogPage> {
  const current = Math.max(1, Math.floor(page));
  const request = (url: string, init: RequestInit = {}) => json(url, init, options.requestContext);
  switch (provider) {
    case 'qishui': return options.requestContext ? getQishuiPlaylistPage(current, { requestContext: options.requestContext }) : getQishuiPlaylistPage(current);
    case 'netease': {
      const body = await request(
        `https://music.163.com/api/playlist/list?cat=%E5%85%A8%E9%83%A8&order=hot&offset=${(current - 1) * 24}&total=true&limit=24`,
        { headers: headers('https://music.163.com/') },
      );
      playlistStatus(body?.code, 200);
      const values = playlistRows(body?.playlists).filter(value => validPlaylist(value?.id, value?.name));
      return playlistPage(values.map(value => item(provider, 'playlists', value.id,
        value.name, value.description ?? value.tags?.join(' · ') ?? '热门歌单', value.coverImgUrl)),
        current, 24, body.total, body.more);
    }
    case 'qq': {
      const limit = 36;
      const data = {
        comm: { cv: 1602, ct: 20 },
        playlist: { method: 'get_playlist_by_tag',
          param: { id: 10000000, sin: limit * (current - 1), size: limit, order: 5, cur_page: current },
          module: 'playlist.PlayListPlazaServer' },
      };
      const body = await request(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&platform=wk_v15.json&data=${encodeURIComponent(JSON.stringify(data))}`,
        { headers: headers('https://y.qq.com/') },
      );
      playlistStatus(body?.code, 0);
      playlistStatus(body?.playlist?.code, 0);
      const values = playlistRows(body?.playlist?.data?.v_playlist)
        .filter(value => validPlaylist(value?.tid, value?.title));
      return playlistPage(values.map(value => item(provider, 'playlists', value.tid,
        value.title, value.desc ?? value.creator_info?.nick, value.cover_url_medium ?? value.cover_url_small)),
        current, limit, body.playlist.data.total);
    }
    case 'kugou': {
      const body = await request(
        options.paginateKugouAllPlaylists
          ? `https://m.kugou.com/plist/index&json=true&page=${current}`
          : 'http://m.kugou.com/plist/index&json=true',
        { headers: headers('http://m.kugou.com/') },
      );
      playlistStatus(body?.status, 1);
      const values = playlistRows(body?.plist?.list?.info)
        .filter(value => validPlaylist(value?.specialid, value?.specialname));
      return playlistPage(values.map(value => item(provider, 'playlists', value.specialid,
        value.specialname, value.intro ?? value.nickname, clean(value.imgurl ?? value.img).replace('{size}', '400'))),
        options.paginateKugouAllPlaylists ? current : 1, 30, body.plist.list.total, body.plist.list.has_next);
    }
    case 'kuwo': {
      const body = await request(
        `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${current}&rn=30&order=hot`,
        { headers: headers('http://www.kuwo.cn/') },
      );
      playlistStatus(body?.code, 200);
      const values = playlistRows(body?.data?.data).filter(value => validPlaylist(value?.id, value?.name));
      if (body.data.pn !== undefined && Number(body.data.pn) !== current)
        throw new Error('库沃歌单目录页码不一致，请重试');
      return playlistPage(values.map(value => item(provider, 'playlists', value.id,
        value.name, value.desc ?? value.tags, value.img, [value.image, value.imageUrl, value.pic, value.picUrl])),
        current, 30, body.data.total);
    }
    case 'migu': {
      const body = await request(
        `https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${current}`,
        { headers: headers('https://m.music.migu.cn/') },
      );
      playlistStatus(body?.code, 0);
      playlistRows(body?.data?.contents);
      const result: CatalogItem[] = [];
      const seen = new Set<string>();
      const visit = (value: any) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (String(value.resType) === '2021' && validPlaylist(value.resId, value.txt)) {
          const id = String(value.resId);
          if (!seen.has(id)) {
            seen.add(id);
            result.push(item(provider, 'playlists', id, value.txt, value.txt2, value.img,
              [value.image, value.imageUrl, value.pic, value.picUrl, value.imgItem]));
          }
        }
        Object.values(value).forEach(visit);
      };
      visit(body.data.contents);
      // The plaza currently advertises nextPageNo=1 for every requested page.
      // Drain its complete response locally; never invent pageNo+1 requests.
      const next = Number(body.data.header?.nextPageNo);
      return { items: result, nextPage: result.length && Number.isSafeInteger(next) && next > current ? next : null, outOfRange: false };
    }
  }
}

export async function getFeaturedPlaylists(
  provider: OnlineProvider,
  page = 1,
  category = '全部',
  options: CatalogRequestOptions = {},
): Promise<CatalogItem[]> {
  const current = Math.max(1, Math.floor(page));
  if (category === '全部') return (await getPlaylistCatalogPage(provider, current, options)).items;
  switch (provider) {
    case 'qishui': return getQishuiPlaylists(current, category);
    case 'netease': {
      const body = await json(
        `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(
          category || '全部',
        )}&order=hot&offset=${(current - 1) * 24}&total=true&limit=24`,
        { headers: headers('https://music.163.com/') },
      );
      return (body.playlists ?? []).map((value: any) =>
        item(
          provider,
          'playlists',
          value.id,
          value.name,
          value.description ?? value.tags?.join(' · ') ?? '热门歌单',
          value.coverImgUrl,
        ),
      );
    }
    case 'qq': {
      if (category !== '全部') {
        if (category === '80后' || category === '90后' || category === '00后')
          return getQqCategorySearchPlaylists(category, current);
        const categoryId = playlistCategoryIds.qq[category];
        if (typeof categoryId !== 'string')
          throw new Error(`秋秋音乐暂不支持“${category}”歌单分类`);
        const body = await jsonText(
          `https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?format=json&inCharset=utf8&outCharset=utf-8&platform=yqq&hostUin=0&loginUin=0&needNewCode=0&sortId=5&categoryId=${encodeURIComponent(categoryId)}&sin=${(current - 1) * 30}&ein=${current * 30 - 1}`,
          { headers: headers('https://y.qq.com/') },
        );
        return (body.data?.list ?? []).map((value: any) =>
          item(
            provider,
            'playlists',
            value.dissid ?? value.tid,
            value.dissname ?? value.title,
            value.intro ?? value.desc ?? value.creator?.nick,
            value.imgurl ?? value.logo ?? value.cover_url_medium,
          ),
        );
      }
      break;
    }
    case 'kugou': {
      if (category !== '全部') {
        const tag = playlistCategoryIds.kugou[category];
        if (!tag || typeof tag === 'string')
          throw new Error(`裤勾音乐暂不支持“${category}”歌单分类`);
        const body = await jsonText(
          `http://mobilecdnbj.kugou.com/api/v3/tag/specialList?plat=0&page=${current}&tagid=${tag.tagid}&pagesize=30&ugc=1&id=${tag.parentId}&sort=2`,
          { headers: headers('http://m.kugou.com/') },
        );
        const rows = body.data?.info ?? [];
        if (!rows.length) throw new Error(`裤勾音乐“${category}”暂无歌单`);
        return rows.map((value: any) =>
          item(
            provider,
            'playlists',
            value.specialid,
            value.specialname,
            value.intro ?? value.nickname,
            clean(value.imgurl ?? value.img).replace('{size}', '400'),
          ),
        );
      }
      break;
    }
    case 'kuwo': {
      if (category !== '全部') {
        const categoryId = playlistCategoryIds.kuwo[category];
        if (typeof categoryId !== 'string')
          throw new Error(`库沃音乐暂不支持“${category}”歌单分类`);
        const body = await jsonText(
          `http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?loginUid=0&loginSid=0&appUid=76039576&id=${encodeURIComponent(categoryId)}&pn=${current}&rn=30&order=hot`,
          { headers: headers('http://www.kuwo.cn/') },
        );
        const rows = body.data?.data ?? [];
        if (!rows.length) throw new Error(`库沃音乐“${category}”暂无歌单`);
        return rows.map((value: any) =>
          item(
            provider,
            'playlists',
            value.id,
            value.name,
            value.desc ?? value.info,
            value.img,
            [value.image, value.imageUrl, value.pic, value.picUrl],
          ),
        );
      }
      break;
    }
    case 'migu': return getMiguCategoryPlaylists(category, current);
  }
  throw new Error('不支持的歌单分类');
}

export async function getCatalog(
  provider: OnlineProvider,
  kind: CatalogKind,
  page = 1,
  category = '全部',
  options: CatalogRequestOptions = {},
): Promise<CatalogItem[]> {
  if (kind === 'playlists')
    return getFeaturedPlaylists(provider, page, category, options);
  if (kind === 'new-songs') {
    const detail = await getCollection(
      provider,
      'charts',
      newSongChart(provider),
    );
    return detail.tracks.map(track => ({
      id: track.providerId ?? track.id,
      title: track.title,
      description: track.artist,
      cover: track.cover,
      coverCandidates: trackCoverCandidates(track),
      provider,
      kind,
      artist: track.artist,
    }));
  }
  if (kind === 'new-albums') {
    return getNewReleaseCatalog(provider, page);
  }
  return getCharts(provider);
}

async function getCharts(provider: OnlineProvider): Promise<CatalogItem[]> {
  if (provider === 'qishui') return qishuiCharts.map(chart => item(provider, 'charts', chart.id, chart.title, '', ''));
  try {
    let values: ChartCatalogValue[] = [];
    if (provider === 'netease') {
      const body = await json('https://music.163.com/api/toplist', {
        headers: headers('https://music.163.com/'),
      });
      values = (body.list ?? []).map((value: any) => ({
        id: clean(value.id),
        title: clean(value.name),
        cover: clean(value.coverImgUrl),
      }));
    } else if (provider === 'kugou') {
      const body = await json(
        'http://mobilecdnbj.kugou.com/api/v3/rank/list?version=9108&plat=0&withsong=1',
        { headers: headers('http://m.kugou.com/') },
      );
      values = (body.data?.info ?? []).map((value: any) => ({
        id: clean(value.rankid ?? value.id),
        title: clean(value.rankname ?? value.name),
        cover: clean(value.imgurl ?? value.banner7url ?? value.img).replace(
          '{size}',
          '400',
        ),
      }));
    } else if (provider === 'kuwo') {
      const body = await json('https://wapi.kuwo.cn/api/pc/bang/list', {
        headers: headers('https://www.kuwo.cn/'),
      });
      const seen = new Set<string>();
      const visit = (value: any) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const id = clean(value.sourceid);
        const title = clean(value.name ?? value.title);
        const coverValues = [value.pic, value.pic2, value.pic5].filter(
          value => clean(value),
        );
        if (id && title && !seen.has(id)) {
          seen.add(id);
          values.push({
            id,
            title,
            cover: clean(coverValues[0]),
            coverValues,
          });
        }
        visit(value.child ?? value.list ?? value.children ?? value.data);
      };
      visit(body);
    } else if (provider === 'migu') {
      const body = await json(
        'https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0',
        { headers: headers('https://m.music.migu.cn/') },
      );
      // The web rank-index response is authoritative for all published
      // special and normal charts. The share-page rising chart is a real
      // additional column that is not currently included in that response,
      // so keep it first without replacing any live chart.
      const liveValues = extractMiguRankIndexCharts(body);
      const liveRising = liveValues.find(
        value => value.id === miguRisingChart.id,
      );
      values = [
        liveRising ?? { ...miguRisingChart },
        ...liveValues.filter(value => value.id !== miguRisingChart.id),
      ];
      values = await enrichMiguVerifiedChartCovers(values);
    } else {
      const payload = {
        toplist: {
          module: 'musicToplist.ToplistInfoServer',
          method: 'GetAll',
          param: {},
        },
        comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
      };
      const body = await json('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          ...headers('https://y.qq.com/'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      values = (body.toplist?.data?.group ?? []).flatMap((group: any) =>
        (group.toplist ?? []).map((value: any) => ({
          id: clean(value.topId ?? value.id),
          title: clean(value.title ?? value.name),
          cover: clean(value.frontPicUrl ?? value.headPicUrl),
        })),
      );
    }
    if (values.length)
      return values
        .filter(value => value.id && value.title)
        .map(value =>
          item(
            provider,
            'charts',
            value.id,
            value.title,
            `${value.title} · 实时更新`,
            value.cover,
            value.coverValues,
          ),
        );
  } catch {}
  const fallbackValues: ChartCatalogValue[] =
    provider === 'migu'
      ? await enrichMiguVerifiedChartCovers(
          defaultCharts[provider].map(value => ({ ...value })),
        )
      : defaultCharts[provider];
  return fallbackValues.map(value =>
    item(
      provider,
      'charts',
      value.id,
      value.title,
      `${value.title} · 实时更新`,
      value.cover,
      value.coverValues,
    ),
  );
}

export async function getCollection(
  provider: OnlineProvider,
  kind: 'playlists' | 'charts' | 'new-albums',
  id: string,
  scenePage?: { offset: number; size: number; requestContext?: CatalogRequestBudget },
): Promise<CatalogDetail & { hasMore?: boolean }> {
  if (provider === 'qishui') return getQishuiCollection(kind, id, scenePage?.offset ?? 0, scenePage?.size ?? 20,
    { requestContext: scenePage?.requestContext });
  if (kind === 'new-albums') return getAlbum(provider, id);
  if (provider === 'netease') {
    const body = await json(
      `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(
        id,
      )}&n=1000&s=8`,
      { headers: headers('https://music.163.com/') },
    );
    const playlist = body.playlist ?? body.result ?? {};
    const tracks = (playlist.tracks ?? []).map(normalizeNeteaseTrack);
    return detail(
      provider,
      kind,
      id,
      playlist.name,
      playlist.description,
      playlist.coverImgUrl,
      tracks,
    );
  }
  if (provider === 'qq') {
    if (kind === 'charts') return getQqChart(id);
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0)
      throw new Error('秋秋 歌单 ID 无效');
    const body = await json('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: {
        ...headers('https://y.qq.com/'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comm: { ct: 24, cv: 0 },
        diss: {
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: {
            disstid: numericId,
            dirid: 0,
            song_begin: scenePage?.offset ?? 0,
            song_num: scenePage?.size ?? 1000,
            tag: true,
            userinfo: true,
            orderlist: true,
          },
        },
      }),
    }, scenePage?.requestContext);
    const data = body.diss?.data ?? body.data ?? {};
    if (body.diss?.code && body.diss.code !== 0)
      throw new Error(`秋秋 歌单接口错误 ${body.diss.code}`);
    const playlist = data.dirinfo ?? data.playlist ?? {};
    const tracks = (data.songlist ?? data.songList ?? []).map((value: any) =>
      normalizeQqTrack(value.data ?? value),
    );
    if (!tracks.length && !playlist.title && !playlist.dissname)
      throw new Error('秋秋 歌单详情暂无可用数据');
    const total = Number(playlist.songnum ?? data.songnum ?? data.total_song_num);
    return {
      ...detail(
        provider,
        kind,
        id,
        playlist.title ?? playlist.dissname ?? playlist.name,
        playlist.desc ?? playlist.description,
        playlist.picurl ?? playlist.logo ?? playlist.cover_url_medium,
        tracks,
      ),
      ...(scenePage ? { hasMore: Number.isFinite(total)
        ? scenePage.offset + scenePage.size < total
        : tracks.length === scenePage.size } : {}),
    };
  }
  if (provider === 'kugou') {
    const url =
      kind === 'charts'
        ? `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=100&area_code=1&page=1&rankid=${encodeURIComponent(
            id,
          )}&with_res_tag=0`
        : `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(
            id,
          )}&page=1&pagesize=200`;
    const body = await json(url, { headers: headers('http://m.kugou.com/') });
    const values = body.data?.info ?? [];
    return detail(
      provider,
      kind,
      id,
      body.data?.rankname ??
        (kind === 'charts' ? '裤勾排行榜' : '裤勾在线歌单'),
      '',
      '',
      values.map(normalizeKugouTrack),
    );
  }
  if (provider === 'kuwo') {
    const url =
      kind === 'charts'
        ? `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=0&rn=100&type=bang&data=content&id=${encodeURIComponent(
            id,
          )}&show_copyright_off=0&pcmp4=1&isbang=1`
        : `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encodeURIComponent(
            id,
          )}&pn=0&rn=1000&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
    const body = await json(url, { headers: headers('http://www.kuwo.cn/') });
    const values = body.musiclist ?? body.musicList ?? [];
    return detail(
      provider,
      kind,
      id,
      body.name ??
        body.title ??
        (kind === 'charts' ? '库沃排行榜' : '库沃在线歌单'),
      body.info,
      body.pic,
      values.map(normalizeKuwoTrack),
    );
  }
  if (kind === 'charts') {
    const body = await json(
      `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${encodeURIComponent(
        id,
      )}&needAll=0`,
      { headers: headers('https://m.music.migu.cn/') },
    );
    const columnInfo = body.columnInfo ?? body.data?.columnInfo ?? {};
    const values = extractMiguChartRows(body);
    return detail(
      provider,
      kind,
      id,
      columnInfo.title ?? columnInfo.name ?? columnInfo.columnTitle ?? '迷谷排行榜',
      '',
      columnInfo.columnPicUrl ??
        columnInfo.columnSmallpicUrl ??
        columnInfo.customizedPicUrls ??
        columnInfo.recommendPicUrl ??
        columnInfo.picUrl ??
        columnInfo.img ??
        columnInfo.image ??
        '',
      values.map(normalizeMiguTrack),
    );
  }
  const [songsResult, infoResult] = await Promise.allSettled([
    json(
      `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=1&pageSize=100&playlistId=${encodeURIComponent(
        id,
      )}`,
      { headers: headers('https://m.music.migu.cn/') },
    ),
    json(
      `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${encodeURIComponent(
        id,
      )}`,
      { headers: headers('https://m.music.migu.cn/') },
    ),
  ]);
  const songs = songsResult.status === 'fulfilled' ? songsResult.value : null;
  const info = infoResult.status === 'fulfilled' ? infoResult.value : null;
  const songList = songs?.data?.songList ?? songs?.data?.list ?? [];
  if (!songList.length && !info) throw new Error('迷谷歌单详情接口暂不可用');
  const metadata = info?.data ?? {};
  return detail(
    provider,
    kind,
    id,
    metadata.title ?? '迷谷在线歌单',
    metadata.summary,
    metadata.imgItem?.img,
    songList.map(normalizeMiguTrack),
  );
}

async function getQqChart(id: string): Promise<CatalogDetail> {
  const body = await jsonText(
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${encodeURIComponent(
      id,
    )}&page=detail&type=top&song_begin=0&song_num=100&format=json&inCharset=utf8&outCharset=utf-8`,
    { headers: headers('https://y.qq.com/') },
  );
  const data = body;
  return detail(
    'qq',
    'charts',
    id,
    data.topinfo?.ListName ?? data.title ?? '秋秋音乐排行榜',
    data.topinfo?.info ?? data.info,
    data.topinfo?.pic_v12 ?? data.frontPicUrl,
    (data.songlist ?? data.songInfoList ?? []).map((value: any) =>
      normalizeQqTrack(value.data ?? value),
    ),
  );
}

async function getAlbum(
  provider: OnlineProvider,
  id: string,
): Promise<CatalogDetail> {
  if (provider === 'netease') {
    const body = await json(
      `https://music.163.com/api/v1/album/${encodeURIComponent(id)}`,
      { headers: headers('https://music.163.com/') },
    );
    const album = body.album ?? {};
    return detail(
      provider,
      'new-albums',
      id,
      album.name,
      album.description,
      album.picUrl,
      (body.songs ?? []).map(normalizeNeteaseTrack),
    );
  }
  if (provider === 'qq') {
    const body = await jsonText(
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?format=json&albummid=${encodeURIComponent(
        id,
      )}`,
      { headers: headers('https://y.qq.com/') },
    );
    const album = body.data ?? {};
    return detail(
      provider,
      'new-albums',
      id,
      album.name,
      album.desc,
      `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`,
      (album.list ?? []).map(normalizeQqTrack),
    );
  }
  if (provider === 'kugou') {
    const body = await json(
      `http://mobiles.kugou.com/api/v3/album/song?version=9108&albumid=${encodeURIComponent(
        id,
      )}&plat=0&pagesize=200&area_code=0&page=1&with_res_tag=0`,
      { headers: headers('http://m.kugou.com/') },
    );
    const tracks = (body.data?.info ?? body.info ?? []).map(
      normalizeKugouTrack,
    );
    return detail(provider, 'new-albums', id, tracks[0]?.album, '', '', tracks);
  }
  if (provider === 'kuwo') {
    const body = await jsonText(
      `http://search.kuwo.cn/r.s?pn=0&rn=1000&stype=albuminfo&albumid=${encodeURIComponent(
        id,
      )}&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0`,
      { headers: headers('http://www.kuwo.cn/') },
    );
    return detail(
      provider,
      'new-albums',
      id,
      body.name,
      body.info,
      body.img ?? body.hts_img,
      (body.musiclist ?? []).map(normalizeKuwoTrack),
    );
  }
  const body = await json(
    `http://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/queryAlbumSong?albumId=${encodeURIComponent(
      id,
    )}&pageNo=1`,
    { headers: headers('https://m.music.migu.cn/') },
  );
  const tracks = (body.songList ?? body.data?.songList ?? []).map(
    normalizeMiguTrack,
  );
  return detail(provider, 'new-albums', id, tracks[0]?.album, '', '', tracks);
}

const detail = (
  provider: OnlineProvider,
  kind: CatalogDetail['kind'],
  id: string,
  title: unknown,
  description: unknown,
  cover: unknown,
  tracks: Track[],
): CatalogDetail => {
  const candidates = coverCandidates(provider, cover);
  return {
    id,
    title: clean(title) || '在线内容',
    description: clean(description),
    cover: candidates[0] ?? tracks[0]?.cover,
    coverCandidates: candidates,
    provider,
    kind,
    tracks: tracks.filter(track => track.providerId && track.title),
  };
};

export const newSongChart = (provider: OnlineProvider) =>
  ({
    netease: '3779629',
    qq: '27',
    kugou: '31308',
    kuwo: '17',
    migu: '27553319',
    qishui: '7060812597884869927',
  }[provider]);

export { providerNames, sourceTypes };
