import { trackQueueKey, type HomeMenuProgressEntry, type Track } from '../domain/types';
import type { HomeMenuCursor } from './homeMenuDiscovery';

const entryKey = (choice: string, provider: string) => `${choice}|${provider}`;
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const position = (value: unknown, minimum = 0) => Math.max(minimum, Math.min(1_000_000, Math.floor(Number(value) || minimum)));
const keyPattern = /^(?:mode-(?:default|memory|explore)|scene-[a-z0-9-]+)\|(?:netease|qq|kugou|kuwo|migu|qishui)$/;
export const menuQueryProgressKey = (_choice: string, query: string) => `playlist:${query}`;

/** Direct-song offsets never resume a playlist search; keep real recent IDs. */
export function compatibleMenuProgress(choice: string, entry: HomeMenuProgressEntry | undefined) {
  if(!entry) return entry;
  const query=choice==='scene-80s'?'playlist:80':choice==='scene-90s'?'playlist:90':undefined;
  const keys=Object.keys(entry.queries);
  if(keys.every(key=>query ? key===query : key.startsWith('playlist:'))) return entry;
  return {revision:entry.revision,queries:Object.fromEntries(Object.entries(entry.queries)
    .filter(([key])=>query ? key===query : key.startsWith('playlist:'))),collections:{},recentTrackKeys:entry.recentTrackKeys};
}

/** Strict whitelist prevents a saved cursor from carrying songs, URLs or bindings. */
export function normalizeMenuProgress(value: unknown): Record<string, HomeMenuProgressEntry> {
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => keyPattern.test(key)).slice(-240).map(([key, raw]) => {
    const item = object(raw);
    return [key, {
      revision: Number.isFinite(Number(item.revision)) ? Math.max(0, Number(item.revision)) : 0,
      ...(Number.isFinite(Number(item.round)) && Number(item.round)>1 ? {round:position(item.round,1)} : {}),
      queries: Object.fromEntries(Object.entries(object(item.queries)).filter(([query]) => query.length <= 256 && !/^https?:/i.test(query)).slice(-64)
        .map(([query, cursor]) => [query, { page:position(object(cursor).page,1), hasMore:object(cursor).hasMore !== false,
          ...(Number(object(cursor).limit)>0 ? {limit:Math.min(40,position(object(cursor).limit,1))} : {}) }])),
      collections: Object.fromEntries(Object.entries(object(item.collections)).filter(([id]) => id.length <= 256 && !/^https?:/i.test(id)).slice(-40)
        .map(([id,cursor]) => [id,{offset:position(object(cursor).offset),hasMore:object(cursor).hasMore !== false}])),
      recentTrackKeys: [...new Set((Array.isArray(item.recentTrackKeys) ? item.recentTrackKeys : [])
        .filter((id: unknown): id is string => typeof id === 'string' && /^(netease|qq|kugou|kuwo|migu|qishui):[^\s]{1,240}$/.test(id)))].slice(-200) as string[],
    }];
  }));
}

export function menuProgressEntry(progress: Record<string, HomeMenuProgressEntry> | undefined, choice: string, provider: string) {
  return compatibleMenuProgress(choice,progress?.[entryKey(choice,provider)]);
}

/** Only genuine exhaustion starts another bounded round; failed requests keep their position. */
export function advanceExhaustedMenuRound(entry: HomeMenuProgressEntry | undefined, random:()=>number=Math.random) {
  if (!entry || Object.values(entry.queries).some(query => query.hasMore) ||
      Object.values(entry.collections).some(collection => collection.hasMore) ||
      !(Object.keys(entry.queries).length || Object.keys(entry.collections).length)) return entry;
  const pick=(count:number)=>Math.floor(Math.max(0,Math.min(0.999999,random()))*Math.max(1,count));
  return {
    ...entry,
    round:Math.min(1_000_000,(entry.round ?? 1)+1),
    queries: Object.fromEntries(Object.entries(entry.queries).map(([query, cursor]) =>
      [query, { ...cursor, page:1+pick(cursor.page-2), hasMore:true }])),
    collections: Object.fromEntries(Object.entries(entry.collections).map(([id, cursor]) =>
      [id, { ...cursor, offset:20*pick(Math.ceil(cursor.offset/20)), hasMore:true }])),
  };
}

export function mergeMenuProgress(progress: Record<string, HomeMenuProgressEntry> | undefined, cursor: HomeMenuCursor, tracks: Track[]) {
  const next = { ...progress };
  for (const provider of cursor.providers) {
    const key=entryKey(cursor.choiceId,provider.id), old=next[key];
    if ((old?.revision ?? 0) > (cursor.batchRevision ?? 0)) continue;
    const collections = Object.fromEntries((provider.collections ?? []).slice(-40).map(collection => {
      const remaining=provider.candidates.some(candidate=>candidate.collection?.id === collection.item.id);
      return [collection.item.id,{offset:Math.max(0,collection.offset-(remaining ? 20 : 0)),hasMore:remaining || collection.hasMore}];
    }));
    const queries=Object.fromEntries(provider.queries.map(query=> {
      const retained=provider.candidates.some(candidate=>candidate.query === query.query) ||
        provider.collections?.some(collection=>collection.query === query.query && (collections[collection.item.id]?.hasMore));
      return [menuQueryProgressKey(cursor.choiceId,query.query),{page:Math.max(1,query.page-(retained ? 1 : 0)),hasMore:retained || query.hasMore,
        ...(query.limit ? {limit:query.limit} : {})}];
    }));
    const recent=[...new Set([...(old?.recentTrackKeys ?? []),...(cursor.recentTrackKeys ?? []),
      ...tracks.filter(track=>track.provider === provider.id).map(trackQueueKey)])].slice(-200);
    next[key]={revision:cursor.batchRevision ?? 0,...(cursor.catalogRound ? {round:cursor.catalogRound} : {}),
      queries,collections,recentTrackKeys:recent};
  }
  return next;
}
