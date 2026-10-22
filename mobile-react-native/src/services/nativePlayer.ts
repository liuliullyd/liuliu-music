import { NativeEventEmitter, NativeModules } from 'react-native';
import { trackQueueKey } from '../domain/types';
import type { NativePlayerState, Track } from '../domain/types';
import { AudioEffectStateManager } from './audioEffectState';
import type { AudioEffectConfiguration } from './audioEffectState';

const module = NativeModules.LiuliuPlayer as
  | undefined
  | {
      loadQueue: (
        tracks: object[],
        index: number,
        play: boolean,
        position: number,
      ) => Promise<void>;
      play: () => Promise<void>;
      pause: () => Promise<void>;
      stop: () => Promise<void>;
      playIndex: (index: number, position: number) => Promise<void>;
      appendQueue: (tracks: object[]) => Promise<void>;
      replaceQueueItem: (index: number, track: object) => Promise<void>;
      removeQueueItem: (index: number) => Promise<void>;
      removePreparedQueueItem?: (currentId: string, targetId: string, index: number) => Promise<boolean>;
      reorderQueue: (currentId: string, mediaIds: string[]) => Promise<void>;
      insertQueueAroundCurrent: (
        currentId: string,
        before: object[],
        after: object[],
      ) => Promise<void>;
      insertQueueItems?: (
        currentId: string,
        index: number,
        tracks: object[],
      ) => Promise<void>;
      seek: (seconds: number) => Promise<void>;
      replaceCurrent: (
        track: object,
        position: number,
        play: boolean,
      ) => Promise<void>;
      replaceExpiredUrl: (
        token: string,
        track: object,
        nativeFallback: boolean,
      ) => Promise<void>;
      failExpiredUrlRecovery: (
        token: string,
        nativeFallback: boolean,
      ) => Promise<void>;
      setVolume: (value: number) => Promise<void>;
      setAutoNext: (enabled: boolean) => Promise<void>;
      setShuffle: (enabled: boolean) => Promise<void>;
      setRepeatMode: (mode: string) => Promise<void>;
      setNormalize: (enabled: boolean) => Promise<void>;
      setAudioFocus: (enabled: boolean) => Promise<void>;
      setEqualizer: (preset: string) => Promise<void>;
      setCustomEqualizer: (gains: number[], configuration: AudioEffectConfiguration) => Promise<void>;
      getState: () => Promise<NativePlayerState>;
      setSleepTimer: (mode: string, minutes: number) => Promise<void>;
      cancelSleepTimer: () => Promise<void>;
    };
let fallback: NativePlayerState = {
  playing: false,
  index: 0,
  position: 0,
  duration: 0,
  volume: 0.72,
  sleepMode: 'off',
};
export const nativePlayer = {
  available: Boolean(module),
  async loadQueue(
    tracks: (Track & { playUrl: string })[],
    index: number,
    play = true,
    position = 0,
  ) {
    position = Number.isFinite(position) ? Math.max(0, position) : 0;
    if (!module) {
      fallback = {
        ...fallback,
        index,
        playing: play,
        duration: tracks[index]?.duration ?? 0,
        position,
      };
      return;
    }
    await module.loadQueue(
      tracks.map(track => ({
        id: track.id,
        mediaId: trackQueueKey(track),
        title: track.title,
        artist: track.artist,
        album: track.album,
        url: track.playUrl,
        artwork: track.cover ?? '',
        playbackPreference: track.metadata?._playbackPreference ?? '',
      })),
      index,
      play,
      position,
    );
  },
  async play() {
    if (module) await module.play();
    else fallback.playing = true;
  },
  async pause() {
    if (module) await module.pause();
    else fallback.playing = false;
  },
  async stop() {
    if (module) await module.stop();
    else fallback = { ...fallback, playing: false, position: 0 };
  },
  async playIndex(index: number, position = 0) {
    position = Number.isFinite(position) ? Math.max(0, position) : 0;
    if (module) await module.playIndex(index, position);
    else fallback = { ...fallback, index, playing: true, position };
  },
  async appendQueue(tracks: (Track & { playUrl: string })[]) {
    if (!module) return;
    await module.appendQueue(
      tracks.map(track => ({
        id: track.id,
        mediaId: trackQueueKey(track),
        title: track.title,
        artist: track.artist,
        album: track.album,
        url: track.playUrl,
        artwork: track.cover ?? '',
        playbackPreference: track.metadata?._playbackPreference ?? '',
      })),
    );
  },
  async replaceQueueItem(index: number, track: Track & { playUrl: string }) {
    if (!module) return;
    await module.replaceQueueItem(index, {
      id: track.id,
      mediaId: trackQueueKey(track),
      title: track.title,
      artist: track.artist,
      album: track.album,
      url: track.playUrl,
      artwork: track.cover ?? '',
      playbackPreference: track.metadata?._playbackPreference ?? '',
    });
  },
  async reorderQueue(currentId: string, mediaIds: string[]) {
    if (module) await module.reorderQueue(currentId, mediaIds);
  },
  async removeQueueItem(index: number) {
    if (module) await module.removeQueueItem(index);
    else if (fallback.index > index)
      fallback = { ...fallback, index: fallback.index - 1 };
  },
  async removePreparedQueueItem(currentId: string, targetId: string, index: number) {
    if (!module?.removePreparedQueueItem) return false;
    return await module.removePreparedQueueItem(currentId, targetId, index) === true;
  },
  async insertQueueAroundCurrent(
    currentId: string,
    before: (Track & { playUrl: string })[],
    after: (Track & { playUrl: string })[],
  ) {
    if (!module) {
      fallback = { ...fallback, index: before.length };
      return;
    }
    const serialize = (track: Track & { playUrl: string }) => ({
      id: track.id,
      mediaId: trackQueueKey(track),
      title: track.title,
      artist: track.artist,
      album: track.album,
      url: track.playUrl,
      artwork: track.cover ?? '',
      playbackPreference: track.metadata?._playbackPreference ?? '',
    });
    await module.insertQueueAroundCurrent(
      currentId,
      before.map(serialize),
      after.map(serialize),
    );
  },
  async insertQueueItems(
    currentId: string,
    index: number,
    tracks: (Track & { playUrl: string })[],
  ) {
    if (!module) return;
    if (!module.insertQueueItems) return;
    await module.insertQueueItems(
      currentId,
      index,
      tracks.map(track => ({
        id: track.id,
        mediaId: trackQueueKey(track),
        title: track.title,
        artist: track.artist,
        album: track.album,
        url: track.playUrl,
        artwork: track.cover ?? '',
        playbackPreference: track.metadata?._playbackPreference ?? '',
      })),
    );
  },
  async seek(value: number) {
    if (module) await module.seek(value);
    else fallback.position = value;
  },
  async replaceCurrent(
    track: Track & { playUrl: string },
    position: number,
    play: boolean,
  ) {
    if (!module) {
      fallback = { ...fallback, position, playing: play };
      return;
    }
    await module.replaceCurrent(
      {
        id: track.id,
        mediaId: trackQueueKey(track),
        title: track.title,
        artist: track.artist,
        album: track.album,
        url: track.playUrl,
        artwork: track.cover ?? '',
        playbackPreference: track.metadata?._playbackPreference ?? '',
      },
      position,
      play,
    );
  },
  async replaceExpiredUrl(
    token: string,
    track: Track & { playUrl: string },
    nativeFallback: boolean,
  ) {
    if (!module) throw new Error('播放地址恢复不可用');
    await module.replaceExpiredUrl(
      token,
      {
        id: track.id,
        mediaId: trackQueueKey(track),
        title: track.title,
        artist: track.artist,
        album: track.album,
        url: track.playUrl,
        artwork: track.cover ?? '',
        playbackPreference: track.metadata?._playbackPreference ?? '',
      },
      nativeFallback,
    );
  },
  async failExpiredUrlRecovery(token: string, nativeFallback: boolean) {
    if (module) await module.failExpiredUrlRecovery(token, nativeFallback);
  },
  async setVolume(value: number) {
    if (module) await module.setVolume(value);
    else fallback.volume = value;
  },
  async setAutoNext(enabled: boolean) {
    if (module) await module.setAutoNext(enabled);
  },
  async setShuffle(enabled: boolean) {
    if (module) await module.setShuffle(enabled);
  },
  async setRepeatMode(mode: 'off' | 'all' | 'one') {
    if (module) await module.setRepeatMode(mode);
  },
  async setNormalize(enabled: boolean) {
    if (module) await module.setNormalize(enabled);
  },
  async setAudioFocus(enabled: boolean) {
    if (module) await module.setAudioFocus(enabled);
  },
  async setEqualizer(preset: string, gains?: number[], configuration?: AudioEffectConfiguration) {
    if (!module) return;
    if (preset === 'Custom')
      await module.setCustomEqualizer(gains ?? Array(10).fill(0), configuration ?? AudioEffectStateManager.configuration());
    else await module.setEqualizer(preset);
  },
  async getState() {
    return module ? module.getState() : fallback;
  },
  async waitForPlaybackStart(
    timeoutMs = 15_000,
    mediaId?: string,
    signal?: AbortSignal,
  ) {
    if (!module) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const acceptState = (state: NativePlayerState) => {
        if (mediaId && state.mediaId !== mediaId) return;
        const recovery = state.urlRecovery;
        if (
          recovery &&
          recovery.mediaId === state.mediaId &&
          recovery.status !== 'failed'
        )
          return;
        if (state.error) finish(new Error(state.error));
        else if (state.playing) finish();
      };
      const event = new NativeEventEmitter(
        NativeModules.LiuliuPlayer,
      ).addListener('playbackState', acceptState);
      const timer = setTimeout(
        () => finish(new Error('等待歌曲实际播放超时')),
        timeoutMs,
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        event.remove();
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish(new Error('Player request superseded'));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      module
        .getState()
        .then(acceptState, error =>
          finish(error instanceof Error ? error : new Error(String(error))),
        );
    });
  },
  async setSleepTimer(mode: 'minutes' | 'track', minutes = 0) {
    if (module) await module.setSleepTimer(mode, minutes);
    else
      fallback = {
        ...fallback,
        sleepMode: mode,
        sleepDeadline: mode === 'minutes' ? Date.now() + minutes * 60_000 : 0,
      };
  },
  async cancelSleepTimer() {
    if (module) await module.cancelSleepTimer();
    else fallback = { ...fallback, sleepMode: 'off', sleepDeadline: 0 };
  },
  subscribe(listener: (state: NativePlayerState) => void) {
    if (!module) return () => {};
    const event = new NativeEventEmitter(
      NativeModules.LiuliuPlayer,
    ).addListener('playbackState', listener);
    return () => event.remove();
  },
};
