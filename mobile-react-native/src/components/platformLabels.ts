import type { ProviderId } from '../domain/types';
import { providerNames } from '../services/onlineCatalog';
import {
  platformDisplayText,
  platformLabel,
} from '../services/platformPresentation';
export {
  platformLabel,
  platformLabels,
} from '../services/platformPresentation';
/** Preserve real descriptions; shorten only a provider-name fallback. */
export function platformCaption(
  copy: string | undefined,
  provider: ProviderId,
): string {
  const text = copy?.trim() || '';
  if (provider === 'custom') return text;
  return !text || text === provider || text === providerNames[provider]
    ? platformLabel(provider)
    : platformDisplayText(text);
}
export function isSpokenCollection(metadata?: Record<string, unknown>) {
  return metadata?.mediaType === 'long-audio';
}
