import { NativeModules } from 'react-native';
import { sampleCoverEdgeColor } from './playerAppearance';

const samples = new Map<string, string>();
let cacheGeneration = 0;
const pending = new Map<string, Promise<string | null>>();

export function clearLibraryArtworkCache() {
  cacheGeneration += 1;
  samples.clear();
}

/** Roam's bundled fallback uses the same native edge-ring sampler as remote artwork. */
export function sampleLibraryCoverEdgeColor(
  uri: string,
): Promise<string | null> {
  if (/^https?:\/\//i.test(uri)) return sampleCoverEdgeColor(uri);
  const local = /^(file|content):\/\//i.test(uri);
  if (!local && !/^[a-z0-9_]+$/.test(uri)) return Promise.resolve(null);
  const native = NativeModules.LiuliuStorage as
    | { sampleBundledCoverEdgeColor?: (name: string) => Promise<string | null> }
      & { sampleLocalCoverEdgeColor?: (uri: string) => Promise<string | null> }
    | undefined;
  const sampler = local ? native?.sampleLocalCoverEdgeColor : native?.sampleBundledCoverEdgeColor;
  if (!sampler) return Promise.resolve(null);
  const cached = samples.get(uri);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(uri);
  if (existing) return existing;
  const generation = cacheGeneration;
  const request = sampler.call(native, uri)
    .then(value => {
      const color =
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
          ? value
          : null;
      if (color && generation === cacheGeneration) samples.set(uri, color);
      return color;
    })
    .catch(() => null)
    .finally(() => pending.delete(uri));
  pending.set(uri, request);
  return request;
}
