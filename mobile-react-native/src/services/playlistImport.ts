import { NativeModules } from 'react-native';
import {
  trackQueueKey,
  type PersistedState,
  type Track,
} from '../domain/types';
import { savedPlaylistReference, saveLinkedPlaylist } from './linkedPlaylist';
import { hasExternalMediaOrigin } from './mediaDiscoveryPaging';
import {
  coverCandidates,
  normalizeKugouTrack,
  normalizeKuwoTrack,
  normalizeMiguTrack,
  normalizeNeteaseTrack,
  normalizeQqTrack,
  parsePlatformJsonText,
  type OnlineProvider,
} from './onlineCatalog';
import type { PersonalPlaylistImportPreview } from './personalPlaylistShare';
import { plainPlaylistShare, sharedPlaylistMetadata } from './playlistShare';
import { getQishuiCollection } from './qishuiCatalog';
import { md5 } from './storage';
export type PlaylistReference = {
  provider: OnlineProvider;
  id: string;
};
/** Only a process-only native token and collection identity, never persisted. */
export type PlaylistClipboardReference =
  | PlaylistReference
  | {
      kind: 'personal';
      id: string;
    };
export type PlaylistClipboardSource = {
  token: string;
  reference: PlaylistClipboardReference;
};
export type PlaylistImportPreview = PlaylistReference & {
  kind?: 'platform';
  title: string;
  description: string;
  cover?: string;
  tracks: Track[];
  readCount: number;
  unavailableCount: number;
  duplicateCount: number;
  total?: number;
};
export type PlaylistImportResult =
  | PlaylistImportPreview
  | PersonalPlaylistImportPreview;
export type PlaylistImportOptions = {
  overwrite?: boolean;
};
const roots: Record<OnlineProvider, string[]> = {
  netease: ['163.com', '163cn.tv'],
  qq: ['qq.com'],
  kugou: ['kugou.com'],
  kuwo: ['kuwo.cn'],
  migu: ['migu.cn'],
  qishui: ['qishui.com', 'qishui.douyin.com', 'music.douyin.com'],
};
const aborted = () =>
  Object.assign(new Error('导入已取消'), { name: 'AbortError' });
function active(signal?: AbortSignal) {
  if (signal?.aborted) throw aborted();
}
const playlistWebLinks = (input: string) => {
  const shared = plainPlaylistShare(input);
  return shared
    ? [shared.url]
    : input.match(/https?:\/\/[^\s<>"“”，。；！？（）]+/gi) ?? [];
};
export function playlistLink(input: string) {
  const url = playlistWebLinks(input)[0]?.replace(/[，。；！）)]+$/, '');
  const host = url?.match(/^https?:\/\/([^/?#]+)/i)?.[1].toLowerCase();
  if (!url || !host || host.includes('@') || host.includes(':'))
    throw new Error('请粘贴有效的平台歌单分享链接');
  const provider = (Object.keys(roots) as OnlineProvider[]).find(key =>
    roots[key].some(root => host === root || host.endsWith('.' + root)),
  );
  if (!provider)
    throw new Error('仅支持网易、QQ、酷狗、酷我、咪咕和汽水的歌单链接');
  return { url, provider };
}
export function parsePlaylistReference(
  input: string,
): PlaylistReference | null {
  const { url, provider } = playlistLink(input);
  const query = (key: string) =>
    new RegExp('[?&#]' + key + '=([0-9]+)(?:[&#]|$)', 'i').exec(url)?.[1];
  let id: string | undefined;
  if (provider === 'netease' && /(?:playlist|songlist)/i.test(url))
    id = query('id') ?? /playlist\/([0-9]+)/i.exec(url)?.[1];
  if (provider === 'qq')
    id =
      query('disstid') ??
      query('dissid') ??
      /(?:playlist|playsquare)\/([0-9]+)/i.exec(url)?.[1] ??
      (/taoge|playlist|playsquare/i.test(url) ? query('id') : undefined);
  if (provider === 'kugou') {
    const globalId =
      /(?:songlist\/gcid_|[?&#]global_(?:collection_id|specialid)=)([a-z0-9_]{1,128})/i.exec(
        url,
      )?.[1];
    id = globalId
      ? `gcid_${globalId}`
      : query('specialid') ?? /special\/single\/([0-9]+)/i.exec(url)?.[1];
  }
  if (provider === 'kuwo')
    id = /playlist(?:_detail)?\/([0-9]+)/i.exec(url)?.[1] ?? query('pid');
  if (provider === 'migu')
    id =
      query('playlistId') ??
      /playlist\/([0-9]+)/i.exec(url)?.[1] ??
      (/playlist/i.test(url) ? query('id') : undefined);
  if (provider === 'qishui')
    id = query('playlist_id') ?? /playlist\/([0-9]+)/i.exec(url)?.[1];
  return id && !/^0+$/.test(id) ? { provider, id } : null;
}
function isSingleSongLink(link: ReturnType<typeof playlistLink>) {
  const path = link.url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] ?? '';
  return (
    (link.provider === 'netease' && /\/song(?:\/|$)/i.test(path)) ||
    (link.provider === 'qq' && /\/song(?:Detail|\/|\.html)/i.test(path)) ||
    (link.provider === 'kuwo' && /\/yinyue\//i.test(path)) ||
    (link.provider === 'kugou' && /\/mixsong\//i.test(path)) ||
    (link.provider === 'migu' && /\/song\//i.test(path)) ||
    (link.provider === 'qishui' &&
      /[?&]track_id=|\/(?:track|song|video)(?:\/|$)/i.test(link.url))
  );
}
/** Recognize clipboard candidates locally; ordinary text/account/song links do no I/O. */
export function playlistClipboardCandidate(input: string) {
  for (const url of playlistWebLinks(input))
    try {
      const link = playlistLink(url);
      if (isSingleSongLink(link)) continue;
      const reference = parsePlaylistReference(link.url);
      const shortShare =
        /^https?:\/\/(?:[^/]+\.)?163cn\.tv\//i.test(link.url) ||
        /^https?:\/\/t\d+\.kugou\.com\/song\.html\?/i.test(link.url) ||
        /^https?:\/\/c(?:\d+)?\.y\.qq\.com\/base\/fcgi-bin\/u\?/i.test(
          link.url,
        );
      if (!reference && !shortShare) continue;
      return {
        input:
          plainPlaylistShare(input)?.url === link.url ? input.trim() : link.url,
        key: reference ? `${reference.provider}:${reference.id}` : link.url,
        reference,
      };
    } catch {
      /* Skip unrelated links within the same share text. */
    }
  return null;
}
export async function resolvePlaylistReference(
  input: string,
  signal?: AbortSignal,
): Promise<PlaylistReference> {
  active(signal);
  const direct = parsePlaylistReference(input);
  if (direct && !(direct.provider === 'kugou' && direct.id.startsWith('gcid_')))
    return direct;
  const link = playlistLink(input);
  if (isSingleSongLink(link))
    throw new Error('这是单曲链接，请复制歌单分享链接');
  const bridge = NativeModules.LiuliuMediaLibrary;
  if (!bridge?.resolvePlaylistShare)
    throw new Error('当前设备无法展开此分享链接，请使用歌单完整链接');
  const requestId = `playlist-${Date.now()}-${++shareSequence}`;
  const cancel = () => bridge.cancelPlaylistShare?.(requestId);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await bridge.resolvePlaylistShare(link.url, requestId);
    active(signal);
    const finalLink = playlistLink(result.url);
    if (finalLink.provider !== link.provider)
      throw new Error('分享链接跳转到了其它平台');
    const expanded = parsePlaylistReference(result.url);
    if (
      expanded &&
      !(expanded.provider === 'kugou' && expanded.id.startsWith('gcid_'))
    )
      return expanded;
    const html = String(result.html ?? '');
    if (link.provider === 'kugou') {
      const globalId =
        /["']global_collection_id["']\s*:\s*["']([a-z0-9_]{1,128})["']/i.exec(
          html,
        )?.[1];
      if (globalId) return { provider: 'kugou', id: `gcid_${globalId}` };
      const specialId = /["']specialid["']\s*:\s*["']?([1-9][0-9]*)/i.exec(
        html,
      )?.[1];
      if (specialId) return { provider: 'kugou', id: specialId };
      if (/encode_gic|encode_src_gid/i.test(html))
        throw new Error(
          '此酷狗分享页只提供部分歌曲，当前无法取得完整歌单，未保存任何内容',
        );
    }
    for (const tag of html.matchAll(/<(?:meta|link)\b[^>]+>/gi)) {
      if (
        !/(?:property|name)=["']og:url["']|rel=["']canonical["']/i.test(tag[0])
      )
        continue;
      const match = /(?:content|href)=["'](https?:\/\/[^"']+)["']/i.exec(
        tag[0],
      );
      if (!match) continue;
      try {
        const candidate = parsePlaylistReference(
          match[1]!.replace(/&amp;/g, '&'),
        );
        if (candidate?.provider === link.provider) return candidate;
      } catch {
        /* Ignore unrelated artwork and navigation links. */
      }
    }
    const fields = {
      netease: 'playlistId',
      qq: 'disstid|dissid',
      kugou: 'specialid',
      kuwo: 'pid',
      migu: 'playlistId',
      qishui: 'playlist_id',
    };
    const id = new RegExp(
      '["\'](?:' + fields[link.provider] + ')["\']\\s*:\\s*["\']?([0-9]+)',
      'i',
    ).exec(html)?.[1];
    if (id && !/^0+$/.test(id)) return { provider: link.provider, id };
    throw new Error('未能识别歌单，请复制歌单完整链接，单曲或账号链接无法导入');
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
let shareSequence = 0;
async function request(
  url: string,
  referer: string,
  signal?: AbortSignal,
  body?: unknown,
) {
  active(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method: body ? 'POST' : 'GET',
      headers: {
        Referer: referer,
        'User-Agent': 'Mozilla/5.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(`歌单读取失败（HTTP ${response.status}）`);
    const text = await response.text();
    active(signal);
    return parsePlatformJsonText(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
const count = (...values: unknown[]) => {
  for (const value of values)
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= 0
    )
      return Number(value);
  return undefined;
};
type Page = {
  tracks: Track[];
  rawCount: number;
  total?: number;
  title?: string;
  description?: string;
  cover?: unknown;
};
async function readKugouPlaylistMetadata(
  id: string,
  signal?: AbortSignal,
): Promise<
  | {
      title?: string;
      cover?: string;
    }
  | undefined
> {
  try {
    const body = await request(
      `http://mobilecdn.kugou.com/api/v3/special/info?specialid=${encodeURIComponent(
        id,
      )}`,
      'http://m.kugou.com/',
      signal,
    );
    const info = body.data;
    if (
      Number(body.errcode ?? 0) !== 0 ||
      Number(body.status ?? 1) !== 1 ||
      String(info?.specialid) !== id
    )
      return undefined;
    return {
      title:
        typeof info.specialname === 'string'
          ? info.specialname.trim() || undefined
          : undefined,
      cover: coverCandidates('kugou', info.imgurl)[0],
    };
  } catch {
    active(signal);
    return undefined;
  }
}
/** Bounded metadata/first-page reader; full song records are never persisted by import. */
export async function previewPlaylistImport(
  input: string,
  signal?: AbortSignal,
  progress?: (read: number, total?: number) => void,
): Promise<PlaylistImportPreview> {
  const reference = await resolvePlaylistReference(input, signal);
  const shared = sharedPlaylistMetadata(input, reference);
  const [batch, metadata] = await Promise.all([
    readPlaylistReferencePage(reference, 0, 20, signal),
    reference.provider === 'kugou' && /^[0-9]+$/.test(reference.id)
      ? readKugouPlaylistMetadata(reference.id, signal)
      : undefined,
  ]);
  active(signal);
  const tracks: Track[] = [];
  const seen = new Set<string>();
  let unavailableCount = batch.rawCount - batch.tracks.length,
    duplicateCount = 0;
  for (const track of batch.tracks.slice(0, 20)) {
    if (
      !track.providerId ||
      !track.title ||
      track.provider !== reference.provider ||
      hasExternalMediaOrigin(track)
    ) {
      unavailableCount++;
      continue;
    }
    const key = trackQueueKey(track);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    tracks.push(track);
  }
  if (!tracks.length)
    throw new Error('歌单没有可读取的歌曲，可能为空、私密或需要登录');
  progress?.(batch.rawCount, batch.total);
  return {
    ...reference,
    title:
      metadata?.title ??
      (String(batch.title ?? '').trim() || shared.title || '平台歌单'),
    description: String(batch.description ?? ''),
    cover:
      metadata?.cover ??
      coverCandidates(reference.provider, batch.cover)[0] ??
      shared.cover,
    tracks,
    total: batch.total,
    readCount: batch.rawCount,
    unavailableCount,
    duplicateCount,
  };
}
export async function readPlaylistReferencePage(
  reference: PlaylistReference,
  offset: number,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<Page> {
  active(signal);
  const { provider, id } = reference;
  const encoded = encodeURIComponent(id);
  const size = pageSize;
  let neteaseIndex: any;
  let miguInfo: any;
  let kugouInfo: any;
  const kgRequest = async (
    endpoint: string,
    params: string,
    platform: 'android' | 'web',
  ) => {
    const key =
      platform === 'web'
        ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
        : 'OIlwieks28dk2k092lksi2UIkp';
    const signature = await md5(key + params.split('&').sort().join('') + key);
    const body = await request(
      `${endpoint}?${params}&signature=${signature}`,
      'https://m3ws.kugou.com/',
      signal,
    );
    if (Number(body.error_code ?? body.errcode ?? body.err_code ?? 0) !== 0)
      throw new Error('酷狗歌单接口暂不可用');
    return body.data ?? (Array.isArray(body.info) ? body : body.info) ?? {};
  };
  const readPage = async (page: number, offset: number): Promise<Page> => {
    if (provider === 'qishui') {
      const detail = await getQishuiCollection('playlists', id, offset, size, {
        signal,
      });
      return {
        tracks: detail.tracks,
        rawCount: detail.rawCount,
        total: detail.trackCount,
        title: detail.title,
        description: detail.description,
        cover: detail.cover,
      };
    }
    if (provider === 'netease') {
      if (!neteaseIndex) {
        const body = await request(
          `https://music.163.com/api/v6/playlist/detail?id=${encoded}&n=0&s=0`,
          'https://music.163.com/',
          signal,
        );
        if (body.code !== 200)
          throw new Error('网易歌单不可访问，可能为私密歌单或需要登录');
        neteaseIndex = body.playlist ?? body.result;
        if (!Array.isArray(neteaseIndex?.trackIds))
          throw new Error('网易歌单索引不完整');
        if (
          count(neteaseIndex.trackCount) !== undefined &&
          count(neteaseIndex.trackCount) !== neteaseIndex.trackIds.length
        )
          throw new Error('网易未返回完整歌单索引，不能完整导入');
      }
      const ids = neteaseIndex.trackIds
        .slice(offset, offset + size)
        .map((value: any) => String(value.id));
      const body = ids.length
        ? await request(
            `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(
              JSON.stringify(ids.map((value: string) => ({ id: value }))),
            )}`,
            'https://music.163.com/',
            signal,
          )
        : { songs: [] };
      if (
        !Array.isArray(body.songs) ||
        (body.code !== undefined && body.code !== 200)
      )
        throw new Error('网易歌曲详情读取失败');
      const tracks = new Map<string, Track>(
        body.songs.map((song: any) => {
          const track = normalizeNeteaseTrack(song);
          return [String(track.providerId), track];
        }),
      );
      return {
        tracks: ids.flatMap((key: string) => tracks.get(key) ?? []),
        rawCount: ids.length,
        total: neteaseIndex.trackIds.length,
        title: neteaseIndex.name,
        description: neteaseIndex.description,
        cover: neteaseIndex.coverImgUrl,
      };
    }
    if (provider === 'qq') {
      if (!Number.isSafeInteger(Number(id))) throw new Error('QQ 歌单 ID 无效');
      const body = await request(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        'https://y.qq.com/',
        signal,
        {
          comm: { ct: 24, cv: 0 },
          diss: {
            module: 'music.srfDissInfo.DissInfo',
            method: 'CgiGetDiss',
            param: {
              disstid: Number(id),
              dirid: 0,
              song_begin: offset,
              song_num: size,
              tag: true,
              userinfo: true,
              orderlist: true,
            },
          },
        },
      );
      if (
        (body.code && body.code !== 0) ||
        (body.diss?.code && body.diss.code !== 0)
      )
        throw new Error('QQ 歌单不可访问，可能为私密歌单或需要登录');
      const data = body.diss?.data ?? body.data ?? {};
      const info = data.dirinfo ?? data.playlist ?? {};
      const rows = data.songlist ?? data.songList;
      if (!Array.isArray(rows)) throw new Error('QQ 未返回可读取的歌单');
      return {
        tracks: rows.map((row: any) => normalizeQqTrack(row.data ?? row)),
        rawCount: rows.length,
        total: count(info.songnum, data.songnum, data.total_song_num),
        title: info.title ?? info.dissname ?? info.name,
        description: info.desc ?? info.description,
        cover: info.picurl ?? info.logo ?? info.cover_url_medium,
      };
    }
    if (provider === 'kugou') {
      if (id.startsWith('gcid_')) {
        const globalId = encodeURIComponent(id.slice(5));
        if (!kugouInfo)
          kugouInfo = await kgRequest(
            'https://mobiles.kugou.com/api/v5/special/info_v2',
            `appid=1058&specialid=0&global_specialid=${globalId}&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-`,
            'web',
          );
        const data = await kgRequest(
          'http://pubsongs.kugou.com/v2/get_other_list_file',
          `need_sort=1&module=CloudMusic&clientver=11589&pagesize=${size}&global_collection_id=${globalId}&userid=0&page=${
            page + 1
          }&type=0&area_code=1&appid=1005`,
          'android',
        );
        if (!Array.isArray(data.info))
          throw new Error('酷狗未返回可读取的歌单');
        return {
          tracks: data.info.map((row: any) =>
            normalizeKugouTrack({
              ...row,
              duration: row.duration ?? Number(row.timelen) / 1000,
              filename: row.filename ?? row.name,
            }),
          ),
          rawCount: data.info.length,
          total: count(kugouInfo.songcount, data.count),
          title: kugouInfo.specialname,
          description: kugouInfo.intro,
          cover: kugouInfo.imgurl,
        };
      }
      const body = await request(
        `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encoded}&page=${
          page + 1
        }&pagesize=${size}`,
        'http://m.kugou.com/',
        signal,
      );
      const data = body.data ?? {};
      if (!Array.isArray(data.info)) throw new Error('酷狗未返回可读取的歌单');
      return {
        tracks: data.info.map(normalizeKugouTrack),
        rawCount: data.info.length,
        total: count(data.total, data.totalcount),
        description: data.intro,
      };
    }
    if (provider === 'kuwo') {
      const body = await request(
        `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encoded}&pn=${page}&rn=${size}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`,
        'http://www.kuwo.cn/',
        signal,
      );
      const rows = body.musiclist ?? body.musicList;
      if (!Array.isArray(rows)) throw new Error('酷我未返回可读取的歌单');
      return {
        tracks: rows.map(normalizeKuwoTrack),
        rawCount: rows.length,
        total: count(body.total, body.totalcount, body.musicnum),
        title: body.name ?? body.title,
        description: body.info,
        cover: body.pic,
      };
    }
    if (!miguInfo) {
      const body = await request(
        `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${encoded}`,
        'https://m.music.migu.cn/',
        signal,
      );
      miguInfo = body.data ?? {};
    }
    const body = await request(
      `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${
        page + 1
      }&pageSize=${size}&playlistId=${encoded}`,
      'https://m.music.migu.cn/',
      signal,
    );
    const data = body.data ?? {};
    const rows = data.songList ?? data.list;
    if (!Array.isArray(rows)) throw new Error('咪咕未返回可读取的歌单');
    return {
      tracks: rows.map(normalizeMiguTrack),
      rawCount: rows.length,
      total: count(
        data.totalCount,
        data.total,
        miguInfo.musicNum,
        miguInfo.songCount,
      ),
      title: miguInfo.title,
      description: miguInfo.summary,
      cover: miguInfo.imgItem?.img,
    };
  };
  const result = await readPage(Math.floor(offset / size), offset);
  active(signal);
  return result;
}
/** Stores independent imported metadata without persisting preview songs or adding favorites. */
export function commitPlaylistImport(
  state: PersistedState,
  preview: PlaylistImportPreview,
  overwrite = false,
): PersistedState {
  if (
    !overwrite &&
    preview.provider === 'kugou' &&
    /^[0-9]+$/.test(preview.id)
  ) {
    const existing = savedPlaylistReference(state, preview);
    const cover = coverCandidates('kugou', preview.cover)[0];
    if (existing && !existing.cover?.trim() && cover)
      return {
        ...state,
        importedPlaylists: (state.importedPlaylists ?? []).map(item =>
          item === existing ? { ...item, cover } : item,
        ),
      };
  }
  return saveLinkedPlaylist(
    state,
    {
      id: preview.id,
      provider: preview.provider,
      kind: 'playlists',
      title: preview.title,
      description: preview.description,
      cover: preview.cover,
      trackCount: preview.total,
    },
    overwrite,
  );
}
