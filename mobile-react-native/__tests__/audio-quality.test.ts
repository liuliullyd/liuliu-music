import { audioQuality, audioQualityForPreference } from '../src/services/audioQuality';
import { playerQuality } from '../src/services/playerQuality';
import { downloadQualityText, downloadStatusText } from '../src/services/downloadPresentation';
import { defaultState, normalizeState, serializePersistedState } from '../src/services/storage';
import type { Track, DownloadEntry } from '../src/domain/types';

const track = { id: 'quality', provider: 'qq', title: '歌', artist: '艺人' } as Track;
const tiers = [
  [{ mimeType: 'audio/mpeg', bitrate: 128000 }, '128k', '标清'],
  [{ mimeType: 'audio/aac', bitrate: 255999 }, '128k', '标清'],
  [{ mimeType: 'audio/mpeg', bitrate: 256000 }, '320k', '高清'],
  [{ mimeType: 'audio/mpeg', bitrate: 320000 }, '320k', '高清'],
  [{ mimeType: 'audio/flac', bitsPerSample: 16, sampleRate: 44100 }, 'flac', '无损'],
  [{ mimeType: 'audio/alac', bitsPerSample: 24, sampleRate: 48000 }, 'flac24bit', '至臻'],
  [{ mimeType: 'audio/raw', bitsPerSample: 24, sampleRate: 48001 }, 'hires', '母带'],
  [{ mimeType: 'audio/flac', bitsPerSample: 24, sampleRate: 96000 }, 'hires', '母带'],
  [{ mimeType: 'audio/pcm', bitsPerSample: 32, sampleRate: 192000 }, 'hires', '母带'],
] as const;
test.each(['128k', '320k', 'flac', 'flac24bit', 'hires'] as const)('selected %s is the actual-tier ceiling while lower fallback remains allowed', preferred => {
  const ordered = ['128k', '320k', 'flac', 'flac24bit', 'hires'] as const;
  for (const actual of ordered) {
    if (ordered.indexOf(actual) > ordered.indexOf(preferred))
      expect(() => audioQualityForPreference(undefined, actual, preferred)).toThrow('超过所选');
    else expect(audioQualityForPreference(undefined, actual, preferred)).toBe(actual);
  }
  expect(audioQualityForPreference(undefined, undefined, preferred)).toBeUndefined();
});
test('native technical evidence determines the ceiling check before a misleading platform label', () => {
  expect(audioQualityForPreference({ mimeType: 'audio/mpeg', bitrate: 320000 }, 'flac24bit', '320k')).toBe('320k');
  expect(() => audioQualityForPreference({ mimeType: 'audio/flac', bitsPerSample: 24, sampleRate: 48000 }, '320k', '320k')).toThrow('至臻超过所选高清');
});
test.each(tiers)('technical evidence %j determines %s consistently across all results', (audio, value, label) => {
  expect(audioQuality(audio)).toBe(value);
  expect(playerQuality({ ...track, metadata: { _playbackQuality: 'hires', _playbackPreference: 'hires', _playbackAudio: audio } })).toMatchObject({ value, label, description: `当前音质：${label}` });
  expect(playerQuality({ ...track, metadata: { _prewarmedUrl: true, _prewarmedQuality: '128k', _prewarmedAudio: audio } })).toMatchObject({ value, label });
  expect(downloadQualityText(track, { trackKey: 'music:qq:quality', preferredQuality: 'hires', quality: '128k', audio: { durationSeconds: 180, ...audio } })).toBe(label);
});
test.each([
  undefined, {}, { mimeType: 'audio/flac' }, { mimeType: 'audio/flac', bitsPerSample: 24 },
  { mimeType: 'audio/flac', bitsPerSample: 0, sampleRate: 96000 },
  { mimeType: 'audio/flac', bitsPerSample: 24, sampleRate: NaN },
  { mimeType: 'audio/mpeg' }, { mimeType: 'audio/mpeg', bitrate: 0 },
  { mimeType: 'audio/mpeg', bitrate: Infinity }, { mimeType: 'video/mp4', bitrate: 320000 },
])('incomplete evidence %j never becomes a fallback label', audio => {
  expect(audioQuality(audio)).toBeUndefined();
  expect(playerQuality({ ...track, metadata: { _playbackQuality: 'hires', _playbackPreference: 'hires', _playbackAudio: audio } })).toMatchObject({ value: undefined, label: '未知', description: '当前音质：未知' });
  expect(downloadQualityText(track, { trackKey: 'music:qq:quality', preferredQuality: 'hires', quality: 'hires', audio: audio as any })).toBe('未知');
});
test('completed download persists the technical tier and observed size without depending on later playback or settings', () => {
  const entry: DownloadEntry = { id: 'content://downloads/42', track, status: 'downloaded', createdAt: 1, fileSize: 8388608, quality: 'flac' };
  const saved = normalizeState(JSON.parse(serializePersistedState({ ...defaultState(), downloads: [entry] })));
  expect(downloadStatusText(saved.downloads[0])).toBe('8.00 MB · 无损');
  expect(downloadStatusText({ ...entry, quality: undefined })).toBe('8.00 MB · 未知');
});

test.each([
  ['128k', '标清'], ['320k', '高清'], ['flac', '无损'], ['flac24bit', '至臻'], ['hires', '母带'],
] as const)('incomplete technical evidence falls back to explicit platform %s or %s only', (raw, label) => {
  for (const reported of [raw, label]) {
    expect(audioQuality({ mimeType: 'audio/flac' }, reported)).toBe(raw);
    expect(audioQuality(undefined, reported)).toBe(raw);
    expect(audioQuality({ mimeType: 'audio/mpeg', bitrate: 128000 }, reported)).toBe('128k');
    expect(playerQuality({ ...track, metadata: { _playbackReportedQuality: reported, _playbackAudio: { mimeType: 'audio/flac' } } }).label).toBe(label);
    expect(downloadQualityText(track, { trackKey: 'music:qq:quality', preferredQuality: 'hires', reportedQuality: reported as any })).toBe(label);
  }
});

test('reported playback and prewarm fields remain process-only while download size and tier persist', () => {
  const state = defaultState();
  state.savedTracks = [
    { ...track, metadata: { _prewarmedUrl: true, _prewarmedReportedQuality: 'hires' } },
    { ...track, id: 'playing', metadata: { _playerPreparationSource: 'source-version', _playbackReportedQuality: 'flac' } },
  ];
  const stored = serializePersistedState(state);
  expect(stored).not.toContain('_prewarmedReportedQuality');
  expect(stored).not.toContain('_playbackReportedQuality');
});
