import { NativeEventEmitter, NativeModules } from 'react-native';
import type { AppSettings } from '../domain/types';

const native = NativeModules.LiuliuNetwork as undefined | {
  getWifi: () => Promise<boolean>;
  addListener: (name: string) => void;
  removeListeners: (count: number) => void;
};
let wifi = false;
export const isWifiNetwork = () => wifi;
export async function readWifiNetwork() {
  wifi = native ? await native.getWifi().catch(() => false) : false;
  return wifi;
}
export function subscribeWifiNetwork(listener: (value: boolean) => void) {
  if (!native) return () => undefined;
  const subscription = new NativeEventEmitter(native).addListener('wifiNetworkChanged', value => {
    wifi = value === true;
    listener(wifi);
  });
  return () => subscription.remove();
}
export const playbackNetworkQuality = (settings: AppSettings, connected = wifi) =>
  connected ? settings.wifiQuality ?? settings.quality : settings.quality;
export const downloadNetworkQuality = (settings: AppSettings, connected = wifi) =>
  connected ? settings.wifiDownloadQuality ?? settings.downloadQuality ?? settings.quality
    : settings.downloadQuality ?? settings.quality;
