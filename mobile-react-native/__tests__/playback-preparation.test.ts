import type { Track } from '../src/domain/types';
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

test('startup tries the next candidate when one URL resolution exceeds its attempt budget', async () => {
  const pending = new Promise<Track>(() => undefined);
  const started: string[] = [];
  const resultPromise = selectFirstResolvableTrack(
    [track('slow'), track('next')],
    async value => {
      started.push(value.id);
      if (value.id === 'slow') return pending;
      return { ...value, playUrl: `https://audio/${value.id}` };
    },
    { budgetMs: 100, attemptTimeoutMs: 10 },
  );
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  await expect(resultPromise).resolves.toMatchObject({
    index: 1,
    selected: expect.objectContaining({ id: 'next' }),
  });
  expect(started).toEqual(['slow', 'next']);
});
