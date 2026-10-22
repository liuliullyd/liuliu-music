import type { PlatformHealthResult } from '../src/services/liveDiscovery';

/** Preserve existing completed-health fixtures for tests unrelated to startup racing. */
export function launchHealthMock(
  detect: (...args: any[]) => Promise<PlatformHealthResult>,
  ...args: any[]
) {
  const onUpdate = args[4];
  const completed = detect(...args.slice(0, 4));
  completed.then(health => onUpdate?.(health));
  return { firstPassed: completed, completed };
}
