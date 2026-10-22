import { trackQueueKey, type Track } from '../domain/types';
import type { PreparedTrack } from './playbackPreparation';

type Entry = {
  preference: string;
  status: 'running' | 'ready';
  result?: PreparedTrack;
  request?: Promise<PreparedTrack>;
};

/** Shares foreground validation with the cancellable, contiguous next-two plan. */
export class PlayerQueuePreparation {
  private readonly entries = new Map<string, Entry>();
  private backgroundVersion = 0;

  reset() {
    this.pause();
    this.entries.clear();
  }

  pause() { this.backgroundVersion += 1; }

  async prepareNext(
    tracks: Track[],
    preference: string,
    isReady: (track: Track) => boolean,
    prepare: (track: Track) => Promise<PreparedTrack>,
    commit: (track: PreparedTrack, active: () => boolean) => Promise<boolean>,
    isCurrent = () => true,
  ) {
    const version = ++this.backgroundVersion;
    const active = () => version === this.backgroundVersion && isCurrent();
    for (const track of tracks.slice(0, 2)) {
      if (!active() || !isReady(track)) return;
      try {
        const result = await this.select(track, preference, () => prepare(track));
        if (!active() || !await commit(result, active)) return;
      } catch { return; }
    }
  }

  select(
    track: Track,
    preference: string,
    prepare: () => Promise<PreparedTrack>,
  ) {
    const key = trackQueueKey(track);
    const existing = this.entries.get(key);
    if (existing?.preference === preference) {
      if (existing.status === 'ready') return Promise.resolve(existing.result!);
      if (existing.status === 'running') return existing.request!;
    }

    const entry: Entry = { preference, status: 'running' };
    this.entries.set(key, entry);
    const request = Promise.resolve()
      .then(prepare)
      .then(result => {
        if (this.entries.get(key) === entry) {
          entry.status = 'ready';
          entry.result = result;
        }
        return result;
      }, error => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    entry.request = request;
    return request;
  }
}
