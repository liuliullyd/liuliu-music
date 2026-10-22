import type { CatalogDetail, CatalogItem, Track } from '../domain/types';
import type { CatalogRequestBudget } from './catalogRequestBudget';
import { recommendationEntityMetadata } from './recommendationContentPolicy';

export const qishuiCharts = [
  { id: '7036274230471712007', title: '热歌榜' },
  { id: '7060812597884869927', title: '新歌榜' },
  { id: '7061475546400005410', title: '欧美榜' },
  { id: '7415959718721494311', title: '音乐人歌曲榜' },
] as const;

export interface QishuiRequestOptions {
  timeoutMs?: number | null;
  signal?: AbortSignal;
  requestContext?: CatalogRequestBudget;
}

const identity = (value: unknown): string => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const array = (value: any): any[] => Array.isArray(value) ? value : [];
const abortError = () => Object.assign(new Error('汽水目录请求已取消'), { name: 'AbortError' });

export function qishuiCover(value: any): string | undefined {
  for (const candidate of array(value?.urls)) {
    if (typeof candidate !== 'string' || !/^https:\/\//i.test(candidate)) continue;
    if (/\/img\/$/.test(candidate) && text(value.uri))
      return `${candidate}${value.uri}~${text(value.template_prefix) || 'tplv-b829550vbb'}-resize:500:500.png`;
    return candidate;
  }
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : undefined;
}

/** Metadata only. Audio URLs, native preparation and quality claims never enter this adapter. */
export function normalizeQishuiTrack(value: any): Track {
  const raw = value?.entity?.track_wrapper?.track ?? value?.entity?.track ?? value?.track ?? value ?? {};
  const id = identity(raw.id);
  const artists = array(raw.artists);
  const artist = artists.map(entry => text(entry.name) || text(entry.user_info?.nickname)).filter(Boolean).join(' / ');
  const album = raw.album ?? {};
  const duration = Number(raw.duration);
  const languages = array(raw.lang_codes).join(' ').toLowerCase();
  const language: Track['language'] = /yue|粤/.test(languages) ? '粤语'
    : /eng|en\b/.test(languages) ? '欧美' : /jpn|kor|ja\b|ko\b/.test(languages) ? '日韩' : '华语';
  const release = Number(album.release_date ?? raw.release_date);
  const year = release > 0 ? new Date(release < 1e12 ? release * 1000 : release).getUTCFullYear() : 0;
  return {
    id: `qishui-${id}`, provider: 'qishui', providerId: id,
    title: text(raw.name), artist, album: text(album.name),
    duration: Number.isFinite(duration) && duration > 0 ? duration / 1000 : 0,
    cover: qishuiCover(album.url_cover), coverKey: 'vinyl', language,
    genre: '流行', mood: '发现', releaseYear: Number.isFinite(year) ? year : 0,
    metadata: { ...raw, id, songmid: id, artistId: identity(artists[0]?.id ?? artists[0]?.user_info?.id),
      albumId: identity(album.id), albumName: text(album.name), singer: artist,
      sourceType: 'qs', providerName: '汽水音乐', mediaType: raw.mediaType ?? 'music' },
  };
}

function playlist(value: any): CatalogItem {
  return {
    id: identity(value?.id), title: text(value?.title), description: text(value?.desc),
    cover: qishuiCover(value?.url_cover), provider: 'qishui', kind: 'playlists',
    trackCount: Number.isFinite(Number(value?.count_tracks)) ? Number(value.count_tracks) : undefined,
    metadata: { ...recommendationEntityMetadata(value), creator: text(value?.owner?.nickname ?? value?.owner?.name), tags: value?.tags ?? [] },
  };
}

async function request(path: string, options: QishuiRequestOptions = {}, body?: unknown): Promise<any> {
  if (options.signal?.aborted) throw abortError();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = options.timeoutMs === undefined ? 12_000 : options.timeoutMs;
  const timer = timeout === null ? undefined : setTimeout(cancel, timeout);
  const url = `${body || path.startsWith('/luna/h5/') ? 'https://beta-luna.douyin.com' : 'https://api.qishui.com'}${path}`;
  try {
    const init: RequestInit = {
      method: body ? 'POST' : 'GET', signal: controller.signal,
      headers: { 'User-Agent': 'Luna/19.8.0 Android', ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const response = options.requestContext ? await options.requestContext.fetch(url, init) : await fetch(url, init);
    if (!response.ok) throw new Error(`汽水目录 HTTP ${response.status}`);
    const raw = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    if (options.signal?.aborted) throw abortError();
    if (!raw.trim()) throw new Error('汽水目录返回空响应，请重试');
    const result = JSON.parse(raw);
    if (!result || typeof result !== 'object') throw new Error('汽水目录响应无效');
    const code = Number(result.status_info?.code ?? result.status_code ?? 0);
    if (code !== 0) throw new Error('汽水目录暂不可用，请稍后重试');
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

async function searchResponse(type: 'track' | 'playlist', query: string, page: number, limit: number, options?: QishuiRequestOptions) {
  const cursor = (Math.max(1, Math.floor(page)) - 1) * Math.max(1, Math.floor(limit));
  return request(`/luna/search/${type}?aid=386088&app_name=luna&device_platform=android&version_name=19.8.0&version_code=100198030&q=${encodeURIComponent(query.trim())}&cursor=${cursor}&count=${limit}`, options);
}

async function search(type: 'track' | 'playlist', query: string, page: number, limit: number, options?: QishuiRequestOptions) {
  return array((await searchResponse(type, query, page, limit, options)).result_groups).flatMap(group => array(group.data));
}

export async function searchQishuiTracks(query: string, page = 1, limit = 20, options?: QishuiRequestOptions): Promise<Track[]> {
  return (await search('track', query, page, limit, options))
    .filter(row => row.entity?.track).slice(0, limit).map(normalizeQishuiTrack);
}

export async function searchQishuiPlaylists(query: string, page = 1, limit = 20, options?: QishuiRequestOptions): Promise<CatalogItem[]> {
  return (await search('playlist', query, page, limit, options)).flatMap(row => {
    const entity = row.entity?.playlist;
    return entity && identity(entity.id) && text(entity.title) ? [playlist(entity)] : [];
  }).slice(0, limit);
}

/** The public playlist search provides real offset pagination; discovery's random mix has no cursor. */
export function getQishuiPlaylists(page = 1, category = '全部', options?: QishuiRequestOptions) {
  return searchQishuiPlaylists(category === '全部' ? '歌单' : category, page, 20, options);
}

export async function getQishuiPlaylistPage(page = 1, options?: QishuiRequestOptions) {
  const current = Math.max(1, Math.floor(page));
  const body = await searchResponse('playlist', '歌单', current, 20, options);
  // A successful search with status_info but no groups is the real exhausted
  // response. A missing/invalid envelope must remain retryable instead.
  if (!Array.isArray(body.result_groups) && !(body.result_groups === undefined && body.status_info && typeof body.status_info === 'object'))
    throw new Error('汽水歌单目录响应不完整');
  const groups = array(body.result_groups);
  if (groups.some(group => !group || !Array.isArray(group.data)))
    throw new Error('汽水歌单目录分组不完整');
  const items = groups.flatMap(group => group.data).flatMap(row => {
    const entity = row?.entity?.playlist;
    return entity && /^[1-9]\d*$/.test(identity(entity.id)) && text(entity.title) ? [playlist(entity)] : [];
  }).slice(0, 20);
  const continuing = groups.filter(group => group.has_more === true);
  if (continuing.length && !items.length)
    throw new Error('汽水歌单目录尚有内容但本页为空，请重试');
  if (continuing.some(group => Number(group.next_cursor) !== current * 20))
    throw new Error('汽水歌单目录游标不一致，请重试');
  const hasMore = items.length > 0 && (continuing.length > 0 || groups.some(group => group.has_more === undefined));
  return { items, nextPage: hasMore ? current + 1 : null, outOfRange: false };
}

export async function getQishuiCollection(
  kind: 'playlists' | 'charts' | 'new-albums', id: string, offset = 0, size = 20, options?: QishuiRequestOptions,
): Promise<CatalogDetail & { hasMore: boolean; rawCount: number }> {
  if (!/^\d+$/.test(id)) throw new Error('汽水合集 ID 无效');
  if (kind === 'new-albums') throw new Error('汽水专辑详情接口尚不可用');
  if (kind === 'charts') {
    const body = await request(`/luna/pc/charts/${encodeURIComponent(id)}?aid=386088&device_platform=windows&app_name=luna_pc&version_name=3.0.0`, options);
    if (!body.chart || !Array.isArray(body.chart.track_ranks)) throw new Error('汽水榜单响应不完整');
    const rows: any[] = body.chart.track_ranks;
    const selected = rows.slice(offset, offset + size);
    const tracks = selected.map(row => normalizeQishuiTrack(row.track));
    return { id, title: text(body.chart.title), description: '', provider: 'qishui', kind,
      cover: tracks[0]?.cover, trackCount: rows.length, tracks,
      hasMore: offset + selected.length < rows.length, rawCount: selected.length };
  }
  const body = await request('/luna/playlist/detail', options, { playlist_id: id, cursor: String(offset), count: size });
  if (!body.playlist || !Array.isArray(body.media_resources)) throw new Error('汽水歌单响应不完整');
  const rows = body.media_resources;
  const base = playlist(body.playlist);
  return { ...base, tracks: rows.map(normalizeQishuiTrack), rawCount: rows.length,
    hasMore: typeof body.has_more === 'boolean' ? body.has_more : offset + rows.length < Number(base.trackCount ?? offset + size) };
}

export async function getQishuiLyrics(id: string): Promise<string> {
  if (!/^\d+$/.test(id)) return '';
  const body = await request(`/luna/h5/seo_track?track_id=${encodeURIComponent(id)}&device_platform=web`);
  const content = text(body.lyric?.content);
  if (/\[\d{1,3}:\d{2}/.test(content)) return content;
  return content.split(/\r?\n/).flatMap(line => {
    const match = /^\[(\d+),\d+\](.*)$/.exec(line);
    if (!match) return [];
    const start = Number(match[1]);
    const sentence = match[2]!.replace(/<\d+,\d+,\d+>/g, '').trim();
    const minutes = Math.floor(start / 60_000).toString().padStart(2, '0');
    const seconds = Math.floor(start % 60_000 / 1000).toString().padStart(2, '0');
    return sentence ? [`[${minutes}:${seconds}.${(start % 1000).toString().padStart(3, '0')}]${sentence}`] : [];
  }).join('\n');
}
