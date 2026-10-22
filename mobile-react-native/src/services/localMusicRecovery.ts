import { trackQueueKey, type DownloadEntry, type PersistedState, type Track } from '../domain/types';
import { trackMediaKind } from './mediaLibrary';
import { isLocalAudioUri, localPlaybackReference, resolveLocalPlaybackReference, validateLocalPlaybackAudio } from './libraryPlayback';
import type { DownloadStatus } from './storage';
import type { AudioProbeResult } from './trackPlaybackPolicy';

interface RecoveryAdapters {
  query: (id: string) => Promise<DownloadStatus>;
  probe: (uri: string) => Promise<AudioProbeResult>;
  download: (track: Track) => Promise<string>;
  update: (previous: DownloadEntry, replacement: DownloadEntry) => void;
  wait?: () => Promise<void>;
}

/** A selected missing music download may recover only its exact provider/ID. */
export async function recoverMissingMusicDownload(
  track: Track,
  state: PersistedState,
  failure: unknown,
  adapters: RecoveryAdapters,
) {
  if (trackMediaKind(track) !== 'music' || track.provider === 'custom' ||
    (failure as { code?: string })?.code !== 'LOCAL_FILE_MISSING') throw failure;
  const key = trackQueueKey(track);
  const entry = state.downloads.find(item => item.status === 'downloaded' && trackQueueKey(item.track) === key);
  if (!entry) throw failure;
  const oldReference = localPlaybackReference(track);
  const references = new Set([
    /^download:\d+$/.test(entry.id) || isLocalAudioUri(entry.id) ? entry.id : null,
    localPlaybackReference(entry.track),
    ...state.localTracks.filter(item => trackQueueKey(item) === key).map(localPlaybackReference),
  ]);
  for (const reference of references) {
    if (!reference || reference === oldReference) continue;
    try {
      const uri = await resolveLocalPlaybackReference(reference, adapters.query);
      const audio = await adapters.probe(uri);
      validateLocalPlaybackAudio(track, audio);
      adapters.update(entry, repairedEntry(entry, entry.id, uri));
      return { uri, audio, reference: uri };
    } catch (error) {
      // Permission, invalid audio and transient errors must not trigger a download.
      if ((error as { code?: string })?.code !== 'LOCAL_FILE_MISSING') throw error;
    }
  }
  const metadata = { ...track.metadata };
  for (const field of ['_libraryLocalFile', '_libraryLocalFileIdentity', '_playbackAudio',
    '_playbackQuality', '_playbackPreference', '_playerPreparationSource']) delete metadata[field];
  const id = await adapters.download({ ...track, playUrl: undefined, metadata });
  let uri = isLocalAudioUri(id) ? id : undefined;
  let previous = entry;
  if (!uri) {
    const queued: DownloadEntry = { ...entry, id, status: 'queued', localLibrarySynced: false,
      track: { ...entry.track, playUrl: undefined, metadata: { ...entry.track.metadata, _libraryLocalFile: id } } };
    adapters.update(previous, queued);
    previous = queued;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await adapters.query(id);
      if (status.status === 'failed') throw new Error('恢复下载失败，请重新下载该歌曲');
      if (status.status === 'downloaded' && isLocalAudioUri(status.localUri)) {
        uri = status.localUri;
        break;
      }
      await (adapters.wait?.() ?? new Promise<void>(resolve => setTimeout(resolve, 1000)));
    }
  }
  if (!uri) throw new Error('恢复下载仍在进行，请下载完成后再次播放');
  const audio = await adapters.probe(uri);
  validateLocalPlaybackAudio(track, audio);
  adapters.update(previous, repairedEntry(entry, id, uri));
  return { uri, audio, reference: uri };
}

function repairedEntry(entry: DownloadEntry, id: string, uri: string): DownloadEntry {
  return { ...entry, id, status: 'downloaded', localLibrarySynced: true,
    track: { ...entry.track, playUrl: uri, metadata: { ...entry.track.metadata, _libraryLocalFile: uri } } };
}

/** Update existing records only; a deleted row or a newer download wins. */
export function replaceRecoveredMusicDownload(
  state: PersistedState,
  previous: DownloadEntry,
  replacement: DownloadEntry,
): PersistedState {
  const key = trackQueueKey(previous.track);
  if (!state.downloads.some(entry => entry.id === previous.id && trackQueueKey(entry.track) === key)) return state;
  const references = new Set([previous.id, localPlaybackReference(previous.track)]);
  const reference = localPlaybackReference(replacement.track);
  return {
    ...state,
    downloads: state.downloads.map(entry => entry.id === previous.id && trackQueueKey(entry.track) === key ? replacement : entry),
    localTracks: state.localTracks.map(track => trackQueueKey(track) === key && references.has(localPlaybackReference(track))
      ? { ...track, playUrl: replacement.track.playUrl, metadata: { ...track.metadata, _libraryLocalFile: reference } }
      : track),
  };
}
