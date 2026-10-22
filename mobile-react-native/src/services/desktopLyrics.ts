import { NativeEventEmitter, NativeModules } from 'react-native';
import type { LyricLine } from './onlineMusic';

export const desktopLyricStyles = [
  { id: 'center', label: '简约居中', copy: '居中双行歌词，突出当前一句' },
  { id: 'capsule', label: '音乐胶囊', copy: '封面、歌曲与双行歌词' },
  { id: 'card', label: '卡片样式', copy: '歌词、进度与播放控制' },
  { id: 'bottom', label: '底部悬浮', copy: '紧凑横栏，轻量显示歌词' },
  { id: 'wave', label: '动态波形', copy: '真实播放波形与同步歌词' },
  { id: 'vertical', label: '竖排歌词', copy: '多行滚动，突出当前一句' },
] as const;
export type DesktopLyricStyle = typeof desktopLyricStyles[number]['id'];
type LyricsBridge = {
  canDraw: () => Promise<boolean>;
  wasClosed: () => Promise<boolean>;
  acknowledgeClose: () => Promise<void>;
  requestPermission: () => Promise<void>;
  configure: (enabled: boolean, style: string, accent: string) => Promise<void>;
  setSong: (json: string) => Promise<void>;
  addListener: (name: string) => void;
  removeListeners: (count: number) => void;
};
const bridge = () => NativeModules.LiuliuDesktopLyrics as LyricsBridge | undefined;
export const desktopLyrics = {
  async canDraw() { return bridge()?.canDraw() ?? false; },
  async wasClosed() { return bridge()?.wasClosed() ?? false; },
  async acknowledgeClose() { await bridge()?.acknowledgeClose(); },
  async requestPermission() {
    const native = bridge();
    if (!native) throw new Error('当前构建不支持桌面歌词');
    await native.requestPermission();
  },
  async configure(enabled: boolean, style: DesktopLyricStyle, accent: string) {
    if (enabled && !bridge()) throw new Error('当前构建不支持桌面歌词');
    await bridge()?.configure(enabled, style, accent);
  },
  async setSong(song: { id: string; title: string; artist: string; cover?: string; favorite: boolean; lines: LyricLine[] }) {
    await bridge()?.setSong(JSON.stringify(song));
  },
  subscribe(listener: (action: { action: string; value?: number }) => void) {
    const native = bridge();
    if (!native) return () => undefined;
    const subscription = new NativeEventEmitter(native).addListener('desktopLyricsAction', listener);
    return () => subscription.remove();
  },
};
