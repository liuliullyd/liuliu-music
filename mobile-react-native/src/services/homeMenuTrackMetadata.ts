import type { Track, CatalogItem } from '../domain/types';
import { constituentArtists } from './liveDiscovery';
import { CatalogRequestBudget } from './catalogRequestBudget';
import { exploreLanguage } from './musicPreferenceStatistics';
import { sceneCollectionSungLanguage } from './homeMenuLanguages';
import { isMusicOnlyRecommendationTrack } from './recommendationContentPolicy';
import { parsePlatformJsonText } from './onlineCatalog';

type RecordValue = Record<string, unknown>;

/** Shared by direct and playlist recall in one provider request; no extra timer. */
export class MenuAlbumRequestQueue {
  private active=0;
  private waiting:{start:()=>void}[]=[];
  async run<T>(scope:CatalogRequestBudget,request:()=>Promise<T>):Promise<T> {
    scope.assertActive();
    const release=await new Promise<()=>void>((resolve,reject)=>{
      const cancel=()=>{
        this.waiting=this.waiting.filter(item=>item!==ticket);
        scope.signal.removeEventListener('abort',cancel);
        reject(new Error('场景推荐请求已结束，请重试'));
      };
      const ticket={start:()=>{
        if(scope.signal.aborted){cancel();return;}
        scope.signal.removeEventListener('abort',cancel);
        this.active+=1;
        resolve(()=>{this.active-=1;this.waiting.shift()?.start();});
      }};
      scope.signal.addEventListener('abort',cancel,{once:true});
      if(this.active<2)ticket.start();else this.waiting.push(ticket);
    });
    try {scope.assertActive();return await scope.wait(request());}
    finally {release();}
  }
}
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const first = (...values: unknown[]) =>
  values.find(value => value !== undefined && value !== null && value !== '');
export const usesMenuTrackMetadata = (choice: string) =>
  ['mode-explore', 'scene-80s', 'scene-90s'].includes(choice);
export const usesMenuSongRecall = (choice: string) =>
  choice === 'scene-phonk';

function explicitYear(value: unknown): number | undefined {
  if (
    typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ) {
    const number = Number(value);
    if (
      Number.isInteger(number) &&
      number >= 1900 &&
      number <= new Date().getUTCFullYear()
    )
      return number;
    if (number >= 100_000_000) {
      const date = new Date(number < 100_000_000_000 ? number * 1000 : number);
      const year = date.getUTCFullYear();
      if (
        year >= 1900 &&
        year <= new Date().getUTCFullYear() &&
        date.getTime() <= Date.now()
      )
        return year;
    }
    return undefined;
  }
  const parts = text(value).match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/,
  );
  if (!parts) return undefined;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
    ? year
    : undefined;
}

const originalFields = [
  'originalReleaseYear',
  'original_release_year',
  'OriginalReleaseYear',
  'originalReleaseDate',
  'original_release_date',
  'OriginalReleaseDate',
];
const releaseFields = [
  'releaseYear',
  'release_year',
  'ReleaseYear',
  'year',
  'releaseDate',
  'release_date',
  'ReleaseDate',
  'PublishDate',
  'publishDate',
  'publish_date',
  'PublishTime',
  'publishTime',
  'publish_time',
  'publishtime',
  'pubtime',
  'pub_time',
  'publicTime',
  'public_time',
  'issueDate',
  'issue_date',
  'time_public',
  'RELEASEDATE',
  'PUBLISHDATE',
  'aDate',
  'pub',
];

export function menuTrackOriginalReleaseYear(track: Track): number | undefined {
  const raw = track.metadata ?? {};
  for (const source of [raw, record(raw.album ?? raw.al)])
    for (const field of originalFields) {
      const year = explicitYear(source[field]);
      if (year !== undefined) return year;
    }
  return undefined;
}

/** Only explicit song/album release fields; never playlist dates or title digits. */
export function menuTrackReleaseYear(track: Track): number | undefined {
  const raw = track.metadata ?? {};
  const album = record(raw.album ?? raw.al);
  for (const fields of [originalFields, releaseFields])
    for (const source of [raw, album])
      for (const field of fields) {
        const year = explicitYear(source[field]);
        if (year !== undefined) return year;
      }
  // Existing catalog callers may supply a real earlier year without raw fields.
  return track.releaseYear >= 1900 &&
    track.releaseYear < new Date().getUTCFullYear()
    ? track.releaseYear
    : undefined;
}

const languageCodes: Record<string, string> = {
  zh:'国语', 'zh-cn':'国语', cmn:'国语', zho:'国语', chi:'国语', yue:'粤语',
  en:'英语', eng:'英语', fr:'法语', fra:'法语', fre:'法语', de:'德语', deu:'德语', ger:'德语',
  ja:'日语', jpn:'日语', ko:'韩语', kor:'韩语', es:'西班牙语', spa:'西班牙语',
  pt:'葡萄牙语', por:'葡萄牙语', ru:'俄语', rus:'俄语', th:'泰语', tha:'泰语',
  hi:'印地语', hin:'印地语', ar:'阿拉伯语', ara:'阿拉伯语', it:'意大利语', ita:'意大利语', vi:'越南语',
};

export function menuCollectionLanguage(collection: CatalogItem) {
  if(collection.kind!=='playlists' || !collection.id) return undefined;
  const language=sceneCollectionSungLanguage(collection);
  return language ? languageCodes[language] : undefined;
}

/** Called only for tracks returned by this exact provider playlist detail. */
export function withMenuCollectionLanguage(track: Track, collection: CatalogItem): Track {
  if(track.provider!==collection.provider || exploreLanguage(track)) return track;
  const normalized=normalizeMenuTrackMetadata(track);
  if(exploreLanguage(normalized)) return normalized;
  if(track.language==='纯音乐' || normalized.metadata?.isInstrumental===true ||
    track.metadata?.hasVocals===false || track.metadata?.hasVocal===false) return track;
  const language=menuCollectionLanguage(collection);
  if(!language || !isMusicOnlyRecommendationTrack({...track,title:collection.title,artist:'',album:'',metadata:collection.metadata})) return track;
  return {...track,metadata:{...track.metadata,language,
    menuCollectionLanguageEvidence:{provider:collection.provider,id:collection.id,language}}};
}
const languageValue = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(languageValue);
  if (typeof value !== 'string') return [];
  return value.split(/[,，;；、|/]/).map(part=>part.trim()).filter(Boolean)
    .map(part=>languageCodes[part.toLowerCase()] ?? part);
};

/** Menu evidence only; display defaults never supply a language or date. */
export function normalizeMenuTrackMetadata(track: Track): Track {
  const raw = track.metadata ?? {},
    trans = record(raw.trans_param);
  const language = [
    raw.languageName, raw.language_name, raw.LANGUAGE, raw.langName,
    raw.language,
    raw.lang,
    raw.songLanguage,
    raw.song_language,
    trans.language,
    raw.lang_codes,
    // Only enums already established by this provider's current contract.
    ...(track.provider === 'qq' ? [raw.language === 0 ? '国语' : raw.language === 9 ? '纯音乐' : undefined] : []),
  ].map(languageValue).find(values=>values.length) ?? [];
  const genre = first(raw.genre, raw.Genre, raw.genres, trans.genre);
  const style = first(raw.style, raw.Style, raw.styles, trans.style);
  return {
    ...track,
    metadata: {
      ...raw,
      ...(language.length ? { language: language.length===1 ? language[0] : [...new Set(language)] } : {}),
      ...(genre !== undefined ? { genre } : {}),
      ...(style !== undefined ? { style } : {}),
      ...(/纯音乐|純音樂|instrumental/i.test(language.join(' '))
        ? { isInstrumental: true }
        : {}),
      ...(menuTrackReleaseYear(track) !== undefined
        ? { releaseYear: menuTrackReleaseYear(track) }
        : {}),
    },
  };
}

const identity = (value: string) =>
  value
    .toLowerCase()
    .replace(/\(explicit\)|（explicit）/gi, '')
    .replace(/[\s\p{P}]/gu, '');

const artistNames = (value: unknown): string => Array.isArray(value)
  ? value.map(artistNames).filter(Boolean).join(' / ')
  : typeof value === 'object' && value ? artistNames(record(value).name) : text(value);

async function readMenuAlbum(track: Track, id: string, scope: CatalogRequestBudget): Promise<RecordValue> {
  const encoded=encodeURIComponent(id);
  const endpoint = track.provider === 'netease' ? `https://music.163.com/api/v1/album/${encoded}`
    : track.provider === 'qq' ? `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?format=json&albummid=${encoded}`
    : track.provider === 'kugou' ? `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encoded}`
    : track.provider === 'kuwo' ? `http://search.kuwo.cn/r.s?pn=0&rn=20&stype=albuminfo&albumid=${encoded}&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0`
    : `http://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/queryAlbumSong?albumId=${encoded}&pageNo=1`;
  const referer = track.provider === 'netease' ? 'https://music.163.com/' : track.provider === 'qq' ? 'https://y.qq.com/'
    : track.provider === 'kugou' ? 'http://m.kugou.com/' : track.provider === 'kuwo' ? 'http://www.kuwo.cn/' : 'https://m.music.migu.cn/';
  const response=await scope.fetch(endpoint,{headers:{Referer:referer}});
  const body=record(track.provider==='kuwo' ? parsePlatformJsonText(await response.text()) : await response.json());
  scope.assertActive();
  if(track.provider==='netease') return record(body.album);
  if(track.provider==='qq' || track.provider==='kugou') return record(body.data);
  return body;
}

function matchedAlbumEvidence(track: Track, id: string, response: RecordValue): RecordValue | undefined {
  let album=response;
  if(track.provider==='migu') {
    const rows=response.songList ?? record(response.data).songList;
    if(!Array.isArray(rows)) return undefined;
    album=record(rows.find(value=>{
      const row=record(value);
      return String(row.songId ?? row.id ?? row.contentId ?? '')===String(track.providerId);
    }));
  }
  const actualId=String(track.provider==='qq' ? first(album.mid,album.id) : first(album.albumId,album.albumid,album.id) ?? '');
  if(actualId!==id) return undefined;
  const name=text(first(album.albumname,album.albumName,album.name));
  const artists=artistNames(first(album.singername,album.artist,album.artists,album.singerName,album.singer));
  if(!name || identity(name)!==identity(track.album) || !constituentArtists(artists).some(artist=>constituentArtists(track.artist).includes(artist))) return undefined;
  return {
    ...album,
    // Album language is accepted only after this exact album/artist check.
    language:first(album.language,album.languageName,album.lang,album.lan,album.LANGUAGE),
  };
}
/** Directory metadata only: no media URLs, source resolution or native work. */
export async function supplementMenuTrackMetadata(
  tracks: Track[],
  choice: string,
  budget?: CatalogRequestBudget,
  onTrack?: (track: Track) => void,
  albums = new Map<string, Promise<RecordValue>>(),
  albumRequests = new MenuAlbumRequestQueue(),
): Promise<Track[]> {
  const normalized = tracks.map(normalizeMenuTrackMetadata);
  if (!usesMenuTrackMetadata(choice)) return tracks;
  const scope = budget ?? new CatalogRequestBudget(8_000);
  try {
    return await Promise.all(
      normalized
        .map(async track => {
          if (
            !['netease','qq','kugou','kuwo','migu'].includes(track.provider) ||
            (menuTrackReleaseYear(track) !== undefined && (choice !== 'mode-explore' || exploreLanguage(track) || track.provider==='netease'))
          )
            return track;
          const raw = track.metadata ?? {};
          const rawAlbum=record(raw.album ?? raw.al);
          const albumId = String(first(raw.albumId,raw.album_id,raw.AlbumID,raw.ALBUMID,raw.albumMid,raw.albummid,rawAlbum.id,rawAlbum.mid) ?? '');
          if (!/^[a-z\d]+$/i.test(albumId) || albumId === '0') return track;
          const cacheKey=`${track.provider}:${albumId}`;
          let request = albums.get(cacheKey);
          if (!request) {
            request = albumRequests.run(scope,()=>readMenuAlbum(track,albumId,scope));
            albums.set(cacheKey, request);
          }
          try {
            const album = matchedAlbumEvidence(track,albumId,await request);
            budget?.assertActive();
            if (!album) return track;
            return normalizeMenuTrackMetadata({
              ...track,
              metadata: {
                ...raw,
                ...(choice==='mode-explore' && !exploreLanguage(track) && album.language ? {language:album.language} : {}),
                album: { ...rawAlbum, ...album },
              },
            });
          } catch {
            return track;
          }
        })
        .map(work =>
          work.then(track => {
            scope.assertActive();
            onTrack?.(track);
            return track;
          }),
        ),
    );
  } finally {
    if (!budget) scope.close();
  }
}
