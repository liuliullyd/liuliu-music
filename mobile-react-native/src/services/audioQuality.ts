import type { PlaybackQuality } from '../domain/types';
import { normalizeReturnedQuality, returnedQualityLabel } from '../domain/types';
import type { AudioProbeResult } from './trackPlaybackPolicy';

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** User-approved technical buckets; missing evidence never supplies a default tier. */
function measuredQuality(value: unknown): PlaybackQuality | undefined {
  const audio = value as AudioProbeResult | undefined;
  const mime = typeof audio?.mimeType === 'string' ? audio.mimeType.toLowerCase() : '';
  if (!mime?.startsWith('audio/')) return undefined;
  if (['flac', 'alac', 'raw', 'pcm'].some(codec => mime.includes(codec))) {
    if (!positive(audio?.bitsPerSample)) return undefined;
    if (audio.bitsPerSample < 24) return 'flac';
    if (!positive(audio.sampleRate)) return undefined;
    return audio.sampleRate > 48000 ? 'hires' : 'flac24bit';
  }
  if (!positive(audio?.bitrate)) return undefined;
  return audio.bitrate >= 256000 ? '320k' : '128k';
}

/** Native evidence first; an explicit response tier is the only permitted fallback. */
export function audioQuality(value: unknown, reportedQuality?: unknown): PlaybackQuality | undefined {
  return measuredQuality(value) ?? normalizeReturnedQuality(reportedQuality);
}

const orderedQualities: PlaybackQuality[] = ['128k', '320k', 'flac', 'flac24bit', 'hires'];

/** The selected setting is a ceiling; an over-tier response must be retried. */
export function audioQualityForPreference(value: unknown, reportedQuality: unknown, preferred: PlaybackQuality) {
  const actual = audioQuality(value, reportedQuality);
  if (actual && orderedQualities.indexOf(actual) > orderedQualities.indexOf(preferred))
    throw new Error(`音源实际音质${returnedQualityLabel(actual)}超过所选${returnedQualityLabel(preferred)}，未采用该地址`);
  return actual;
}
