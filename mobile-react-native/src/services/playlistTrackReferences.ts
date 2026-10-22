import type { Track } from '../domain/types';
import { normalizeNeteaseTrack, normalizeQqTrack, normalizeKugouTrack, normalizeKuwoTrack, normalizeMiguTrack } from './onlineCatalog';
import { normalizeQishuiTrack } from './qishuiCatalog';
import { readKuwoReferenceMetadata } from './kuwoReferenceMetadata';

export type PlaylistTrackReference = { provider: Exclude<Track['provider'], 'custom'>; id: string };
const abort = () => Object.assign(new Error('导入已取消'), { name: 'AbortError' });
async function requestText(url: string, signal: AbortSignal) {
  if (signal.aborted) throw abort();
  const response = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`歌曲资料 HTTP ${response.status}`);
  const raw = await response.text();
  if (signal.aborted) throw abort();
  if (raw.length > 2_000_000) throw new Error('歌曲资料响应过大');
  return raw;
}
const request = async (url: string, signal: AbortSignal) => JSON.parse(await requestText(url, signal));

/** Exact provider identity only: search matches and resolved audio URLs are never substitutes. */
export async function readPlaylistTrackReference(reference: PlaylistTrackReference, signal: AbortSignal): Promise<Track> {
  const { provider, id } = reference;
  const encoded = encodeURIComponent(id);
  let track: Track;
  let actual: unknown;
  if (provider === 'netease') {
    const body = await request(`https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify([{ id }]))}`, signal);
    const row = body.songs?.[0]; actual = row?.id;
    track = normalizeNeteaseTrack(row ?? {});
  } else if (provider === 'qq') {
    const params = /^\d+$/.test(id) ? { song_id: Number(id) } : { song_mid: id };
    const data = { comm: { ct: 24, cv: 0 }, songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: params } };
    const body = await request(`https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(data))}`, signal);
    const row = body.songinfo?.data?.track_info;
    actual = /^\d+$/.test(id) ? row?.id ?? row?.songid : row?.mid ?? row?.songmid;
    track = normalizeQqTrack(row ?? {});
  } else if (provider === 'kugou') {
    const body = await request(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encoded}`, signal);
    const row = body.data ?? body; actual = row.hash;
    track = normalizeKugouTrack({ ...row, songname: row.songName ?? row.song_name ?? row.songname,
      singername: row.author_name ?? row.singername, duration: row.timeLength ?? (row.timelength ? Number(row.timelength) / 1000 : row.duration),
      img: row.img ?? row.imgUrl, album_id: row.album_id ?? row.req_albumid, album_name: row.album_name ?? row.albumName,
      SQFileHash: row.SQFileHash ?? row.sqhash, HQFileHash: row.HQFileHash ?? row.hash320 });
  } else if (provider === 'kuwo') {
    let row: any = {};
    const usable = (value: any) =>
      String(value.id ?? value.musicrid ?? value.rid ?? '').replace(/^MUSIC_/, '') === id &&
      Boolean(String(value.name || value.songName || '').trim()) &&
      Boolean(String(value.artist || '').trim());
    try {
      const body = await request(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encoded}`, signal);
      row = body.data?.songinfo ?? {};
    } catch { if (signal.aborted) throw abort(); }
    if (!usable(row) || !(row.pic || row.albumpic)) {
      try {
        const page = readKuwoReferenceMetadata(await requestText(`https://www.kuwo.cn/play_detail/${encoded}`, signal));
        if (usable(page)) row = page;
      } catch { if (signal.aborted) throw abort(); }
    }
    if (!usable(row)) throw new Error('原歌曲资料暂不可用');
    actual = row.id ?? row.musicrid ?? row.rid;
    track = normalizeKuwoTrack({ ...row, name: row.name || row.songName });
  } else if (provider === 'migu') {
    const body = await request(`https://app.c.nf.migu.cn/MIGUM3.0/v1.0/content/resourceinfo.do?resourceId=${encoded}&resourceType=2`, signal);
    const row = body.resource?.[0] ?? body.data?.resource?.[0] ?? {}; actual = row.songId ?? row.id ?? row.contentId;
    track = normalizeMiguTrack(row);
  } else {
    const body = await request(`https://beta-luna.douyin.com/luna/h5/seo_track?track_id=${encoded}&device_platform=web`, signal);
    const row = body.seo_track?.track ?? body.track ?? body.track_info ?? body;
    track = normalizeQishuiTrack(row); actual = track.providerId;
  }
  const returned = String(actual ?? '').replace(/^MUSIC_/, '');
  const matches = provider === 'kugou' ? returned.toLowerCase() === id.toLowerCase() : returned === id;
  if (!matches || !track.title?.trim() || !track.artist?.trim() || track.duration < 0)
    throw new Error('原歌曲资料暂不可用');
  // Preserve the shared identity even when a provider also supplies another internal identifier.
  return { ...track, id: `${provider}-${id}`, providerId: id, playUrl: undefined };
}

/** Four bounded metadata reads at a time, preserving every position; failure prevents partial saving. */
export async function hydratePlaylistReferences(references: PlaylistTrackReference[], signal?: AbortSignal): Promise<Track[]> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const tracks = new Array<Track>(references.length);
  let next = 0;
  let failure: Error | undefined;
  try {
    await Promise.all(Array.from({ length: Math.min(4, references.length) }, async () => {
      while (!failure && next < references.length) {
        const index = next++;
        const timer = setTimeout(cancel, 12_000);
        try { tracks[index] = await readPlaylistTrackReference(references[index], controller.signal); }
        catch {
          failure ??= signal?.aborted ? abort() : new Error(`第 ${index + 1} 首歌曲资料读取失败，请联网后重试（${references[index].provider}）`);
          cancel();
        } finally { clearTimeout(timer); }
      }
    }));
    if (signal?.aborted) throw abort();
    if (failure) throw failure;
    return tracks;
  } finally { cancel(); signal?.removeEventListener('abort', cancel); }
}
