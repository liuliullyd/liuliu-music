import type { Track } from '../src/domain/types';
import { SourceRateLimitedError } from '../src/services/playbackSourceAvailability';
import {
  prepareValidatedTracks,
  selectFirstResolvableTrack,
} from '../src/services/playbackPreparation';

const track = (id: string): Track => ({
  id,
  title: id,
  artist: '歌手',
  album: '专辑',
  duration: 180,
  provider: 'netease',
  providerId: id,
  coverKey: 'train',
  language: '华语',
  genre: '流行',
  mood: '发现',
  releaseYear: 2026,
});

test('visible preparation starts in list order and keeps only validated tracks', async () => {
  const started: string[] = [];
  const result = await prepareValidatedTracks(
    [track('1'), track('2'), track('3')],
    async value => {
      started.push(value.id);
      if (value.id === '2') throw new Error('试听片段');
      return { ...value, playUrl: `https://audio/${value.id}` };
    },
  );
  expect(started).toEqual(['1', '2', '3']);
  expect(result.map(value => value.id)).toEqual(['1', '3']);
});

test('startup promotes only the first URL-resolvable candidate without touching later neighbours', async () => {
  const started: string[] = [];
  const result = await selectFirstResolvableTrack(
    [track('bad-1'), track('selected'), track('untouched')],
    async value => {
      started.push(value.id);
      if (value.id === 'bad-1') throw new Error('没有可播放的在线音源');
      return { ...value, playUrl: `https://audio/${value.id}` };
    },
  );
  expect(started).toEqual(['bad-1', 'selected']);
  expect(result.index).toBe(1);
  expect(result.selected.id).toBe('selected');
  expect(result.tracks.map(value => value.id)).toEqual([
    'selected',
    'untouched',
  ]);
});

test('startup does not skip a pending source or song at five or thirty seconds', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (value: Track) => void;
    const pending = new Promise<Track>(resolve => { finish = resolve; });
    const resolve = jest.fn((value: Track) => value.id === 'slow' ? pending : Promise.resolve(value));
    const result = selectFirstResolvableTrack([track('slow'), track('untouched')], resolve);
    await jest.advanceTimersByTimeAsync(60000);
    expect(resolve).toHaveBeenCalledTimes(1);
    finish({ ...track('slow'), playUrl: 'https://audio/slow' });
    await expect(result).resolves.toMatchObject({ index: 0, selected: { id: 'slow' } });
    expect(resolve).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('startup cancellation rejects immediately and cancels its pending resolver', async () => {
  const controller = new AbortController();
  let signal!: AbortSignal;
  const resolve = jest.fn((_track: Track, input: AbortSignal) => {
    signal = input;
    return new Promise<Track>(() => {});
  });
  const result = selectFirstResolvableTrack([track('first'), track('untouched')], resolve, { signal: controller.signal });
  const observed = result.catch(error => error);
  controller.abort();
  expect(await observed).toMatchObject({ name: 'AbortError' });
  expect(signal.aborted).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
});

test('startup service throttling stops the candidate loop without treating other songs as failures', async () => {
  const error = new SourceRateLimitedError();
  const resolve = jest.fn(async () => { throw error; });
  await expect(selectFirstResolvableTrack([track('first'), track('untouched')], resolve)).rejects.toBe(error);
  expect(resolve).toHaveBeenCalledTimes(1);
});
