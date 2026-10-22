import {
  trackQueueKey,
  type PersistedState,
  type Track,
} from '../domain/types';
import type { DownloadStatus } from './storage';
import { mediaDownloads, trackMediaKind } from './mediaLibrary';
import {
  MIN_ACTUAL_TO_CATALOG_RATIO,
  MIN_PLAYABLE_DURATION_SECONDS,
  isCatalogTrackEligible,
  isRuntimeTrackBlocked,
  type AudioProbeResult,
} from './trackPlaybackPolicy';

export const isLocalAudioUri = (uri: unknown): uri is string =>
  typeof uri === 'string' && /^(content|file):\/\//i.test(uri);
const localAudioUri = (value: unknown): string | null =>
  isLocalAudioUri(value)
    ? value
    : typeof value === 'string' && /^\/(storage|sdcard|mnt)\//.test(value)
    ? `file://${value}`
    : null;
export const localPlaybackReference = (track: Track): string | null => {
  const saved = track.metadata?._libraryLocalFile;
  if (
    typeof saved === 'string' &&
    (isLocalAudioUri(saved) || /^download:\d+$/.test(saved))
  )
    return saved;
  return (
    localAudioUri(saved) ??
    localAudioUri(track.playUrl) ??
    (track.provider === 'custom' ? localAudioUri(track.providerId) : null)
  );
};

/** Prepare Library inputs without changing provider identity, order or source selection. */
export function libraryPlaybackTrack(
  track: Track,
  state: PersistedState,
): Track {
  const entry = mediaDownloads(state, trackMediaKind(track)).find(
    item =>
      item.status === 'downloaded' &&
      trackQueueKey(item.track) === trackQueueKey(track),
  );
  const reference =
    (entry &&
      (/^download:\d+$/.test(entry.id)
        ? entry.id
        : localAudioUri(entry.id) ?? localPlaybackReference(entry.track))) ??
    localPlaybackReference(track);
  if (reference && reference !== localPlaybackReference(track))
    return {
      ...track,
      metadata: { ...track.metadata, _libraryLocalFile: reference },
    };
  // Library records can outlive signed online URLs. Reuse only the shared
  // process cache or the current prepared native entry, never a stored URL.
  if (!reference && /^https?:\/\//i.test(track.playUrl ?? ''))
    return { ...track, playUrl: undefined };
  return track;
}

export function libraryUnavailableReason(
  track: Track,
  passingProviders: ReadonlySet<string>,
  requireLocal = false,
): string | undefined {
  if (localPlaybackReference(track)) return undefined;
  if (requireLocal || track.provider === 'custom')
    return '本地文件不可用或尚未下载完成';
  if (!passingProviders.has(track.provider)) return '该平台不可用';
  if (!isCatalogTrackEligible(track) || isRuntimeTrackBlocked(track))
    return '该歌曲已确认无法播放';
  return undefined;
}

export function libraryLocalPlaybackFailure(track: Track, error: unknown) {
  if (!localPlaybackReference(track)) return null;
  const code = String((error as { code?: unknown })?.code ?? '');
  if (code === 'LOCAL_FILE_PERMISSION')
    return '没有本地文件读取权限，请重新选择音乐目录';
  if (code === 'LOCAL_FILE_MISSING')
    return '本地音频文件已移动或删除，请重新添加或下载';
  if (code.startsWith('LOCAL_') || error instanceof Error)
    return (
      (error as { message?: string }).message ||
      '本地音频文件无法播放，请重新添加或下载'
    );
  return '本地音频文件无法播放，请重新添加或下载';
}

export async function resolveLocalPlaybackReference(
  reference: string,
  queryDownload: (token: string) => Promise<DownloadStatus>,
): Promise<string> {
  if (isLocalAudioUri(reference)) return reference;
  if (/^download:\d+$/.test(reference)) {
    const result = await queryDownload(reference);
    if (result.status === 'downloaded' && isLocalAudioUri(result.localUri))
      return result.localUri;
    throw Object.assign(new Error('本地音频文件不可用，请重新添加或下载'), {
      code: result.status === 'failed' ? 'LOCAL_FILE_MISSING' : 'LOCAL_DOWNLOAD_PENDING',
    });
  }
  throw new Error('本地音频文件不可用，请重新添加或下载');
}

export function validateLocalPlaybackAudio(
  track: Track,
  audio: AudioProbeResult,
) {
  if (
    !Number.isFinite(audio.durationSeconds) ||
    audio.durationSeconds < MIN_PLAYABLE_DURATION_SECONDS ||
    (track.provider !== 'custom' &&
      audio.durationSeconds < track.duration * MIN_ACTUAL_TO_CATALOG_RATIO)
  ) {
    throw new Error('本地音频文件不完整或无法读取，请重新添加或下载');
  }
}
