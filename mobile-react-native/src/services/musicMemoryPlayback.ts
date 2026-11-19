import { trackQueueKey, type NativePlayerState, type Track } from '../domain/types';
import { MEMORY_MINIMUM_LISTENED_SECONDS } from './musicPreferenceStatistics';

/** Native qualification survives seeks, background playback and transitions between JS polls. */
export class MusicMemoryPlaybackRecorder {
  private tracks = new Map<string, Track>();
  private consumed = new Set<number>();

  confirm(track: Track) {
    const mediaType = String(track.metadata?.mediaType ?? '').toLowerCase();
    if (mediaType === 'podcast' || mediaType === 'audiobook' || mediaType === 'long-audio') return;
    const key = trackQueueKey(track);
    this.tracks.delete(key);
    this.tracks.set(key, track);
    while (this.tracks.size > 100) this.tracks.delete(this.tracks.keys().next().value!);
  }

  observe(listening: NativePlayerState['listening']): Track[] {
    if (!listening) return [];
    const result: Track[] = [];
    for (const play of listening.qualified ?? []) {
      if (!Number.isSafeInteger(play.sequence) || play.sequence <= 0 ||
          !Number.isFinite(play.seconds) || play.seconds < MEMORY_MINIMUM_LISTENED_SECONDS ||
          this.consumed.has(play.sequence)) continue;
      const track = this.tracks.get(play.mediaId);
      if (!track) continue;
      this.consumed.add(play.sequence);
      result.push(track);
    }
    // Native retains the last 100 qualifications; keep extra room for event/read overlap.
    while (this.consumed.size > 200) this.consumed.delete(this.consumed.values().next().value!);
    return result;
  }
}
