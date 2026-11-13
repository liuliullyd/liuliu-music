import type { Track } from '../domain/types';
import { trackMediaKind } from './mediaLibrary';
import { isRecommendationMusicTrack } from './recommendationContentPolicy';

export const MIN_PLAYABLE_DURATION_SECONDS = 35;
export const MIN_ACTUAL_TO_CATALOG_RATIO = 0.5;

export interface AudioProbeResult {
  durationSeconds: number;
  /** Native startup-only evidence: a decoded/readable frame was found after this time. */
  verifiedThroughSeconds?: number;
  /** Final URL after the native HTTP probe followed redirects and passed all gates. */
  resolvedUrl?: string;
  mimeType?: string;
  bitrate?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  sampleBytes?: number;
  message?: string;
}

export type DeterministicTrackFailure =
  | 'unsupported-content'
  | 'catalog-short'
  | 'actual-short'
  | 'duration-mismatch'
  | 'no-audio-track'
  | 'duration-unreadable'
  | 'no-audio-frames';

export class TrackPlaybackRejectedError extends Error {
  readonly code = 'TRACK_PLAYBACK_REJECTED';

  constructor(
    readonly trackKey: string,
    readonly reason: DeterministicTrackFailure,
    message = '该歌曲为试听片段，已从列表移除',
  ) {
    super(message);
    this.name = 'TrackPlaybackRejectedError';
  }
}

const blockedTracks = new Map<string, DeterministicTrackFailure>();
const listeners = new Set<() => void>();

export const runtimeTrackKey = (track: Track) =>
  `${track.provider}:${track.providerId ?? track.id}`;

export function isCatalogTrackEligible(track: Track) {
  return (
    isRecommendationMusicTrack(track) &&
    (track.provider === 'custom' ||
      (Number.isFinite(track.duration) &&
        track.duration >= MIN_PLAYABLE_DURATION_SECONDS))
  );
}

export function isRuntimeTrackBlocked(track: Track) {
  return blockedTracks.has(runtimeTrackKey(track));
}

export function throwIfRuntimeTrackBlocked(track: Track) {
  if (!isRecommendationMusicTrack(track))
    return rejectTrack(track, 'unsupported-content', '当前版本仅支持音乐');
  const key = runtimeTrackKey(track);
  const reason = blockedTracks.get(key);
  if (!reason) return;
  throw new TrackPlaybackRejectedError(
    key,
    reason,
    trackMediaKind(track) === 'music'
      ? reason === 'catalog-short'
        ? '该歌曲目录时长不足 35 秒，已从列表移除'
        : '该歌曲已确认没有可播放的音频，已从列表移除'
      : undefined,
  );
}

export function filterPlayableCandidates(tracks: Track[]) {
  return tracks.filter(
    track => isCatalogTrackEligible(track) && !isRuntimeTrackBlocked(track),
  );
}

export function rejectCatalogShortTrack(track: Track): never {
  if (!isRecommendationMusicTrack(track))
    return rejectTrack(track, 'unsupported-content', '当前版本仅支持音乐');
  return rejectTrack(
    track,
    'catalog-short',
    trackMediaKind(track) === 'music'
      ? '该歌曲目录时长不足 35 秒，已从列表移除'
      : undefined,
  );
}

export function validateResolvedAudio(
  track: Track,
  probe: AudioProbeResult,
  recordFailure = true,
) {
  if (!isRecommendationMusicTrack(track))
    return rejectTrack(track, 'unsupported-content', '当前版本仅支持音乐');
  const actual = Number(probe.durationSeconds);
  if (!Number.isFinite(actual) || actual <= 0)
    return rejectTrack(
      track,
      'duration-unreadable',
      '该歌曲无法读取音频时长，已从列表移除',
      recordFailure,
    );
  if (track.provider === 'custom' || trackMediaKind(track) !== 'music') {
    if (actual < MIN_PLAYABLE_DURATION_SECONDS)
      return rejectTrack(track, 'actual-short', undefined, recordFailure);
    if (
      Number.isFinite(track.duration) &&
      track.duration >= MIN_PLAYABLE_DURATION_SECONDS &&
      actual < track.duration * MIN_ACTUAL_TO_CATALOG_RATIO
    )
      return rejectTrack(track, 'duration-mismatch', undefined, recordFailure);
  }
  return probe;
}

export function rejectDeterministicNativeFailure(
  track: Track,
  error: unknown,
  recordFailure = true,
) {
  if (error instanceof TrackPlaybackRejectedError)
    return rejectTrack(track, error.reason, error.message, recordFailure);
  const code = String((error as { code?: unknown })?.code ?? '');
  const reason: DeterministicTrackFailure | null =
    code === 'AUDIO_NO_TRACK'
      ? 'no-audio-track'
      : code === 'AUDIO_DURATION_UNREADABLE'
      ? 'duration-unreadable'
      : code === 'AUDIO_NO_FRAMES'
      ? 'no-audio-frames'
      : null;
  if (!reason) return false;
  rejectTrack(
    track,
    reason,
    reason === 'no-audio-track'
      ? '该歌曲没有可播放的音频轨道，已从列表移除'
      : '该歌曲无法读取有效音频，已从列表移除',
    recordFailure,
  );
}

export function isTrackPlaybackRejected(error: unknown) {
  return (
    error instanceof TrackPlaybackRejectedError ||
    (error as { code?: unknown })?.code === 'TRACK_PLAYBACK_REJECTED'
  );
}

export function subscribeRuntimeTrackBlacklist(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearRuntimeTrackBlacklist() {
  if (!blockedTracks.size) return;
  blockedTracks.clear();
  listeners.forEach(listener => listener());
}

function rejectTrack(
  track: Track,
  reason: DeterministicTrackFailure,
  message?: string,
  recordFailure = true,
): never {
  const key = runtimeTrackKey(track);
  const changed = recordFailure && !blockedTracks.has(key);
  if (recordFailure) blockedTracks.set(key, reason);
  if (changed) listeners.forEach(listener => listener());
  throw new TrackPlaybackRejectedError(key, reason, message);
}
