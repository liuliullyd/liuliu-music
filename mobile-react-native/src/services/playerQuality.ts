import { returnedQualityLabel, type Track } from '../domain/types';
import { audioQuality } from './audioQuality';

/** Display only technical evidence for the current URL, including validated prewarm. */
export function playerQuality(track: Track | null) {
  const metadata = track?.metadata;
  const audio = metadata?._prewarmedUrl === true
    ? metadata._prewarmedAudio
    : metadata?._playbackAudio;
  const reported = metadata?._prewarmedUrl === true
    ? metadata._prewarmedReportedQuality
    : metadata?._playbackReportedQuality;
  const value = audioQuality(audio, reported);
  const label = track ? returnedQualityLabel(value) || '未知' : '';
  return { value, label, description: label ? '当前音质：' + label : '' };
}
