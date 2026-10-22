import { NativeModules } from 'react-native';

const code = '[a-z0-9_-]{1,64}';
const hosts = `(?:api\\.s1f\\.top/e/${code}|(?:www\\.)?51qu\\.cn/${code}|tinyurl\\.com/${code}|(?:suo\\.run|80v\\.me|298\\.run)/${code}|[a-z0-9]{4,16}\\.(?:80v\\.me|298\\.run)/?|paste\\.rs/${code}|paste\\.c-net\\.org/${code})`;
const allowed = new RegExp(`^https://${hosts}$`, 'i');
const tagged = new RegExp(`https://(${hosts})#llp-([a-f0-9]{32})(?![a-z0-9_-])`, 'i');
export const personalShortLink = (input: string) => tagged.exec(input);
type Source = { id: string; limit?: number; request: (input: string, signal: AbortSignal) => Promise<string> };
async function responseText(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok && response.status !== 302) throw new Error('短链创建失败');
  const text = await response.text();
  if (text.length > 250_000) throw new Error('短链返回过大');
  return text;
}
const get = (url: string, signal: AbortSignal) => responseText(url, { signal });
const post = (url: string, value: unknown, signal: AbortSignal) => responseText(url, { method: 'POST', signal,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(value) });

/** Public endpoints; availability and capacity are checked on each explicit Copy action. */
export const PLAYLIST_SHORT_LINK_SOURCES: readonly Source[] = [
  { id: 'tinyurl', request: (input, signal) => get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(input)}`, signal) },
  { id: 's1f', request: async (input, signal) => {
    const result = JSON.parse(await get(`https://api.s1f.top/short_link?url=${encodeURIComponent(input)}`, signal));
    return result.code === 1 ? result.data?.url : '';
  } },
  { id: 'suo-note', limit: 10000, request: async (input, signal) => {
    const result = JSON.parse(await post('https://suo.run/generate', { note: 1, note_text: input,
      note_title: '六六音乐歌单', expire: 7, custom_code: '', site_url: '80v.me', ua_stay: 0, password: '', ua_plan: [] }, signal));
    return result.code === 1 ? result.data?.short_url : '';
  } },
  { id: 'paste-rs', request: (input, signal) => responseText('https://paste.rs', {
    method: 'POST', signal, headers: { 'Content-Type': 'text/plain' }, body: input }) },
  { id: 'paste-cnet', request: (input, signal) => responseText('https://paste.c-net.org/', {
    method: 'POST', signal, headers: { 'Content-Type': 'text/plain' }, body: input }) },
];
let sequence = 0;

/** One five-second create/read-back slot per source. No truncation, script execution or unchecked success. */
export async function createPlaylistShortLink(input: string, fingerprint: string): Promise<string | null> {
  const native = NativeModules.LiuliuMediaLibrary;
  if (!native?.resolvePlaylistShare) return null;
  for (const source of PLAYLIST_SHORT_LINK_SOURCES) {
    if (source.limit && Array.from(input).length > source.limit) continue;
    const controller = new AbortController();
    const requestId = `share-create-${Date.now()}-${++sequence}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); native.cancelPlaylistShare?.(requestId);
          reject(new Error('短链创建超时')); }, 5000);
      });
      const request = (async () => {
        const result = (await source.request(input, controller.signal))?.trim().replace(/^http:\/\//i, 'https://');
        if (controller.signal.aborted || typeof result !== 'string' || !allowed.test(result)) throw new Error('短链返回无效');
        const url = `${result}#llp-${fingerprint}`;
        const resolved = await native.resolvePlaylistShare(url, requestId);
        if (controller.signal.aborted || resolved?.url !== input) throw new Error('短链内容不完整');
        return url;
      })();
      return await Promise.race([request, timeout]);
    } catch { /* Expiry, capacity, quota or network failure: try the next source, then use the exact ID link. */ }
    finally { if (timer) clearTimeout(timer); controller.abort(); native.cancelPlaylistShare?.(requestId); }
  }
  return null;
}
