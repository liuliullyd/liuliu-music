import { trackQueueKey, type CoverKey, type PersistedState, type Track } from '../domain/types';
import { NativeModules } from 'react-native';
import { plainPlaylistShare } from './playlistShare';
import { createPlaylistShortLink, personalShortLink } from './playlistShortLink';
import { hydratePlaylistReferences, type PlaylistTrackReference } from './playlistTrackReferences';

const prefix = '六六歌单分享 v1\n';
const providers = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qishui', 'custom']);
const coverKeys = new Set(['train', 'cat', 'ocean', 'vinyl']);
const maxLength = 250000;
/** A deterministic display identity/checksum, never an authentication token. */
function shareFingerprint(value: string) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < value.length; index++) for (let part = 0; part < hashes.length; part++)
    // eslint-disable-next-line no-bitwise -- Fixed-width FNV arithmetic defines the share identity.
    hashes[part] = Math.imul(hashes[part] ^ value.charCodeAt(index), 0x01000193);
  // eslint-disable-next-line no-bitwise -- Serialize each signed word as an unsigned 32-bit value.
  return hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}
const text = (value: unknown, limit = 500) => typeof value === 'string' && value.length <= limit ? value.trim() : '';
const cover = (value: unknown) => {
  const uri = text(value, 2048);
  return /^https?:\/\/[^/?#\s@]+(?:[/?#][^\s]*)?$/i.test(uri) ? uri : undefined;
};
const scalar = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value
  : typeof value === 'string' && value.length <= 256 && !/[\s/\\]/.test(value) ? value : undefined;
const tiers = ['128k', '320k', 'flac', 'flac24bit', 'hires'];

/** Only catalog identifiers and quality declarations; never executable data or resolved URLs. */
function catalogMetadata(input: any): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['id', 'songmid', 'mid', 'hash', 'fileHash', 'audio_id', 'audioId', 'Audioid',
    'strMediaMid', 'media_mid', 'albumId', 'albumMid', 'albummid', 'songId', 'copyrightId',
    '320hash', 'hash320', 'sqhash', 'flacHash', 'hash_high', 'flac24bitHash', 'hiresHash']) {
    const value = scalar(input?.[key]);
    if (value !== undefined) result[key] = value;
  }
  const mediaMid = scalar(input?.strMediaMid ?? input?.media_mid ?? input?.file?.media_mid);
  const albumMid = scalar(input?.albumMid ?? input?.albummid ?? input?.album?.mid);
  if (mediaMid !== undefined) result.strMediaMid = mediaMid;
  if (albumMid !== undefined) result.albumMid = albumMid;
  const quality = (value: any) => ({ size: typeof value?.size === 'number' && Number.isFinite(value.size)
    ? value.size : text(value?.size, 64) || null,
    ...(scalar(value?.hash) !== undefined ? { hash: scalar(value.hash) } : {}) });
  for (const key of ['_types', '_qualitys']) if (input?.[key] && typeof input[key] === 'object') {
    result[key] = Object.fromEntries(tiers.filter(tier => input[key][tier]).map(tier => [tier, quality(input[key][tier])]));
  }
  if (Array.isArray(input?.types)) result.types = input.types.filter((value: any) => tiers.includes(value?.type))
    .slice(0, 10).map((value: any) => ({ type: value.type, ...quality(value) }));
  if (Array.isArray(input?.audioFormats)) result.audioFormats = input.audioFormats.slice(0, 10).map((value: any) => ({
    formatType: text(value?.formatType, 20), asize: scalar(value?.asize), isize: scalar(value?.isize),
  }));
  return result;
}

function portableTrack(value: any, index: number): Track {
  if (!value || !providers.has(value.provider) || !text(value.title) ||
    !Number.isFinite(value.duration) || value.duration < 0 || value.duration > 86400)
    throw new Error('歌单歌曲资料不完整，无法导入');
  const providerId = value.provider === 'custom' ? undefined : text(value.providerId, 256);
  if (value.provider !== 'custom' && (!providerId || !/^[a-z0-9_:-]+$/i.test(providerId!)))
    throw new Error('歌单歌曲平台标识无效');
  return { id: providerId ? `${value.provider}-${providerId}` : `shared-local-${index}`,
    provider: value.provider, ...(providerId ? { providerId } : {}), title: text(value.title),
    artist: text(value.artist, 1000), album: text(value.album), duration: value.duration,
    cover: cover(value.cover), coverKey: coverKeys.has(value.coverKey) ? value.coverKey : 'vinyl',
    language: ['华语', '欧美', '日韩', '粤语', '纯音乐', 'ACG'].includes(value.language) ? value.language : '华语',
    genre: text(value.genre, 100), mood: text(value.mood, 100),
    releaseYear: Number.isInteger(value.releaseYear) && value.releaseYear >= 0 && value.releaseYear <= 9999 ? value.releaseYear : 0,
    metadata: value.provider === 'custom' ? {} : catalogMetadata(value.metadata),
  };
}

export type PersonalPlaylistImportPreview = {
  kind: 'personal'; id: string; createdAt: number; title: string; description: string; cover?: string; coverKey: CoverKey;
  tracks: Track[]; readCount: number; duplicateCount: number; unavailableCount: number; total: number;
  shareOrigin?: string;
};
const compact = (input: string) => /liuliu:\/\/playlist\/v([234])\/([a-f0-9]{32})\/([a-z0-9_-]+)/i.exec(input);
const shortLink = personalShortLink;
const shareLinkInput = (input: string) => plainPlaylistShare(input)?.url ?? input.replace(/\r\n/g, '\n').trim();
export const isPersonalPlaylistShare = (input: string) => {
  const value = shareLinkInput(input);
  return value.startsWith(prefix) || !!compact(value) || !!shortLink(value);
};
export function personalPlaylistClipboardCandidate(input: string) {
  if (input.length > maxLength) return null;
  const value = shareLinkInput(input);
  const match = compact(value);
  if (match) return { input: match[0], key: `personal:${match[2].toLowerCase()}` };
  const shortened = shortLink(value);
  if (shortened) return { input: shortened[0], key: `personal:${shortened[2].toLowerCase()}` };
  if (value.startsWith(prefix)) return { input: value, key: `personal:${shareFingerprint(value)}` };
  return null;
}

type PersonalPlaylistShareInput = {
  title: string; description?: string; cover?: string; coverKey: CoverKey; tracks: Track[]; expectedTrackCount?: number;
};
function canonicalPersonalPlaylistShare(value: PersonalPlaylistShareInput, enforceLegacyLimit: boolean) {
  const title = text(value.title);
  if (!title) throw new Error('歌单名称无效');
  if (value.expectedTrackCount !== undefined && value.expectedTrackCount !== value.tracks.length)
    throw new Error('歌单部分歌曲资料缺失，请补全后再分享');
  const payload = { format: 'liuliu-playlist', version: 1, title, description: text(value.description, 2000),
    cover: cover(value.cover), coverKey: coverKeys.has(value.coverKey) ? value.coverKey : 'vinyl',
    tracks: value.tracks.map(portableTrack) };
  const message = prefix + JSON.stringify(payload);
  if (enforceLegacyLimit && message.length > maxLength) throw new Error('歌单分享内容过大，请拆分歌单后分享');
  return { title, message };
}
export function createPersonalPlaylistShare(value: PersonalPlaylistShareInput) {
  return canonicalPersonalPlaylistShare(value, true);
}

const providerOrder = [...providers];
function compactDirectory(message: string) {
  const value = JSON.parse(message.slice(prefix.length));
  return JSON.stringify([value.title, value.description, value.cover ?? null, value.coverKey,
    value.tracks.map((track: Track) => [providerOrder.indexOf(track.provider!), track.providerId ?? null,
      track.title, track.artist, track.album, track.duration, track.cover ?? null, track.coverKey,
      track.language, track.genre, track.mood, track.releaseYear, track.metadata])]);
}
function expandDirectory(message: string) {
  let value: any;
  try { value = JSON.parse(message); } catch { throw new Error('歌单分享链接损坏或不完整'); }
  if (!Array.isArray(value) || value.length !== 5 || !Array.isArray(value[4])) throw new Error('歌单分享格式无效');
  const tracks = value[4].map((row: any, index: number) => {
    if (!Array.isArray(row) || row.length !== 13 || !Number.isInteger(row[0]) || !providerOrder[row[0]]) throw new Error('歌单歌曲资料不完整');
    return portableTrack({ provider: providerOrder[row[0]], providerId: row[1], title: row[2], artist: row[3], album: row[4],
      duration: row[5], cover: row[6], coverKey: row[7], language: row[8], genre: row[9], mood: row[10], releaseYear: row[11], metadata: row[12] }, index);
  });
  return createPersonalPlaylistShare({ title: value[0], description: value[1], cover: value[2], coverKey: value[3], tracks }).message;
}

/** Both compressed formats retain the canonical v1 identity and complete catalog. */
export async function createCompactPersonalPlaylistShare(value: Parameters<typeof createPersonalPlaylistShare>[0]) {
  const original = createPersonalPlaylistShare(value);
  const native = NativeModules.LiuliuMediaLibrary;
  if (!native?.compressPlaylistShare) throw new Error('当前版本不支持紧凑歌单链接，请更新后重试');
  const encoded = await native.compressPlaylistShare(compactDirectory(original.message));
  const legacy = await native.compressPlaylistShare(original.message);
  if ([encoded, legacy].some(data => typeof data !== 'string' || !/^[a-z0-9_-]+$/i.test(data))) throw new Error('歌单分享链接生成失败');
  const shorter = encoded.length <= legacy.length;
  const message = `liuliu://playlist/v${shorter ? 3 : 2}/${shareFingerprint(original.message)}/${shorter ? encoded : legacy}`;
  if (message.length > maxLength) throw new Error('歌单分享内容过大，请拆分歌单后分享');
  return { title: original.title, message, url: message };
}

async function referenceLink(message: string) {
  const original = JSON.parse(message.slice(prefix.length));
  const rows = original.tracks.map((track: Track) => {
    if (track.provider === 'custom' || !track.providerId) throw new Error('本地歌曲没有在线平台 ID，暂不能通过链接分享');
    return [providerOrder.indexOf(track.provider!), track.providerId];
  });
  const fingerprint = shareFingerprint(message);
  const directory = [original.title, rows, fingerprint];
  const encoded = await NativeModules.LiuliuMediaLibrary?.compressPlaylistShare?.(
    JSON.stringify([...directory, shareFingerprint(JSON.stringify(directory))]));
  if (typeof encoded !== 'string' || !/^[a-z0-9_-]+$/i.test(encoded)) throw new Error('歌单分享链接生成失败');
  const url = `liuliu://playlist/v4/${fingerprint}/${encoded}`;
  if (url.length > maxLength) throw new Error('歌单分享内容过大，请拆分歌单后分享');
  return { title: original.title as string, message: url, url };
}

/** New shares contain the name and ordered provider/ID pairs, with no song metadata or media URLs. */
export async function createReferencePersonalPlaylistShare(value: Parameters<typeof createPersonalPlaylistShare>[0]) {
  return referenceLink(canonicalPersonalPlaylistShare(value, false).message);
}

function readReferences(payload: string, fingerprint: string): { title: string; references: PlaylistTrackReference[] } {
  let value: any;
  try { value = JSON.parse(payload); } catch { throw new Error('歌单分享链接损坏或不完整'); }
  if (!Array.isArray(value) || value.length !== 4 || !text(value[0]) || !Array.isArray(value[1]) ||
    value[2] !== fingerprint || value[3] !== shareFingerprint(JSON.stringify(value.slice(0, 3))))
    throw new Error('歌单分享链接损坏或不完整');
  const references = value[1].map((row: any) => {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]) || row[0] < 0 || row[0] >= 6 ||
      typeof row[1] !== 'string' || !/^[a-z0-9_:-]{1,256}$/i.test(row[1])) throw new Error('歌单歌曲平台标识无效');
    return { provider: providerOrder[row[0]], id: row[1] } as PlaylistTrackReference;
  });
  return { title: text(value[0]), references };
}

let shortSequence = 0;
const shortenedShares = new Map<string, string>();
const shortResult = (url: string) => ({ text: url, shortened: true,
  ...(/^https:\/\/(?:[a-z0-9]{4,16}\.)?(?:suo\.run|80v\.me|298\.run)(?:[#/]|$)/i.test(url) ? { expiresInDays: 7 }
    : /^https:\/\/paste\.c-net\.org\//i.test(url) ? { expiresInDays: 180 } : {}) });
/** Explicit Copy action only. All five services and the fallback receive the same ID-only link. */
export async function personalPlaylistCopyLink(input: string) {
  const match = compact(input);
  if (!match || match[0] !== input) throw new Error('歌单分享链接无效');
  if (match[1] !== '4') {
    const payload = await NativeModules.LiuliuMediaLibrary?.expandPlaylistShare?.(match[3]);
    const message = match[1] === '3' ? expandDirectory(payload) : payload;
    if (typeof message !== 'string' || shareFingerprint(message) !== match[2].toLowerCase()) throw new Error('歌单分享链接损坏或不完整');
    input = (await referenceLink(message)).message;
  } else {
    readReferences(await NativeModules.LiuliuMediaLibrary?.expandPlaylistShare?.(match[3]), match[2].toLowerCase());
  }
  const cached = shortenedShares.get(input);
  if (cached) {
    const native = NativeModules.LiuliuMediaLibrary;
    const requestId = `share-cache-${Date.now()}-${++shortSequence}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result: any = await Promise.race([native.resolvePlaylistShare(cached, requestId), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('短链检查超时')), 5000);
      })]);
      if (result?.url === input) return shortResult(cached);
    } catch { /* Expired cached links re-enter the same ordered five-source creation. */ }
    finally { if (timer) clearTimeout(timer); native.cancelPlaylistShare?.(requestId); }
    shortenedShares.delete(input);
  }
  try {
    const copyText = await createPlaylistShortLink(input, match[2].toLowerCase());
    if (!copyText) return { text: input, shortened: false };
    if (shortenedShares.size >= 32) shortenedShares.delete(shortenedShares.keys().next().value!);
    shortenedShares.set(input, copyText);
    return shortResult(copyText);
  } catch { return { text: input, shortened: false }; }
}

export async function readPersonalPlaylistShare(input: string, signal?: AbortSignal): Promise<PersonalPlaylistImportPreview> {
  const candidate = personalPlaylistClipboardCandidate(input);
  if (!candidate) throw new Error('六六歌单分享内容无效或过大');
  if (signal?.aborted) throw new Error('导入已取消');
  const native = NativeModules.LiuliuMediaLibrary;
  let expandedInput = candidate.input;
  if (shortLink(candidate.input)) {
    if (!native?.resolvePlaylistShare) throw new Error('当前版本无法读取短链接，请更新后重试');
    const requestId = `personal-share-${Date.now()}-${++shortSequence}`;
    const cancel = () => native.cancelPlaylistShare?.(requestId);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await native.resolvePlaylistShare(candidate.input, requestId);
      if (signal?.aborted) throw new Error('导入已取消');
      expandedInput = typeof result?.url === 'string' ? result.url : '';
      const target = compact(expandedInput);
      if (!target || target[0] !== expandedInput || `personal:${target[2].toLowerCase()}` !== candidate.key) throw new Error('短链接内容不匹配或已失效');
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  const match = compact(expandedInput);
  if (!match) return { ...previewPersonalPlaylistShare(candidate.input), shareOrigin: candidate.key };
  if (!native?.expandPlaylistShare) throw new Error('当前版本不支持此歌单链接，请更新后重试');
  const payload = await native.expandPlaylistShare(match[3]);
  if (match[1] === '4') {
    if (typeof payload !== 'string' || payload.length > maxLength) throw new Error('歌单分享链接损坏或不完整');
    const { title, references } = readReferences(payload, match[2].toLowerCase());
    const tracks = await hydratePlaylistReferences(references, signal);
    if (signal?.aborted) throw new Error('导入已取消');
    return { ...previewPersonalDirectory({ format: 'liuliu-playlist', version: 1, title, coverKey: 'vinyl', tracks }),
      cover: tracks.find(track => track.cover)?.cover,
      shareOrigin: candidate.key };
  }
  const decoded = match[1] === '3' && typeof payload === 'string' ? expandDirectory(payload) : payload;
  if (signal?.aborted) throw new Error('导入已取消');
  if (typeof decoded !== 'string' || decoded.length > maxLength || shareFingerprint(decoded) !== match[2].toLowerCase())
    throw new Error('歌单分享链接损坏或不完整，请重新复制');
  return { ...previewPersonalPlaylistShare(decoded), shareOrigin: candidate.key };
}

let sequence = 0;
export function previewPersonalPlaylistShare(input: string): PersonalPlaylistImportPreview {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith(prefix) || normalized.length > maxLength) throw new Error('六六歌单分享文本无效或内容过大');
  let value: any;
  try { value = JSON.parse(normalized.slice(prefix.length)); }
  catch { throw new Error('歌单分享文本不完整，请复制完整内容'); }
  return previewPersonalDirectory(value);
}
function previewPersonalDirectory(value: any): PersonalPlaylistImportPreview {
  if (value?.format !== 'liuliu-playlist' || value.version !== 1 || !text(value.title) || !Array.isArray(value.tracks))
    throw new Error('六六歌单分享格式无效');
  const tracks: Track[] = [], seen = new Set<string>();
  for (const [index, entry] of value.tracks.entries()) {
    const track = portableTrack(entry, index), key = trackQueueKey(track);
    if (!seen.has(key)) { seen.add(key); tracks.push(track); }
  }
  const createdAt = Date.now();
  return { kind: 'personal', id: `playlist-shared-${createdAt}-${++sequence}`, createdAt, title: text(value.title),
    description: text(value.description, 2000), cover: cover(value.cover),
    coverKey: coverKeys.has(value.coverKey) ? value.coverKey : 'vinyl', tracks,
    readCount: value.tracks.length, duplicateCount: value.tracks.length - tracks.length, unavailableCount: 0, total: tracks.length };
}

/** Explicit local import only; platform-link imports keep their independent reference contract. */
export function commitPersonalPlaylistImport(state: PersistedState, preview: PersonalPlaylistImportPreview, overwrite = false): PersistedState {
  const existing = state.playlists.find(value => value.id === preview.id || Boolean(preview.shareOrigin && value.shareOrigin === preview.shareOrigin));
  if (existing && !overwrite) return state;
  const playlistId = existing?.id ?? preview.id;
  const saved = new Map(state.savedTracks.map(value => [trackQueueKey(value), value]));
  const known = new Map([...state.history.map(value => value.track), ...state.downloads.map(value => value.track),
    ...state.localTracks, ...state.savedTracks].map(value => [trackQueueKey(value), value]));
  const trackIds = preview.tracks.map((value, index) => {
    const track = value.provider === 'custom' ? { ...value, id: `${playlistId}-local-${index}` } : known.get(trackQueueKey(value)) ?? value;
    const key = trackQueueKey(track);
    if (!saved.has(key)) saved.set(key, track);
    return saved.get(key)!.id;
  });
  const playlist = {
    id: playlistId, title: preview.title, description: preview.description, cover: preview.cover,
    coverKey: preview.coverKey, private: existing?.private ?? true, trackIds, updatedAt: preview.createdAt,
    ...(preview.shareOrigin ? { shareOrigin: preview.shareOrigin } : {}),
  };
  return { ...state, savedTracks: [...saved.values()], playlists: existing
    ? state.playlists.map(value => value === existing ? playlist : value) : [...state.playlists, playlist] };
}
