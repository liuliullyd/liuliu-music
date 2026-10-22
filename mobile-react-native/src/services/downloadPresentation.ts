import {
  returnedQualityLabel,
  normalizeReturnedQuality,
  trackQueueKey,
  type DownloadEntry,
  type LibraryMediaKind,
  type PlaybackQuality,
  type Track,
} from '../domain/types';
import { trackMediaKind } from './mediaLibrary';
import { requiresQishuiCompleteness, validateQishuiAudioCompleteness, type AudioProbeResult } from './trackPlaybackPolicy';
import { audioQuality } from './audioQuality';

export interface DownloadPreview {
  trackKey: string;
  preferredQuality: PlaybackQuality;
  /** The exact URL whose headers and native audio evidence were previewed. */
  url?: string;
  quality?: PlaybackQuality;
  reportedQuality?: PlaybackQuality;
  audio?: AudioProbeResult;
  sizeBytes?: number;
}
export interface DownloadActivity {
  id: string;
  track: Track;
  createdAt: number;
  phase: 'preparing' | 'queued' | 'downloading' | 'downloaded' | 'failed';
  bytesDownloaded?: number;
  totalBytes?: number;
  fileSize?: number;
  reason?: string;
  token?: string;
  preferredQuality?: PlaybackQuality;
  quality?: PlaybackQuality;
}
export const downloadTrackKey = (track: Track) =>
  `${trackMediaKind(track)}:${trackQueueKey(track)}`;
/** A player download keeps the exact validated stream selected when it was opened. */
export function playbackDownloadSource(track: Track) {
  const audio = track.metadata?._playbackAudio as AudioProbeResult | undefined;
  if (!track.playUrl || !/^https?:\/\//i.test(track.playUrl) ||
      track.metadata?._prewarmedUrl === true || !audio ||
      !Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0 ||
      (audio.resolvedUrl !== undefined && audio.resolvedUrl !== track.playUrl))
    throw new Error('当前歌曲尚无已验证的播放地址，请播放后再下载');
  if (requiresQishuiCompleteness(track)) {
    if (audio.resolvedUrl !== track.playUrl)
      throw new Error('当前歌曲尚无同地址的完整音频证据，请播放后再下载');
    validateQishuiAudioCompleteness(track, audio);
  }
  const reportedQuality = normalizeReturnedQuality(track.metadata?._playbackReportedQuality);
  return { url: track.playUrl, audio, reportedQuality,
    quality: audioQuality(audio, reportedQuality) };
}
export const positiveBytes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
export function downloadQualityText(track: Track, preview?: DownloadPreview) {
  return preview?.trackKey === downloadTrackKey(track)
    ? returnedQualityLabel(audioQuality(preview.audio, preview.reportedQuality)) || '未知'
    : '';
}
export function formatFileSize(bytes: unknown) {
  const value = positiveBytes(bytes);
  if (!value) return '大小暂不可读';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
export function downloadStatusText(
  entry: DownloadEntry,
  activity?: DownloadActivity,
) {
  const phase = activity?.phase ?? entry.status;
  if (phase === 'preparing') return '准备下载';
  const quality = returnedQualityLabel(activity ? activity.quality : entry.quality) || '未知';
  const suffix = quality ? ` · ${quality}` : '';
  if (phase === 'downloaded')
    return `${formatFileSize(entry.fileSize ?? activity?.fileSize)}${suffix}`;
  if (phase === 'failed') return '下载失败';
  const total = positiveBytes(activity?.totalBytes);
  const received = Math.max(0, activity?.bytesDownloaded ?? 0);
  if (total)
    return `下载中 ${Math.min(99, Math.floor((received / total) * 100))}% · ${
      received === 0 ? '0 B' : formatFileSize(received)
    } / ${formatFileSize(total)}${suffix}`;
  return received > 0 ? `下载中 · ${formatFileSize(received)}${suffix}` : `等待下载${suffix}`;
}
/** Activities are display-only; pending rows never enter playback or persistence. */
export function downloadRecordRows(
  entries: DownloadEntry[],
  activities: DownloadActivity[],
  kind: LibraryMediaKind,
) {
  const relevant = activities.filter(
    item => trackMediaKind(item.track) === kind,
  );
  const activityKeys = new Set(
    relevant.map(item => downloadTrackKey(item.track)),
  );
  return [
    ...relevant
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(item => {
        const saved = entries.find(
          entry =>
            downloadTrackKey(entry.track) === downloadTrackKey(item.track),
        );
        return item.phase === 'downloaded' && saved
          ? saved
          : {
              id: item.token ?? item.id,
              track: item.track,
              status:
                item.phase === 'failed'
                  ? ('failed' as const)
                  : ('queued' as const),
              createdAt: item.createdAt,
              fileSize: item.fileSize,
              quality: item.quality,
            };
      }),
    ...entries.filter(
      entry => !activityKeys.has(downloadTrackKey(entry.track)),
    ),
  ];
}
