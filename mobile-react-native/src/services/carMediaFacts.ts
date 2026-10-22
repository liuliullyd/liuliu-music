import type { Track } from '../domain/types';

type Flag = '1' | '0' | 'unknown';

function bits(value: unknown, width: number): bigint | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d{1,20}$/.test(value))) return undefined;
  try {
    const parsed = BigInt(value);
    if (parsed < -(2n ** BigInt(width - 1)) || parsed >= 2n ** BigInt(width)) return undefined;
    return BigInt.asUintN(width, parsed);
  } catch { return undefined; }
}

// These flags are powers of two. BigInt division preserves 64-bit fields without Number truncation.
const hasFlag = (value: bigint, flag: bigint) => value / flag % 2n === 1n;

/** The shared Track catalog uses seconds; Android media metadata uses milliseconds. */
export function carCatalogDurationMs(track: Track | null | undefined): number | undefined {
  const duration = track?.duration;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && duration < Number.MAX_SAFE_INTEGER / 1000
    ? Math.round(duration * 1000) : undefined;
}

/** QQ's UCAR VIP is a song badge (action.icons/icon2), never the user's membership or URL entitlement. */
export function carMediaFacts(track: Track | null | undefined): { vip: Flag; trial: 'unknown'; vipSource?: string; catalogDurationMs?: number } {
  let vip: Flag = 'unknown';
  if (track?.provider === 'qq') {
    const metadata = track.metadata ?? {};
    const action = metadata.action;
    // The QQ parser can select a version-specific action from va. We lack its active-version decision.
    if (action && typeof action === 'object' && !Array.isArray(action) && !(Array.isArray(metadata.va) && metadata.va.length)) {
      const value = action as Record<string, unknown>;
      const icons = bits(value.icons, 32), icon2 = bits(value.icon2, 64);
      const first = icons === undefined ? undefined : hasFlag(icons, 262144n);
      const second = icon2 === undefined ? undefined : hasFlag(icon2, 2048n) || hasFlag(icon2, 17179869184n);
      if (first === true || second === true) vip = '1';
      else if (first === false && second === false) vip = '0';
    }
  }
  const durationMs = carCatalogDurationMs(track);
  return { vip, trial: 'unknown', ...(vip === 'unknown' ? {} : { vipSource: 'qq-catalog-action-icons' }),
    ...(durationMs === undefined ? {} : { catalogDurationMs: durationMs }) };
}
