import type {
  CatalogItem,
  HistoryEntry,
  MediaCollectionPlayback,
  MediaLibraryBucket,
  NativePlayerState,
  PersistedState,
  Track,
} from '../domain/types';
import { trackQueueKey } from '../domain/types';
import {
  collectionMediaKind,
  mediaBucket,
  trackMediaKind,
} from './mediaLibrary';

const providers = new Set(['netease', 'qq', 'kugou', 'kuwo', 'migu']);
const seconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const realId = (value: unknown) => {
  const id =
    typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
  return id && id !== '0' && id !== '-1' ? id : '';
};
export const mediaPlaybackKey = (track: Track) =>
  `${trackMediaKind(track)}:${trackQueueKey(track)}`;
const collectionKey = (kind: string, provider: string, id: string) =>
  `${provider}:${kind}:${id}`;

interface CollectionSource {
  kind: string;
  collectionKind?: string;
  provider?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

function playedCollection(
  track: Track,
  source?: CollectionSource | null,
): MediaCollectionPlayback | null {
  const kind = trackMediaKind(track);
  if (kind === 'music' || !providers.has(track.provider)) return null;
  const metadata = track.metadata ?? {};
  const sourceKind = source?.collectionKind ?? source?.metadata?.mediaType;
  const matchingSource =
    source?.kind === 'collection' &&
    source.provider === track.provider &&
    (sourceKind === kind ||
      (kind === 'audiobook' && sourceKind === 'long-audio'));
  const id = matchingSource
    ? realId(source.id)
    : track.provider === 'netease'
    ? realId(
        metadata.radioId ??
          (metadata.radio as { id?: unknown } | undefined)?.id,
      )
    : realId(metadata.albumid ?? metadata.albumId ?? metadata.album_id);
  if (!id) return null;
  return {
    provider: track.provider as CatalogItem['provider'],
    kind,
    collectionId: id,
    trackKey: trackQueueKey(track),
    playedAt: Date.now(),
  };
}

export function rememberMediaPlayback(
  bucket: MediaLibraryBucket,
  track: Track,
  source?: CollectionSource | null,
): MediaLibraryBucket {
  const key = mediaPlaybackKey(track);
  const previous = bucket.history.find(
    entry => mediaPlaybackKey(entry.track) === key,
  );
  const collection = playedCollection(track, source);
  const entry: HistoryEntry = {
    ...previous,
    track,
    playedAt: Date.now(),
    listenedSeconds: previous?.listenedSeconds ?? 0,
    completed: previous?.completed ?? false,
    skipped: previous?.skipped ?? false,
  };
  return {
    ...bucket,
    history: [
      entry,
      ...bucket.history.filter(item => mediaPlaybackKey(item.track) !== key),
    ].slice(0, 100),
    ...(collection
      ? {
          collectionPlayback: {
            ...bucket.collectionPlayback,
            [collectionKey(
              collection.kind,
              collection.provider,
              collection.collectionId,
            )]: collection,
          },
        }
      : {}),
  };
}

export function normalizeCollectionPlayback(
  value: unknown,
  kind: 'podcast' | 'audiobook',
) {
  const records: Record<string, MediaCollectionPlayback> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return records;
  for (const candidate of Object.values(value)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as MediaCollectionPlayback;
    const id = realId(entry.collectionId);
    if (
      entry.kind !== kind ||
      !providers.has(entry.provider) ||
      !id ||
      typeof entry.trackKey !== 'string' ||
      !entry.trackKey.startsWith(`${entry.provider}:`) ||
      !realId(entry.trackKey.slice(entry.provider.length + 1)) ||
      !seconds(entry.playedAt)
    )
      continue;
    records[collectionKey(kind, entry.provider, id)] = {
      provider: entry.provider,
      kind,
      collectionId: id,
      trackKey: entry.trackKey,
      playedAt: entry.playedAt,
    };
  }
  return records;
}

export function lastPlayedCollectionTrack(
  state: PersistedState,
  item: CatalogItem,
): string | null {
  const kind = collectionMediaKind(item);
  if (kind === 'music') return null;
  const bucket = mediaBucket(state, kind);
  const key = collectionKey(kind, item.provider, item.id);
  const remembered = bucket.collectionPlayback?.[key];
  if (remembered) return remembered.trackKey;
  // Old histories can be used only when their metadata proves the collection identity.
  const entry = bucket.history.find(record => {
    const collection = playedCollection(record.track);
    return (
      collection &&
      collectionKey(
        collection.kind,
        collection.provider,
        collection.collectionId,
      ) === key
    );
  });
  return entry ? trackQueueKey(entry.track) : null;
}

export interface MediaProgressUpdate {
  track: Track;
  position: number;
  duration: number;
  completed: boolean;
}
export function updateMediaProgress(
  bucket: MediaLibraryBucket,
  update: MediaProgressUpdate,
): MediaLibraryBucket {
  const key = mediaPlaybackKey(update.track);
  const index = bucket.history.findIndex(
    entry => mediaPlaybackKey(entry.track) === key,
  );
  if (index < 0) return bucket; // Clearing history must not resurrect the active item.
  const old = bucket.history[index]!;
  const duration =
    seconds(update.duration) || seconds(old.playbackDurationSeconds);
  const position = duration
    ? Math.min(duration, seconds(update.position))
    : seconds(update.position);
  const completed = old.completed || update.completed;
  if (
    old.positionSeconds === position &&
    old.playbackDurationSeconds === duration &&
    old.completed === completed
  )
    return bucket;
  const history = [...bucket.history];
  history[index] = {
    ...old,
    positionSeconds: position,
    playbackDurationSeconds: duration,
    completed,
  };
  return { ...bucket, history };
}

/** Observe confirmed playback only; never resolve audio or operate the player. */
export class MediaProgressRecorder {
  private confirmed = new Map<string, Track>();
  private pending = new Map<string, MediaProgressUpdate>();
  private publishedAt = new Map<string, number>();
  private frames = new Map<string, { position: number; at: number }>();
  private active = '';
  private transitionSequence = 0;
  confirm(track: Track) {
    if (trackMediaKind(track) !== 'music')
      this.confirmed.set(trackQueueKey(track), track);
    else this.confirmed.delete(trackQueueKey(track));
  }
  transition(value: NativePlayerState['previousItem']): MediaProgressUpdate[] {
    if (
      !value ||
      !Number.isFinite(value.sequence) ||
      value.sequence <= this.transitionSequence
    )
      return [];
    this.transitionSequence = value.sequence;
    const track = this.confirmed.get(value.mediaId);
    if (!track) return [];
    this.pending.delete(value.mediaId);
    return [
      {
        track,
        position: seconds(value.position),
        duration: seconds(value.duration),
        completed: value.completed,
      },
    ];
  }
  observe(
    value: NativePlayerState,
    force = false,
    now = Date.now(),
  ): MediaProgressUpdate[] {
    const key = value.mediaId ?? '';
    const track = this.confirmed.get(key);
    if (
      !track ||
      value.error ||
      value.urlRecovery ||
      !Number.isFinite(value.position) ||
      value.position < 0
    )
      return [];
    const updates: MediaProgressUpdate[] = [];
    if (this.active && this.active !== key) {
      const previous = this.pending.get(this.active);
      if (previous) {
        updates.push(previous);
        this.pending.delete(this.active);
      }
    }
    this.active = key;
    const position = seconds(value.position),
      duration = seconds(value.duration);
    const previousFrame = this.frames.get(key);
    const jumped =
      previousFrame &&
      Math.abs(
        position -
          previousFrame.position -
          (value.playing ? Math.max(0, now - previousFrame.at) / 1000 : 0),
      ) > 2;
    this.frames.set(key, { position, at: now });
    const update = {
      track,
      position,
      duration,
      completed: Boolean(value.ended && !value.error),
    };
    this.pending.set(key, update);
    if (
      force ||
      !value.playing ||
      update.completed ||
      jumped ||
      !this.publishedAt.has(key) ||
      now - this.publishedAt.get(key)! >= 5000
    ) {
      updates.push(update);
      this.pending.delete(key);
      this.publishedAt.set(key, now);
    }
    return updates;
  }
  flush(): MediaProgressUpdate[] {
    const updates = [...this.pending.values()];
    this.pending.clear();
    return updates;
  }
  clear(kind?: 'music' | 'podcast' | 'audiobook') {
    for (const [key, track] of this.confirmed)
      if (!kind || trackMediaKind(track) === kind) {
        this.confirmed.delete(key);
        this.pending.delete(key);
        this.publishedAt.delete(key);
        this.frames.delete(key);
      }
  }
}

/** Only recorded playhead seconds are a resume point; listening totals are not. */
export function mediaResumePosition(
  entry?: HistoryEntry,
  player?: NativePlayerState,
  current?: Track | null,
): number {
  if (!entry || entry.completed || trackMediaKind(entry.track) === 'music') return 0;
  const live = current && mediaPlaybackKey(entry.track) === mediaPlaybackKey(current) &&
    player?.mediaId === trackQueueKey(entry.track) && !player.error && !player.urlRecovery;
  const position = live ? seconds(player.position) : seconds(entry.positionSeconds);
  const duration = live ? seconds(player.duration) : seconds(entry.playbackDurationSeconds);
  return duration && position >= duration ? 0 : position;
}

export function mediaProgressLabel(
  entry?: HistoryEntry,
  player?: NativePlayerState,
  current?: Track | null,
): string {
  const live =
    entry &&
    current &&
    mediaPlaybackKey(entry.track) === mediaPlaybackKey(current) &&
    player?.mediaId === trackQueueKey(entry.track) &&
    !player.error &&
    !player.urlRecovery;
  const position = live
    ? seconds(player.position)
    : seconds(entry?.positionSeconds ?? entry?.listenedSeconds);
  const duration = live
    ? seconds(player.duration)
    : seconds(entry?.playbackDurationSeconds);
  if (!duration) {
    if (!position) return entry?.completed ? '已完播' : '进度待更新';
    return `已听 ${Math.floor(position / 60)}:${String(
      Math.floor(position % 60),
    ).padStart(2, '0')}`;
  }
  const ended = live
    ? Boolean(player.ended)
    : Boolean(entry?.completed && position >= duration);
  const percent = ended
    ? 100
    : Math.min(99, Math.floor((position / duration) * 100));
  return `已播 ${percent}%`;
}
