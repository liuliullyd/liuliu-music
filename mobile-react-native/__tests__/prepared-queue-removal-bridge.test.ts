import { NativeModules } from 'react-native';

beforeEach(() => jest.resetModules());

test('guarded prepared removal forwards current and target identities and returns native acceptance', async () => {
  const guarded = jest.fn(async () => true);
  const ordinary = jest.fn(async () => undefined);
  NativeModules.LiuliuPlayer = { removePreparedQueueItem: guarded, removeQueueItem: ordinary };
  const { nativePlayer } = require('../src/services/nativePlayer');
  await expect(nativePlayer.removePreparedQueueItem('qq:current', 'qq:next', 2)).resolves.toBe(true);
  expect(guarded).toHaveBeenCalledWith('qq:current', 'qq:next', 2);
  expect(ordinary).not.toHaveBeenCalled();
  guarded.mockResolvedValueOnce(false);
  await expect(nativePlayer.removePreparedQueueItem('qq:current', 'qq:next', 2)).resolves.toBe(false);
  await nativePlayer.removeQueueItem(2);
  expect(ordinary).toHaveBeenCalledWith(2);
});

test('a bridge without guarded removal refuses background deletion without using the ordinary API', async () => {
  const ordinary = jest.fn(async () => undefined);
  NativeModules.LiuliuPlayer = { removeQueueItem: ordinary };
  const { nativePlayer } = require('../src/services/nativePlayer');
  await expect(nativePlayer.removePreparedQueueItem('qq:current', 'qq:next', 1)).resolves.toBe(false);
  expect(ordinary).not.toHaveBeenCalled();
});

test('no native player refuses guarded removal', async () => {
  NativeModules.LiuliuPlayer = undefined;
  const { nativePlayer } = require('../src/services/nativePlayer');
  await expect(nativePlayer.removePreparedQueueItem('qq:current', 'qq:next', 1)).resolves.toBe(false);
});
