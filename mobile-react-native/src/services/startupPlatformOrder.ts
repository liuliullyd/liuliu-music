import type { OnlineProvider } from './onlineCatalog';
import type { PlatformHealthResult } from './liveDiscovery';

type PlatformIdentity = OnlineProvider | { id: OnlineProvider };
type PassOrder = Pick<PlatformHealthResult, 'first' | 'passedOrder'>;

/** Presentation order only; never changes source, recommendation or probe order. */
export function byStartupPassOrder<T extends PlatformIdentity>(
  items: readonly T[],
  health: PassOrder | null | undefined,
  eligible?: readonly OnlineProvider[],
): T[] {
  // Older/partial snapshots can prove only their first platform, not the rest.
  const sequence = health?.passedOrder ?? (health?.first ? [health.first] : []);
  const ranks = new Map<OnlineProvider, number>();
  for (const id of sequence) {
    if ((!eligible || eligible.includes(id)) && !ranks.has(id)) ranks.set(id, ranks.size);
  }
  const rank = (item: T) => ranks.get(typeof item === 'string' ? item : item.id) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => rank(a) - rank(b));
}
