import type { ProviderId } from '../domain/types';

/** Display names only. Never use these values as provider, source or cache identities. */
export const platformLabels = {
  qq: '秋秋',
  kuwo: '库沃',
  kugou: '裤勾',
  netease: '往忆',
  migu: '迷谷',
  qishui: '汽水',
} as const;

export function platformLabel(provider: ProviderId | undefined): string {
  return provider && provider !== 'custom' ? platformLabels[provider] : '';
}

/** Format visible platform references without rewriting the underlying metadata. */
export function platformDisplayText(copy: string): string {
  return copy
    .replace(/网易(?:云(?:音乐)?)?/g, platformLabels.netease)
    .replace(/\bQQ\b/g, platformLabels.qq)
    .replace(/酷狗/g, platformLabels.kugou)
    .replace(/酷我/g, platformLabels.kuwo)
    .replace(/咪咕/g, platformLabels.migu);
}

/** This wording applies only to the source controls on the My page. */
export function sourceSettingsText(copy: string): string {
  return platformDisplayText(copy).replace(/音乐/g, '');
}
