let mockListener: (value: boolean) => void;
const mockRemove = jest.fn();
const mockWifi = jest.fn(async () => false);
jest.mock('react-native', () => ({
  NativeModules: { LiuliuNetwork: { getWifi: () => mockWifi(), addListener: jest.fn(), removeListeners: jest.fn() } },
  NativeEventEmitter: class { addListener(_name: string, listener: typeof mockListener) { mockListener = listener; return { remove: mockRemove }; } },
}));
import { downloadNetworkQuality, playbackNetworkQuality, readWifiNetwork, subscribeWifiNetwork } from '../src/services/networkQuality';
import type { AppSettings } from '../src/domain/types';
const settings = { quality: '128k', downloadQuality: '320k', wifiQuality: 'hires', wifiDownloadQuality: 'flac' } as AppSettings;
beforeEach(() => jest.clearAllMocks());
test('playback and download select independent Wi-Fi preferences and preserve all stored values', () => {
  const before = JSON.stringify(settings);
  expect(playbackNetworkQuality(settings, false)).toBe('128k');
  expect(downloadNetworkQuality(settings, false)).toBe('320k');
  expect(playbackNetworkQuality(settings, true)).toBe('hires');
  expect(downloadNetworkQuality(settings, true)).toBe('flac');
  expect(JSON.stringify(settings)).toBe(before);
});
test('network transitions change future request preferences without any playback/native queue commands', async () => {
  mockWifi.mockResolvedValue(true);
  await readWifiNetwork();
  const changes: boolean[] = [];
  const remove = subscribeWifiNetwork(value => changes.push(value));
  expect(playbackNetworkQuality(settings)).toBe('hires');
  mockListener(false);
  expect(playbackNetworkQuality(settings)).toBe('128k');
  expect(downloadNetworkQuality(settings)).toBe('320k');
  expect(changes).toEqual([false]);
  remove(); expect(mockRemove).toHaveBeenCalledTimes(1);
});
test('unknown network and missing Wi-Fi values retain the original non-Wi-Fi contract', async () => {
  mockWifi.mockRejectedValueOnce(new Error('network unavailable'));
  expect(await readWifiNetwork()).toBe(false);
  expect(playbackNetworkQuality(settings)).toBe('128k');
  const old = { quality: 'flac', downloadQuality: '128k' } as AppSettings;
  expect(playbackNetworkQuality(old, true)).toBe('flac');
  expect(downloadNetworkQuality(old, true)).toBe('128k');
});
