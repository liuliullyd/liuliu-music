import { trackQueueKey, type Track } from '../domain/types';
import { trackMediaKind } from './mediaLibrary';
import type { QueueSource } from './queuePaging';

const identity = (value: unknown) => {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return id && id !== '0' && id !== '-1' ? id : '';
};

/** Metadata only: selected audio must start before the directory is requested. */
export function episodeHistoryQueueSource(track: Track): QueueSource | null {
  const kind = trackMediaKind(track);
  if (kind === 'music' || !['netease', 'qq', 'kugou', 'migu'].includes(track.provider) ||
      (kind === 'podcast' && track.provider !== 'netease' && track.provider !== 'qq')) return null;
  const metadata = track.metadata ?? {};
  const radio = metadata.radio as { id?: unknown } | undefined;
  const id = track.provider === 'netease'
    ? identity(metadata.radioId ?? radio?.id)
    : identity(metadata.albumid ?? metadata.albumId ?? metadata.album_id ?? metadata.albummid);
  if (!id) return null;
  const storedOffset = Number(metadata.collectionEpisodeOffset);
  const serial = Number(track.provider === 'netease' ? metadata.serialNum : metadata.index_album);
  const episodeOffset = Number.isInteger(storedOffset) && storedOffset >= 0
    ? storedOffset
    : Number.isInteger(serial) && serial > 0 ? serial - 1 : 0;
  const offset = Math.floor(episodeOffset / 20) * 20;
  return {
    kind: 'collection', provider: track.provider as 'netease' | 'qq' | 'kugou' | 'migu',
    collectionKind: kind, id, offset, hasMore: true,
    metadata: { mediaType: kind === 'audiobook' ? 'long-audio' : 'podcast',
      collectionEpisodeOrder: 'oldest', ...(identity(metadata.albummid) ? { albummid: identity(metadata.albummid) } : {}) },
    resumeEpisode: { key: trackQueueKey(track), hint: offset, checkedHint: false },
    initialEpisodeBatch: { remaining: 19 },
  };
}
