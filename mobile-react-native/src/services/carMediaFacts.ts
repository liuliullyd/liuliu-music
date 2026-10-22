import type { Track } from '../domain/types';

/** The shared Track catalog uses seconds; Android media metadata uses milliseconds. */
export function carCatalogDurationMs(
  track: Track | null | undefined,
): number | undefined {
  const duration = track?.duration;
  return typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration < Number.MAX_SAFE_INTEGER / 1000
    ? Math.round(duration * 1000)
    : undefined;
}

/** App-owned metadata does not infer provider-specific entitlement flags. */
export function carMediaFacts(track: Track | null | undefined): {
  catalogDurationMs?: number;
} {
  const durationMs = carCatalogDurationMs(track);
  return durationMs === undefined ? {} : { catalogDurationMs: durationMs };
}
